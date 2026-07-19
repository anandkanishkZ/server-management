import net from "node:net";

export interface HelperRequest {
  action: string;
  args?: Record<string, string>;
}

export interface HelperResponse {
  ok: boolean;
  output?: string;
  error?: string;
}

const SOCKET_PATH = process.env.HELPER_SOCKET_PATH ?? "/run/panel/helper.sock";

/**
 * Sends a whitelisted, structured request to the privileged helper daemon
 * over a local Unix socket. The API process never runs as root and never
 * shells out directly for privileged actions - this is the only channel.
 *
 * `timeoutMs` defaults to 10s (fine for nearly everything here) but a few
 * actions - `npm.install`, `pm2.start` - can legitimately run for minutes.
 */
export function callHelper(request: HelperRequest, timeoutMs = 10_000): Promise<HelperResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCKET_PATH);
    let data = "";

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error("Timed out waiting for the privileged helper"));
    });

    socket.on("connect", () => {
      // Half-close after writing so the helper's `on("end")` read-loop knows
      // the request is complete and can start processing it.
      socket.end(JSON.stringify(request) + "\n");
    });

    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
    });

    socket.on("end", () => {
      try {
        resolve(JSON.parse(data) as HelperResponse);
      } catch (err) {
        reject(err);
      }
    });

    socket.on("error", reject);
  });
}
