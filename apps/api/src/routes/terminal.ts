import type { FastifyInstance } from "fastify";
import * as pty from "node-pty";
import { verifyAccessToken } from "../lib/jwt.js";

interface ClientMessage {
  type: "input" | "resize";
  data?: string;
  cols?: number;
  rows?: number;
}

export default async function terminalRoutes(app: FastifyInstance) {
  // Browsers cannot set an Authorization header on a WebSocket handshake,
  // so the access token is passed as a query param and verified manually
  // here - same pattern as the other streaming routes. Full shell access as
  // whatever OS user this process runs as, so this is admin-only, not just
  // "logged in".
  app.get("/terminal/stream", { websocket: true }, (socket, req) => {
    const token = (req.query as { token?: string } | undefined)?.token;
    let payload;
    try {
      if (!token) throw new Error("missing token");
      payload = verifyAccessToken(token);
      if (payload.role !== "ADMIN") throw new Error("admin role required");
    } catch {
      socket.close(4001, "Unauthorized");
      return;
    }

    const shell = pty.spawn("bash", [], {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: process.env.HOME ?? "/home/ubuntu",
      env: process.env as Record<string, string>,
    });

    shell.onData((data) => {
      try {
        socket.send(data);
      } catch {
        shell.kill();
      }
    });

    shell.onExit(() => {
      try {
        socket.close();
      } catch {
        // socket may already be closed
      }
    });

    socket.on("message", (raw: Buffer) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());
        if (msg.type === "input" && typeof msg.data === "string") {
          shell.write(msg.data);
        } else if (msg.type === "resize" && msg.cols && msg.rows) {
          shell.resize(msg.cols, msg.rows);
        }
      } catch {
        // ignore malformed frames
      }
    });

    socket.on("close", () => shell.kill());
  });
}
