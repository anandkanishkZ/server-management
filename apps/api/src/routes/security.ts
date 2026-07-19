import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callHelper } from "../lib/helperClient.js";
import { parseUfwStatus } from "../lib/ufwParser.js";
import { parseJailList, parseJailStatus } from "../lib/fail2banParser.js";
import { recordAudit } from "../lib/audit.js";

const allowBody = z.object({ port: z.coerce.number().int().min(1).max(65535), proto: z.enum(["tcp", "udp"]) });
const denyBody = z.object({ ip: z.string().min(1) });
const jailParams = z.object({ jail: z.string().min(1) });
const banBody = z.object({ ip: z.string().min(1) });

export default async function securityRoutes(app: FastifyInstance) {
  app.get("/security/firewall", { preHandler: app.authenticate }, async (_req, reply) => {
    const result = await callHelper({ action: "ufw.status" });
    if (!result.ok) return reply.code(500).send({ error: result.error });
    return parseUfwStatus(result.output ?? "");
  });

  app.post("/security/firewall/enable", { preHandler: app.authenticate }, async (req, reply) => {
    const result = await callHelper({ action: "ufw.enable" });
    await recordAudit(app, req, "firewall.enable", undefined, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });

  app.post("/security/firewall/disable", { preHandler: app.authenticate }, async (req, reply) => {
    const result = await callHelper({ action: "ufw.disable" });
    await recordAudit(app, req, "firewall.disable", undefined, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });

  app.post("/security/firewall/allow", { preHandler: app.authenticate }, async (req, reply) => {
    const { port, proto } = allowBody.parse(req.body);
    const result = await callHelper({ action: "ufw.allow", args: { port: String(port), proto } });
    await recordAudit(app, req, "firewall.allow", `${port}/${proto}`, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });

  app.post("/security/firewall/deny", { preHandler: app.authenticate }, async (req, reply) => {
    const { ip } = denyBody.parse(req.body);
    const result = await callHelper({ action: "ufw.deny", args: { ip } });
    await recordAudit(app, req, "firewall.deny", ip, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });

  app.delete("/security/firewall/rules/:number", { preHandler: app.authenticate }, async (req, reply) => {
    const { number } = z.object({ number: z.coerce.number().int().min(1) }).parse(req.params);
    const result = await callHelper({ action: "ufw.delete", args: { number: String(number) } });
    await recordAudit(app, req, "firewall.deleteRule", String(number), { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });

  app.get("/security/fail2ban", { preHandler: app.authenticate }, async (_req, reply) => {
    const listResult = await callHelper({ action: "fail2ban.status" });
    if (!listResult.ok) {
      return { installed: false, jails: [] };
    }

    const jailNames = parseJailList(listResult.output ?? "");
    const jails = await Promise.all(
      jailNames.map(async (name) => {
        const jailResult = await callHelper({ action: "fail2ban.jailStatus", args: { jail: name } });
        return jailResult.ok ? parseJailStatus(name, jailResult.output ?? "") : { name, currentlyFailed: 0, totalFailed: 0, currentlyBanned: 0, totalBanned: 0, bannedIps: [] };
      })
    );

    return { installed: true, jails };
  });

  app.post("/security/fail2ban/install", { preHandler: app.authenticate }, async (req, reply) => {
    const result = await callHelper({ action: "fail2ban.install" });
    await recordAudit(app, req, "fail2ban.install", undefined, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });

  app.post("/security/fail2ban/:jail/ban", { preHandler: app.authenticate }, async (req, reply) => {
    const { jail } = jailParams.parse(req.params);
    const { ip } = banBody.parse(req.body);
    const result = await callHelper({ action: "fail2ban.ban", args: { jail, ip } });
    await recordAudit(app, req, "fail2ban.ban", `${jail}:${ip}`, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });

  app.post("/security/fail2ban/:jail/unban", { preHandler: app.authenticate }, async (req, reply) => {
    const { jail } = jailParams.parse(req.params);
    const { ip } = banBody.parse(req.body);
    const result = await callHelper({ action: "fail2ban.unban", args: { jail, ip } });
    await recordAudit(app, req, "fail2ban.unban", `${jail}:${ip}`, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });
}
