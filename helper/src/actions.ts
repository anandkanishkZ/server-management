import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

// Only services the panel is allowed to control. Extend deliberately, never
// pass through an arbitrary service name from the caller.
const ALLOWED_SERVICES = new Set(["nginx", "mysql", "postgresql", "fail2ban"]);

function assertAllowedService(service: string) {
  if (!ALLOWED_SERVICES.has(service)) {
    throw new Error(`service "${service}" is not in the allowlist`);
  }
}

const SITES_AVAILABLE = "/etc/nginx/sites-available";
const SITES_ENABLED = "/etc/nginx/sites-enabled";
const SITE_NAME_RE = /^[a-zA-Z0-9._-]+$/;

function assertValidSiteName(name: string) {
  if (!name || !SITE_NAME_RE.test(name) || name.includes("..")) {
    throw new Error(`invalid site name "${name}"`);
  }
}

async function pathExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function testNginxConfig() {
  try {
    const { stdout, stderr } = await execFileAsync("nginx", ["-t"]);
    return { ok: true, output: stdout + stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return { ok: false, output: (e.stdout ?? "") + (e.stderr ?? e.message) };
  }
}

/**
 * Every entry here is a fixed function that calls execFile with an array of
 * arguments - never a template string handed to a shell. This is the entire
 * attack surface of the privileged helper, so keep it short and explicit.
 */
export const actions: Record<string, (args: Record<string, string>) => Promise<string>> = {
  "nginx.test": async () => {
    const result = await testNginxConfig();
    if (!result.ok) throw new Error(result.output);
    return result.output;
  },

  "nginx.reload": async () => {
    const { stdout, stderr } = await execFileAsync("systemctl", ["reload", "nginx"]);
    return stdout + stderr;
  },

  "nginx.enableSite": async (args) => {
    const name = args.name ?? "";
    assertValidSiteName(name);

    const availablePath = path.join(SITES_AVAILABLE, name);
    const enabledPath = path.join(SITES_ENABLED, name);

    if (!(await pathExists(availablePath))) {
      throw new Error(`"${name}" does not exist in sites-available`);
    }

    const alreadyEnabled = await pathExists(enabledPath);
    if (!alreadyEnabled) {
      await fs.symlink(availablePath, enabledPath);
    }

    const test = await testNginxConfig();
    if (!test.ok) {
      if (!alreadyEnabled) await fs.unlink(enabledPath).catch(() => {});
      throw new Error(`nginx config test failed, rolled back: ${test.output}`);
    }

    await execFileAsync("systemctl", ["reload", "nginx"]);
    return `${name} enabled and nginx reloaded`;
  },

  "nginx.disableSite": async (args) => {
    const name = args.name ?? "";
    assertValidSiteName(name);

    const enabledPath = path.join(SITES_ENABLED, name);
    if (await pathExists(enabledPath)) {
      await fs.unlink(enabledPath);
    }

    const test = await testNginxConfig();
    if (!test.ok) {
      throw new Error(`site disabled but nginx config test now fails: ${test.output}`);
    }

    await execFileAsync("systemctl", ["reload", "nginx"]);
    return `${name} disabled and nginx reloaded`;
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
