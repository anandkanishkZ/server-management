import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import * as fm from "../lib/fileManager.js";
import { recordAudit } from "../lib/audit.js";

const listQuery = z.object({ root: z.string().min(1), path: z.string().default("/") });
const contentBody = z.object({ content: z.string() });
const mkdirBody = z.object({ root: z.string().min(1), path: z.string().default("/"), name: z.string().min(1) });
const createFileBody = z.object({ root: z.string().min(1), path: z.string().default("/"), name: z.string().min(1) });
const renameBody = z.object({ root: z.string().min(1), path: z.string().min(1), newName: z.string().min(1) });
const entryBody = z.object({ root: z.string().min(1), path: z.string().min(1) });
const copyMoveBody = z.object({ root: z.string().min(1), path: z.string().min(1), destPath: z.string().min(1) });
const chmodBody = z.object({ root: z.string().min(1), path: z.string().min(1), mode: z.string().min(1) });
const compressBody = z.object({ root: z.string().min(1), path: z.string().default("/"), names: z.array(z.string()).min(1), archiveName: z.string().min(1) });
const trashIdParams = z.object({ id: z.string().min(1) });
const trashRestoreBody = z.object({ root: z.string().min(1), id: z.string().min(1) });
const trashQuery = z.object({ root: z.string().min(1) });

export default async function filesRoutes(app: FastifyInstance) {
  const guard = { preHandler: [app.authenticate, app.requireAdmin] };

  app.get("/files/roots", guard, async () => {
    return { roots: fm.listRoots().map((r) => ({ id: r.id, label: r.label })) };
  });

  app.get("/files/list", guard, async (req, reply) => {
    const { root, path: p } = listQuery.parse(req.query);
    try {
      return { entries: await fm.listDir(root, p) };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to list directory" });
    }
  });

  app.get("/files/content", guard, async (req, reply) => {
    const { root, path: p } = listQuery.parse(req.query);
    try {
      return await fm.readFileContent(root, p);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to read file" });
    }
  });

  app.put("/files/content", guard, async (req, reply) => {
    const { root, path: p } = listQuery.parse(req.query);
    const { content } = contentBody.parse(req.body);
    try {
      await fm.writeFileContent(root, p, content);
      await recordAudit(app, req, "file.write", `${root}:${p}`);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to save file" });
    }
  });

  app.post("/files/create", guard, async (req, reply) => {
    const { root, path: p, name } = createFileBody.parse(req.body);
    try {
      await fm.createFile(root, p, name);
      await recordAudit(app, req, "file.create", `${root}:${p}/${name}`);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to create file" });
    }
  });

  app.get("/files/download", guard, async (req, reply) => {
    const { root, path: p } = listQuery.parse(req.query);
    try {
      const fullPath = fm.resolveDownloadPath(root, p);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) return reply.code(400).send({ error: "cannot download a directory" });

      reply.header("Content-Disposition", `attachment; filename="${path.basename(fullPath)}"`);
      reply.header("Content-Type", "application/octet-stream");
      return reply.send(fs.createReadStream(fullPath));
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to download file" });
    }
  });

  app.post("/files/upload", guard, async (req, reply) => {
    const query = listQuery.parse(req.query);
    try {
      const data = await req.file();
      if (!data) return reply.code(400).send({ error: "no file provided" });

      const targetDir = fm.resolvePath(query.root, query.path);
      const destPath = path.join(targetDir, path.basename(data.filename));
      if (!destPath.startsWith(targetDir)) return reply.code(400).send({ error: "invalid filename" });

      await new Promise<void>((resolve, reject) => {
        const writeStream = fs.createWriteStream(destPath);
        data.file.pipe(writeStream);
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
        data.file.on("error", reject);
      });

      await recordAudit(app, req, "file.upload", `${query.root}:${query.path}/${data.filename}`);
      return { ok: true, name: data.filename };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "upload failed" });
    }
  });

  app.delete("/files/entry", guard, async (req, reply) => {
    const { root, path: p } = entryBody.parse(req.body);
    try {
      await fm.softDelete(root, p);
      await recordAudit(app, req, "file.delete", `${root}:${p}`);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to delete" });
    }
  });

  app.post("/files/mkdir", guard, async (req, reply) => {
    const { root, path: p, name } = mkdirBody.parse(req.body);
    try {
      await fm.makeDir(root, p, name);
      await recordAudit(app, req, "file.mkdir", `${root}:${p}/${name}`);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to create folder" });
    }
  });

  app.post("/files/rename", guard, async (req, reply) => {
    const { root, path: p, newName } = renameBody.parse(req.body);
    try {
      await fm.renameEntry(root, p, newName);
      await recordAudit(app, req, "file.rename", `${root}:${p} -> ${newName}`);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to rename" });
    }
  });

  app.post("/files/copy", guard, async (req, reply) => {
    const { root, path: p, destPath } = copyMoveBody.parse(req.body);
    try {
      await fm.copyEntry(root, p, destPath);
      await recordAudit(app, req, "file.copy", `${root}:${p} -> ${destPath}`);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to copy" });
    }
  });

  app.post("/files/move", guard, async (req, reply) => {
    const { root, path: p, destPath } = copyMoveBody.parse(req.body);
    try {
      await fm.moveEntry(root, p, destPath);
      await recordAudit(app, req, "file.move", `${root}:${p} -> ${destPath}`);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to move" });
    }
  });

  app.post("/files/chmod", guard, async (req, reply) => {
    const { root, path: p, mode } = chmodBody.parse(req.body);
    try {
      await fm.chmodEntry(root, p, mode);
      await recordAudit(app, req, "file.chmod", `${root}:${p}`, { mode });
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to change permissions" });
    }
  });

  app.post("/files/compress", guard, async (req, reply) => {
    const { root, path: p, names, archiveName } = compressBody.parse(req.body);
    try {
      await fm.compressEntries(root, p, names, archiveName);
      await recordAudit(app, req, "file.compress", `${root}:${p}/${archiveName}`);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to compress" });
    }
  });

  app.post("/files/extract", guard, async (req, reply) => {
    const { root, path: p } = entryBody.parse(req.body);
    try {
      await fm.extractArchive(root, p);
      await recordAudit(app, req, "file.extract", `${root}:${p}`);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to extract" });
    }
  });

  app.get("/files/trash", guard, async (req, reply) => {
    const { root } = trashQuery.parse(req.query);
    try {
      return { entries: await fm.listTrash(root) };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to list trash" });
    }
  });

  app.post("/files/trash/restore", guard, async (req, reply) => {
    const { root, id } = trashRestoreBody.parse(req.body);
    try {
      await fm.restoreFromTrash(root, id);
      await recordAudit(app, req, "file.trash.restore", `${root}:${id}`);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to restore" });
    }
  });

  app.delete("/files/trash/:id", guard, async (req, reply) => {
    const { root } = trashQuery.parse(req.query);
    const { id } = trashIdParams.parse(req.params);
    try {
      await fm.deleteFromTrashPermanently(root, id);
      await recordAudit(app, req, "file.trash.delete", `${root}:${id}`);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to delete" });
    }
  });

  app.post("/files/trash/empty", guard, async (req, reply) => {
    const { root } = trashQuery.parse(req.body as { root: string });
    try {
      await fm.emptyTrash(root);
      await recordAudit(app, req, "file.trash.empty", root);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "failed to empty trash" });
    }
  });
}
