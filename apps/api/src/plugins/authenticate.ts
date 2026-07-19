import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken, type AccessTokenPayload } from "../lib/jwt.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
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
});
