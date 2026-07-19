import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listSites } from "../lib/nginxParser.js";
import { staticSiteConfig, proxySiteConfig } from "../lib/nginxTemplates.js";
import { callHelper } from "../lib/helperClient.js";
import { recordAudit } from "../lib/audit.js";

const nameParams = z.object({ name: z.string().min(1) });
const domainRe = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const domainSchema = z.string().regex(domainRe, "invalid domain");

const createSiteBody = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("static"),
    domain: domainSchema,
    aliasDomains: z.array(domainSchema).default([]),
    root: z.string().min(1).regex(/^\//, "root must be an absolute path"),
  }),
  z.object({
    type: z.literal("proxy"),
    domain: domainSchema,
    aliasDomains: z.array(domainSchema).default([]),
    port: z.coerce.number().int().min(1).max(65535),
  }),
]);

export default async function sitesRoutes(app: FastifyInstance) {
  const guard = { preHandler: [app.authenticate, app.requireAdmin] };

  app.get("/sites", guard, async () => {
    return { sites: await listSites() };
  });

  app.post("/sites", guard, async (req, reply) => {
    const body = createSiteBody.parse(req.body);
    const name = `${body.domain}.conf`;
    const content =
      body.type === "static"
        ? staticSiteConfig({ domain: body.domain, aliasDomains: body.aliasDomains, root: body.root })
        : proxySiteConfig({ domain: body.domain, aliasDomains: body.aliasDomains, port: body.port });

    const result = await callHelper({ action: "nginx.createSite", args: { name, content } });
    await recordAudit(app, req, "site.create", name, { ok: result.ok, type: body.type });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, name, output: result.output };
  });

  app.post("/sites/:name/enable", guard, async (req, reply) => {
    const { name } = nameParams.parse(req.params);
    const result = await callHelper({ action: "nginx.enableSite", args: { name } });
    await recordAudit(app, req, "site.enable", name, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });

  app.post("/sites/:name/disable", guard, async (req, reply) => {
    const { name } = nameParams.parse(req.params);
    const result = await callHelper({ action: "nginx.disableSite", args: { name } });
    await recordAudit(app, req, "site.disable", name, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });

  app.post("/sites/reload", guard, async (req, reply) => {
    const result = await callHelper({ action: "nginx.reload" });
    await recordAudit(app, req, "nginx.reload", undefined, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });
}
