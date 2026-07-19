import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callHelper } from "../lib/helperClient.js";
import { recordAudit } from "../lib/audit.js";

const nameParams = z.object({ name: z.string().min(1) });
const installBody = z.object({ path: z.string().min(1) });
const startBody = z.object({ name: z.string().min(1), path: z.string().min(1), script: z.string().min(1) });

interface Pm2Process {
  name: string;
  pid: number;
  pm2_env: { status: string; pm_uptime: number; restart_time: number };
  monit: { cpu: number; memory: number };
}

const NPM_INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const PM2_ACTION_TIMEOUT_MS = 30_000;

export default async function appsRoutes(app: FastifyInstance) {
  const guard = { preHandler: [app.authenticate, app.requireAdmin] };

  app.get("/apps", guard, async (_req, reply) => {
    const result = await callHelper({ action: "pm2.list" }, PM2_ACTION_TIMEOUT_MS);
    if (!result.ok) return reply.code(500).send({ error: result.error });

    let processes: Pm2Process[];
    try {
      processes = JSON.parse(result.output ?? "[]");
    } catch {
      return reply.code(500).send({ error: "failed to parse pm2 process list" });
    }

    return {
      apps: processes.map((p) => ({
        name: p.name,
        status: p.pm2_env.status,
        pid: p.pid,
        cpu: p.monit?.cpu ?? 0,
        memory: p.monit?.memory ?? 0,
        uptime: p.pm2_env.pm_uptime,
        restarts: p.pm2_env.restart_time,
        protected: p.name === "panel-api",
      })),
    };
  });

  app.post("/apps/install", guard, async (req, reply) => {
    const { path: appPath } = installBody.parse(req.body);
    const result = await callHelper({ action: "npm.install", args: { path: appPath } }, NPM_INSTALL_TIMEOUT_MS);
    await recordAudit(app, req, "app.install", appPath, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });

  app.post("/apps/start", guard, async (req, reply) => {
    const { name, path: appPath, script } = startBody.parse(req.body);
    const result = await callHelper({ action: "pm2.start", args: { name, path: appPath, script } }, PM2_ACTION_TIMEOUT_MS);
    await recordAudit(app, req, "app.start", name, { ok: result.ok, path: appPath, script });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });

  app.post("/apps/:name/stop", guard, async (req, reply) => {
    const { name } = nameParams.parse(req.params);
    const result = await callHelper({ action: "pm2.stop", args: { name } }, PM2_ACTION_TIMEOUT_MS);
    await recordAudit(app, req, "app.stop", name, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });

  app.post("/apps/:name/restart", guard, async (req, reply) => {
    const { name } = nameParams.parse(req.params);
    const result = await callHelper({ action: "pm2.restart", args: { name } }, PM2_ACTION_TIMEOUT_MS);
    await recordAudit(app, req, "app.restart", name, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });

  app.delete("/apps/:name", guard, async (req, reply) => {
    const { name } = nameParams.parse(req.params);
    const result = await callHelper({ action: "pm2.delete", args: { name } }, PM2_ACTION_TIMEOUT_MS);
    await recordAudit(app, req, "app.delete", name, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });
}
