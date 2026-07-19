import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken, type AccessTokenPayload } from "../lib/jwt.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user?: AccessTokenPayload;
  }
}

export default fp(async (app: FastifyInstance) => {
  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "Missing bearer token" });
    }
    try {
      req.user = verifyAccessToken(header.slice("Bearer ".length));
    } catch {
      return reply.code(401).send({ error: "Invalid or expired token" });
    }
  });

  // Run after `authenticate`. Gates anything with full data read/write across
  // every database (table browser, raw SQL console) behind the ADMIN role,
  // not just "logged in".
  app.decorate("requireAdmin", async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user?.role !== "ADMIN") {
      return reply.code(403).send({ error: "Admin role required" });
    }
  });
});
