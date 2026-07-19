import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";

import prismaPlugin from "./plugins/prisma.js";
import authenticatePlugin from "./plugins/authenticate.js";
import authRoutes from "./routes/auth.js";
import systemRoutes from "./routes/system.js";
import sitesRoutes from "./routes/sites.js";
import logsRoutes from "./routes/logs.js";
import securityRoutes from "./routes/security.js";
import databasesRoutes from "./routes/databases.js";
import filesRoutes from "./routes/files.js";
import domainsRoutes from "./routes/domains.js";
import appsRoutes from "./routes/apps.js";
import terminalRoutes from "./routes/terminal.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);
await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
await app.register(websocket);
// Disk on this box runs close to full, so uploads are capped well below any
// real risk of filling it from one request.
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

await app.register(prismaPlugin);
await app.register(authenticatePlugin);

await app.register(authRoutes);
await app.register(systemRoutes);
await app.register(sitesRoutes);
await app.register(logsRoutes);
await app.register(securityRoutes);
await app.register(databasesRoutes);
await app.register(filesRoutes);
await app.register(domainsRoutes);
await app.register(appsRoutes);
await app.register(terminalRoutes);

app.get("/health", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "127.0.0.1";

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
