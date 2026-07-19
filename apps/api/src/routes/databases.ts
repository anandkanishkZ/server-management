import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { callHelper } from "../lib/helperClient.js";
import { parseDatabaseList } from "../lib/postgresParser.js";
import { recordAudit } from "../lib/audit.js";
import * as dbAdmin from "../lib/dbAdmin.js";

const DUMP_DIR = "/tmp/panel-dumps";
const DUMP_FILE_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}-\d+\.sql$/;

const nameParams = z.object({ name: z.string().min(1) });
const createBody = z.object({ name: z.string().min(1) });
const tableParams = z.object({ name: z.string().min(1), schema: z.string().min(1), table: z.string().min(1) });
const rowsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});
const rowValues = z.record(z.unknown());
const updateBody = z.object({ pk: rowValues, changes: rowValues });
const insertBody = z.object({ values: rowValues });
const deleteBody = z.object({ pk: rowValues });
const querySql = z.object({ sql: z.string().min(1) });

export default async function databasesRoutes(app: FastifyInstance) {
  app.get("/databases", { preHandler: [app.authenticate, app.requireAdmin] }, async (_req, reply) => {
    const result = await callHelper({ action: "db.list" });
    if (!result.ok) return reply.code(500).send({ error: result.error });
    return { databases: parseDatabaseList(result.output ?? "") };
  });

  app.post("/databases", { preHandler: [app.authenticate, app.requireAdmin] }, async (req, reply) => {
    const { name } = createBody.parse(req.body);
    const result = await callHelper({ action: "db.create", args: { name } });
    await recordAudit(app, req, "database.create", name, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });

    const [dbName, password] = (result.output ?? "").trim().split("\t");
    return { name: dbName, password };
  });

  app.delete("/databases/:name", { preHandler: [app.authenticate, app.requireAdmin] }, async (req, reply) => {
    const { name } = nameParams.parse(req.params);
    // Close our own pool first so nothing on our side is holding (or gets
    // forcibly killed out from under) a connection to the database being
    // dropped - see dbAdmin.closePool for why that matters.
    await dbAdmin.closePool(name);
    const result = await callHelper({ action: "db.drop", args: { name } });
    await recordAudit(app, req, "database.drop", name, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true };
  });

  app.post("/databases/:name/dump", { preHandler: [app.authenticate, app.requireAdmin] }, async (req, reply) => {
    const { name } = nameParams.parse(req.params);
    const result = await callHelper({ action: "db.dump", args: { name } });
    await recordAudit(app, req, "database.dump", name, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { file: (result.output ?? "").trim() };
  });

  app.get("/databases/dumps/:file", { preHandler: [app.authenticate, app.requireAdmin] }, async (req, reply) => {
    const { file } = z.object({ file: z.string() }).parse(req.params);
    if (!DUMP_FILE_RE.test(file)) return reply.code(400).send({ error: "invalid dump filename" });

    const fullPath = path.join(DUMP_DIR, file);
    try {
      const content = await fs.readFile(fullPath);
      reply.header("Content-Disposition", `attachment; filename="${file}"`);
      reply.header("Content-Type", "application/sql");
      await fs.unlink(fullPath).catch(() => {});
      return reply.send(content);
    } catch {
      return reply.code(404).send({ error: "dump not found or already downloaded" });
    }
  });

  // --- Table browser / editor -------------------------------------------

  app.get("/databases/:name/tables", { preHandler: [app.authenticate, app.requireAdmin] }, async (req, reply) => {
    const { name } = nameParams.parse(req.params);
    try {
      return { tables: await dbAdmin.listTables(name) };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to list tables" });
    }
  });

  app.get(
    "/databases/:name/tables/:schema/:table/columns",
    { preHandler: [app.authenticate, app.requireAdmin] },
    async (req, reply) => {
      const { name, schema, table } = tableParams.parse(req.params);
      try {
        return { columns: await dbAdmin.getColumns(name, { schema, table }) };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to load columns" });
      }
    }
  );

  app.get(
    "/databases/:name/tables/:schema/:table/rows",
    { preHandler: [app.authenticate, app.requireAdmin] },
    async (req, reply) => {
      const { name, schema, table } = tableParams.parse(req.params);
      const { limit, offset, sort, dir } = rowsQuery.parse(req.query);
      try {
        const result = await dbAdmin.getRows(name, { schema, table }, { limit, offset, sortColumn: sort, sortDir: dir });
        return result;
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to load rows" });
      }
    }
  );

  app.patch(
    "/databases/:name/tables/:schema/:table/rows",
    { preHandler: [app.authenticate, app.requireAdmin] },
    async (req, reply) => {
      const { name, schema, table } = tableParams.parse(req.params);
      const { pk, changes } = updateBody.parse(req.body);
      try {
        const row = await dbAdmin.updateRow(name, { schema, table }, pk, changes);
        await recordAudit(app, req, "database.row.update", `${name}.${schema}.${table}`, { pk });
        return { row };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to update row" });
      }
    }
  );

  app.post(
    "/databases/:name/tables/:schema/:table/rows",
    { preHandler: [app.authenticate, app.requireAdmin] },
    async (req, reply) => {
      const { name, schema, table } = tableParams.parse(req.params);
      const { values } = insertBody.parse(req.body);
      try {
        const row = await dbAdmin.insertRow(name, { schema, table }, values);
        await recordAudit(app, req, "database.row.insert", `${name}.${schema}.${table}`);
        return { row };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to insert row" });
      }
    }
  );

  app.delete(
    "/databases/:name/tables/:schema/:table/rows",
    { preHandler: [app.authenticate, app.requireAdmin] },
    async (req, reply) => {
      const { name, schema, table } = tableParams.parse(req.params);
      const { pk } = deleteBody.parse(req.body);
      try {
        await dbAdmin.deleteRow(name, { schema, table }, pk);
        await recordAudit(app, req, "database.row.delete", `${name}.${schema}.${table}`, { pk });
        return { ok: true };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to delete row" });
      }
    }
  );

  app.post("/databases/:name/query", { preHandler: [app.authenticate, app.requireAdmin] }, async (req, reply) => {
    const { name } = nameParams.parse(req.params);
    const { sql } = querySql.parse(req.body);
    try {
      const result = await dbAdmin.runRawQuery(name, sql);
      await recordAudit(app, req, "database.query", name, { sql });
      return result;
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "query failed" });
    }
  });
}
