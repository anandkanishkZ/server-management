import type { FastifyInstance } from "fastify";
import { z } from "zod";

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  action: z.string().optional(),
  search: z.string().optional(),
});

export default async function auditRoutes(app: FastifyInstance) {
  const guard = { preHandler: [app.authenticate, app.requireAdmin] };

  app.get("/audit", guard, async (req) => {
    const { limit, offset, action, search } = listQuery.parse(req.query);

    const where: Record<string, unknown> = {};
    if (action) where.action = action;
    if (search) {
      where.OR = [
        { target: { contains: search, mode: "insensitive" } },
        { action: { contains: search, mode: "insensitive" } },
      ];
    }

    const [rows, total] = await Promise.all([
      app.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: { user: { select: { email: true } } },
      }),
      app.prisma.auditLog.count({ where }),
    ]);

    return {
      total,
      entries: rows.map((r) => ({
        id: r.id,
        action: r.action,
        target: r.target,
        payload: r.payload,
        ip: r.ip,
        createdAt: r.createdAt,
        userEmail: r.user?.email ?? null,
      })),
    };
  });

  app.get("/audit/actions", guard, async () => {
    const rows = await app.prisma.auditLog.groupBy({
      by: ["action"],
      _count: { action: true },
      orderBy: { _count: { action: "desc" } },
    });
    return { actions: rows.map((r) => ({ action: r.action, count: r._count.action })) };
  });
}
