import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Only services the panel is allowed to control. Extend deliberately, never
// pass through an arbitrary service name from the caller.
const ALLOWED_SERVICES = new Set(["nginx", "mysql", "postgresql", "fail2ban"]);

function assertAllowedService(service: string) {
  if (!ALLOWED_SERVICES.has(service)) {
    throw new Error(`service "${service}" is not in the allowlist`);
  }
}

/**
 * Every entry here is a fixed function that calls execFile with an array of
 * arguments - never a template string handed to a shell. This is the entire
 * attack surface of the privileged helper, so keep it short and explicit.
 */
export const actions: Record<string, (args: Record<string, string>) => Promise<string>> = {
  "nginx.test": async () => {
    const { stdout, stderr } = await execFileAsync("nginx", ["-t"]);
    return stdout + stderr;
  },

  "nginx.reload": async () => {
    const { stdout, stderr } = await execFileAsync("systemctl", ["reload", "nginx"]);
    return stdout + stderr;
  },

  "service.status": async (args) => {
    const service = args.service ?? "";
    assertAllowedService(service);
    const { stdout } = await execFileAsync("systemctl", ["is-active", service]);
    return stdout.trim();
  },

  "service.restart": async (args) => {
    const service = args.service ?? "";
    assertAllowedService(service);
    const { stdout, stderr } = await execFileAsync("systemctl", ["restart", service]);
    return stdout + stderr;
  },
};
