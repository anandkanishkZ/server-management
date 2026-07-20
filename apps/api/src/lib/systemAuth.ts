import { Client } from "ssh2";

// Panel logins for these usernames are verified against the real Linux
// account (loopback SSH, so it goes through the box's actual sshd + PAM
// stack) instead of a panel-local password hash. Keep this allowlist
// explicit and narrow - it's equivalent to granting panel-login access to
// that OS account.
const ALLOWED_SYSTEM_USERS = (process.env.SYSTEM_LOGIN_USERS ?? "ubuntu")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function isSystemLoginUser(username: string): boolean {
  return ALLOWED_SYSTEM_USERS.includes(username);
}

export function verifySystemPassword(username: string, password: string): Promise<boolean> {
  return new Promise((resolve) => {
    const conn = new Client();
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      conn.end();
      resolve(ok);
    };

    conn.on("ready", () => finish(true));
    conn.on("error", () => finish(false));

    conn.connect({
      host: "127.0.0.1",
      port: 22,
      username,
      password,
      readyTimeout: 8000,
    });
  });
}
