import type { FastifyInstance, FastifyRequest } from "fastify";

export async function recordAudit(
  app: FastifyInstance,
  req: FastifyRequest,
  action: string,
  target?: string,
  payload?: Record<string, unknown>
) {
  const userId = (req as { user?: { sub: string } }).user?.sub ?? null;

  await app.prisma.auditLog.create({
    data: {
      userId,
      action,
      target,
      payload: payload as never,
      ip: req.ip,
    },
  });
}
