import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listLogSources, resolveLogPath } from "../lib/logSources.js";
import { readLastLines, watchLogFile } from "../lib/logTail.js";
import { verifyAccessToken } from "../lib/jwt.js";

const tailQuery = z.object({
  source: z.string().min(1),
  lines: z.coerce.number().int().min(1).max(2000).default(200),
});

export default async function logsRoutes(app: FastifyInstance) {
  app.get("/logs/sources", { preHandler: app.authenticate }, async () => {
    return { sources: await listLogSources() };
  });

  app.get("/logs/tail", { preHandler: app.authenticate }, async (req, reply) => {
    const { source, lines } = tailQuery.parse(req.query);
    const path = await resolveLogPath(source);
    if (!path) return reply.code(404).send({ error: `unknown log source "${source}"` });

    try {
      const result = await readLastLines(path, lines);
      return result;
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : "failed to read log" });
    }
  });

  // Browsers cannot set an Authorization header on a WebSocket handshake,
  // so the access token is passed as a query param and verified manually here.
  app.get("/logs/stream", { websocket: true }, async (socket, req) => {
    const query = req.query as { token?: string; source?: string } | undefined;
    try {
      if (!query?.token) throw new Error("missing token");
      verifyAccessToken(query.token);
    } catch {
      socket.close(4001, "Unauthorized");
      return;
    }

    const source = query.source;
    if (!source) {
      socket.close(4004, "Missing source");
      return;
    }

    const path = await resolveLogPath(source);
    if (!path) {
      socket.close(4004, "Unknown source");
      return;
    }

    let initialSize = 0;
    try {
      const initial = await readLastLines(path, 200);
      initialSize = initial.size;
      socket.send(JSON.stringify({ type: "initial", lines: initial.lines }));
    } catch (err) {
      socket.send(JSON.stringify({ type: "error", message: err instanceof Error ? err.message : "failed to read log" }));
    }

    const stopWatching = watchLogFile(path, initialSize, (lines) => {
      try {
        socket.send(JSON.stringify({ type: "append", lines }));
      } catch {
        stopWatching();
      }
    });

    socket.on("close", () => stopWatching());
  });
}
