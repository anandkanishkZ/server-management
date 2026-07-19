import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";

import prismaPlugin from "./plugins/prisma.js";
import authenticatePlugin from "./plugins/authenticate.js";
import authRoutes from "./routes/auth.js";
import systemRoutes from "./routes/system.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);
await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
await app.register(websocket);

await app.register(prismaPlugin);
await app.register(authenticatePlugin);

await app.register(authRoutes);
await app.register(systemRoutes);

app.get("/health", async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "127.0.0.1";

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
