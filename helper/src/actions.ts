import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

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

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/;
const JAIL_NAME_RE = /^[a-zA-Z0-9._-]+$/;

function assertValidIp(ip: string) {
  if (!IP_RE.test(ip)) throw new Error(`invalid IP/CIDR "${ip}"`);
}

function assertValidPort(port: string) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`invalid port "${port}"`);
}

function assertValidProto(proto: string) {
  if (proto !== "tcp" && proto !== "udp") throw new Error(`invalid protocol "${proto}"`);
}

function assertValidRuleNumber(n: string) {
  if (!/^\d+$/.test(n)) throw new Error(`invalid rule number "${n}"`);
}

function assertValidJailName(jail: string) {
  if (!jail || !JAIL_NAME_RE.test(jail)) throw new Error(`invalid jail name "${jail}"`);
}

const DB_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
const PROTECTED_DBS = new Set(["postgres", "template0", "template1", "panel"]);
const DUMP_DIR = "/tmp/panel-dumps";
// Must match the OS user panel-api actually runs as, so it can read dump
// files back after pg_dump (which runs as "postgres") writes them.
const PANEL_OS_USER = process.env.PANEL_OS_USER ?? "ubuntu";

function assertValidDbName(name: string) {
  if (!name || !DB_NAME_RE.test(name)) throw new Error(`invalid database name "${name}"`);
}

function assertNotProtected(name: string) {
  if (PROTECTED_DBS.has(name)) throw new Error(`"${name}" is a protected database and cannot be dropped`);
}

async function psql(sql: string) {
  return execFileAsync("sudo", ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

const DOMAIN_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertValidDomain(domain: string) {
  if (!domain || !DOMAIN_RE.test(domain)) throw new Error(`invalid domain "${domain}"`);
}

function assertValidEmail(email: string) {
  if (!email || !EMAIL_RE.test(email)) throw new Error(`invalid email "${email}"`);
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

  "nginx.createSite": async (args) => {
    const name = args.name ?? "";
    const content = args.content ?? "";
    assertValidSiteName(name);
    if (!content.trim()) throw new Error("empty config content");

    const availablePath = path.join(SITES_AVAILABLE, name);
    const enabledPath = path.join(SITES_ENABLED, name);

    if (await pathExists(availablePath)) {
      throw new Error(`"${name}" already exists in sites-available`);
    }

    await fs.writeFile(availablePath, content, { flag: "wx" });

    try {
      await fs.symlink(availablePath, enabledPath);
      const test = await testNginxConfig();
      if (!test.ok) throw new Error(`nginx config test failed: ${test.output}`);
      await execFileAsync("systemctl", ["reload", "nginx"]);
    } catch (err) {
      // Neither the symlink nor the config file existed before this call,
      // so a failed test rolls back both rather than leaving an orphan.
      await fs.unlink(enabledPath).catch(() => {});
      await fs.unlink(availablePath).catch(() => {});
      throw err;
    }

    return `${name} created and enabled`;
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

  "ufw.status": async () => {
    const { stdout } = await execFileAsync("ufw", ["status", "numbered"]);
    return stdout;
  },

  "ufw.enable": async () => {
    const { stdout, stderr } = await execFileAsync("ufw", ["--force", "enable"]);
    return stdout + stderr;
  },

  "ufw.disable": async () => {
    const { stdout, stderr } = await execFileAsync("ufw", ["disable"]);
    return stdout + stderr;
  },

  "ufw.allow": async (args) => {
    const port = args.port ?? "";
    const proto = args.proto ?? "";
    assertValidPort(port);
    assertValidProto(proto);
    const { stdout, stderr } = await execFileAsync("ufw", ["allow", `${port}/${proto}`]);
    return stdout + stderr;
  },

  "ufw.deny": async (args) => {
    const ip = args.ip ?? "";
    assertValidIp(ip);
    const { stdout, stderr } = await execFileAsync("ufw", ["deny", "from", ip]);
    return stdout + stderr;
  },

  "ufw.delete": async (args) => {
    const number = args.number ?? "";
    assertValidRuleNumber(number);
    const { stdout, stderr } = await execFileAsync("ufw", ["--force", "delete", number]);
    return stdout + stderr;
  },

  "fail2ban.install": async () => {
    await execFileAsync("apt-get", ["install", "-y", "fail2ban"]);
    await execFileAsync("systemctl", ["enable", "--now", "fail2ban"]);
    return "fail2ban installed and started";
  },

  "fail2ban.status": async () => {
    const { stdout } = await execFileAsync("fail2ban-client", ["status"]);
    return stdout;
  },

  "fail2ban.jailStatus": async (args) => {
    const jail = args.jail ?? "";
    assertValidJailName(jail);
    const { stdout } = await execFileAsync("fail2ban-client", ["status", jail]);
    return stdout;
  },

  "fail2ban.ban": async (args) => {
    const jail = args.jail ?? "";
    const ip = args.ip ?? "";
    assertValidJailName(jail);
    assertValidIp(ip);
    const { stdout } = await execFileAsync("fail2ban-client", ["set", jail, "banip", ip]);
    return stdout;
  },

  "fail2ban.unban": async (args) => {
    const jail = args.jail ?? "";
    const ip = args.ip ?? "";
    assertValidJailName(jail);
    assertValidIp(ip);
    const { stdout } = await execFileAsync("fail2ban-client", ["set", jail, "unbanip", ip]);
    return stdout;
  },

  "db.list": async () => {
    const { stdout } = await execFileAsync("sudo", [
      "-u",
      "postgres",
      "psql",
      "-tA",
      "-F",
      "\t",
      "-c",
      "SELECT datname, pg_catalog.pg_get_userbyid(datdba), pg_size_pretty(pg_database_size(datname)) FROM pg_database WHERE datistemplate = false ORDER BY datname;",
    ]);
    return stdout;
  },

  "db.create": async (args) => {
    const name = args.name ?? "";
    assertValidDbName(name);

    const password = crypto.randomBytes(18).toString("base64").replace(/[/+=]/g, "");
    await psql(`CREATE ROLE "${name}" LOGIN PASSWORD '${password}';`);
    try {
      await psql(`CREATE DATABASE "${name}" OWNER "${name}";`);
    } catch (err) {
      // Roll back the role so a failed create doesn't leave an orphan login.
      await psql(`DROP ROLE IF EXISTS "${name}";`).catch(() => {});
      throw err;
    }

    return `${name}\t${password}`;
  },

  "db.drop": async (args) => {
    const name = args.name ?? "";
    assertValidDbName(name);
    assertNotProtected(name);

    // A DB with active connections can't be dropped - terminate them first,
    // same as any admin would need to before running DROP DATABASE by hand.
    await psql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}';`).catch(() => {});
    await psql(`DROP DATABASE "${name}";`);
    return `${name} dropped`;
  },

  "db.dump": async (args) => {
    const name = args.name ?? "";
    assertValidDbName(name);

    // Both "postgres" (pg_dump) and the panel's own OS user need to write/
    // read here, so the directory itself is sticky-bit world-writable like
    // /tmp - each individual dump file is still locked to 640 right after
    // it's created, which is the actual access boundary.
    await fs.mkdir(DUMP_DIR, { recursive: true, mode: 0o1777 });
    await fs.chmod(DUMP_DIR, 0o1777);
    const filename = `${name}-${Date.now()}.sql`;
    const fullPath = path.join(DUMP_DIR, filename);

    await execFileAsync("sudo", ["-u", "postgres", "pg_dump", "-f", fullPath, name]);
    // pg_dump ran as postgres, so the dump file is owned by postgres - hand
    // it back to the unprivileged panel user so the API process can read it.
    await execFileAsync("chown", [`${PANEL_OS_USER}:${PANEL_OS_USER}`, fullPath]);
    await fs.chmod(fullPath, 0o640);

    return filename;
  },

  "certbot.list": async () => {
    const { stdout } = await execFileAsync("certbot", ["certificates"]);
    return stdout;
  },

  "certbot.renew": async (args) => {
    const certName = args.certName ?? "";
    assertValidDomain(certName);
    // Certbot's own renew command is a safe no-op unless the cert is
    // actually within its renewal window (~30 days of expiry) - it doesn't
    // hit Let's Encrypt at all otherwise.
    const { stdout, stderr } = await execFileAsync("certbot", ["renew", "--cert-name", certName, "--non-interactive"]);
    return stdout + stderr;
  },

  "certbot.obtain": async (args) => {
    const domain = args.domain ?? "";
    const email = args.email ?? "";
    assertValidDomain(domain);
    assertValidEmail(email);
    // Requires an existing nginx server block whose server_name matches
    // `domain` - the --nginx plugin edits that block in place to add SSL.
    const { stdout, stderr } = await execFileAsync("certbot", [
      "--nginx",
      "-d",
      domain,
      "--non-interactive",
      "--agree-tos",
      "-m",
      email,
      "--redirect",
    ]);
    return stdout + stderr;
  },
};
