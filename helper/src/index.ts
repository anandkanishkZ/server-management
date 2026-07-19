import net from "node:net";
import fs from "node:fs";
import { actions } from "./actions.js";

const SOCKET_PATH = process.env.HELPER_SOCKET_PATH ?? "/run/panel/helper.sock";

interface HelperRequest {
  action: string;
  args?: Record<string, string>;
}

if (fs.existsSync(SOCKET_PATH)) {
  fs.unlinkSync(SOCKET_PATH);
}

// allowHalfOpen: true is required here - without it, Node auto-closes this
// socket's writable side the instant the client's FIN arrives (the default
// "end" behavior), racing ahead of the async action handler below, which
// hasn't written its response yet.
const server = net.createServer({ allowHalfOpen: true }, (socket) => {
  let buffer = "";

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
  });

  socket.on("end", async () => {
    let response: { ok: boolean; output?: string; error?: string };

    try {
      const request = JSON.parse(buffer) as HelperRequest;
      const handler = actions[request.action];

      if (!handler) {
        response = { ok: false, error: `unknown action "${request.action}"` };
      } else {
        const output = await handler(request.args ?? {});
        response = { ok: true, output };
      }
    } catch (err) {
      response = { ok: false, error: err instanceof Error ? err.message : "unknown error" };
    }

    socket.end(JSON.stringify(response));
  });
});

server.listen(SOCKET_PATH, () => {
  // Restrict the socket to root + the "panel" group so only the unprivileged
  // API process (a member of that group) can connect to it.
  fs.chmodSync(SOCKET_PATH, 0o660);
  console.log(`panel-helper listening on ${SOCKET_PATH}`);
});
