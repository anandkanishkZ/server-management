import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { callHelper } from "../lib/helperClient.js";
import { parseCertbotCertificates } from "../lib/certbotParser.js";
import { listSites } from "../lib/nginxParser.js";
import { recordAudit } from "../lib/audit.js";

const certNameParams = z.object({ certName: z.string().min(1) });
const obtainBody = z.object({ domain: z.string().min(1), email: z.string().email() });

export default async function domainsRoutes(app: FastifyInstance) {
  const guard = { preHandler: [app.authenticate, app.requireAdmin] };

  app.get("/domains", guard, async (_req, reply) => {
    const [certResult, sites] = await Promise.all([callHelper({ action: "certbot.list" }), listSites()]);
    if (!certResult.ok) return reply.code(500).send({ error: certResult.error });

    const certs = parseCertbotCertificates(certResult.output ?? "");

    // Every site's domain(s), annotated with whichever cert (if any) covers it.
    const domains = sites
      .flatMap((site) => site.serverNames)
      .filter((name, i, arr) => arr.indexOf(name) === i)
      .map((domain) => {
        const cert = certs.find((c) => c.domains.includes(domain));
        return {
          domain,
          hasCert: !!cert,
          certName: cert?.name ?? null,
          expiryDate: cert?.expiryDate ?? null,
          daysRemaining: cert?.daysRemaining ?? null,
          valid: cert?.valid ?? false,
        };
      });

    return { domains, certs };
  });

  app.post("/domains/:certName/renew", guard, async (req, reply) => {
    const { certName } = certNameParams.parse(req.params);
    const result = await callHelper({ action: "certbot.renew", args: { certName } });
    await recordAudit(app, req, "domain.renew", certName, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });

  app.post("/domains/obtain", guard, async (req, reply) => {
    const { domain, email } = obtainBody.parse(req.body);
    const result = await callHelper({ action: "certbot.obtain", args: { domain, email } });
    await recordAudit(app, req, "domain.obtain", domain, { ok: result.ok });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true, output: result.output };
  });
}
