import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listSites } from "../lib/nginxParser.js";
import { callHelper } from "../lib/helperClient.js";
import { recordAudit } from "../lib/audit.js";

const nameParams = z.object({ name: z.string().min(1) });

export default async function sitesRoutes(app: FastifyInstance) {
  app.get("/sites", { preHandler: app.authenticate }, async () => {
    return { sites: await listSites() };
  });

  app.post("/sites/:name/enable", { preHandler: app.authenticate }, async (req, reply) => {
    const { name } = nameParams.parse(req.params);
    const result = await callHelper({ action: "nginx.enableSite", args: { name } });
    await recordAudit(app, req, "site.enable", name, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });

  app.post("/sites/:name/disable", { preHandler: app.authenticate }, async (req, reply) => {
    const { name } = nameParams.parse(req.params);
    const result = await callHelper({ action: "nginx.disableSite", args: { name } });
    await recordAudit(app, req, "site.disable", name, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });

  app.post("/sites/reload", { preHandler: app.authenticate }, async (req, reply) => {
    const result = await callHelper({ action: "nginx.reload" });
    await recordAudit(app, req, "nginx.reload", undefined, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });
}
