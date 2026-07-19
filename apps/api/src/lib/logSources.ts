import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface LogSource {
  id: string;
  label: string;
}

const STATIC_SOURCES: Record<string, string> = {
  "nginx-access": "/var/log/nginx/access.log",
  "nginx-error": "/var/log/nginx/error.log",
};

interface Pm2Process {
  name: string;
  pm2_env: { pm_out_log_path: string; pm_err_log_path: string };
}

async function getPm2Sources(): Promise<Record<string, string>> {
  try {
    const { stdout } = await execFileAsync("pm2", ["jlist"]);
    const processes = JSON.parse(stdout) as Pm2Process[];
    const sources: Record<string, string> = {};
    for (const p of processes) {
      sources[`pm2-${p.name}-out`] = p.pm2_env.pm_out_log_path;
      sources[`pm2-${p.name}-error`] = p.pm2_env.pm_err_log_path;
    }
    return sources;
  } catch {
    return {};
  }
}

function labelFor(id: string): string {
  if (id === "nginx-access") return "Nginx · Access";
  if (id === "nginx-error") return "Nginx · Error";
  const m = id.match(/^pm2-(.+)-(out|error)$/);
  if (m) return `PM2 · ${m[1]} · ${m[2]}`;
  return id;
}

/**
 * The only file paths this module will ever read are the ones enumerated
 * here - PM2 log paths come from `pm2 jlist`, never from client input, so a
 * source id can't be used to smuggle in an arbitrary path.
 */
export async function listLogSources(): Promise<LogSource[]> {
  const all = { ...STATIC_SOURCES, ...(await getPm2Sources()) };
  return Object.keys(all)
    .map((id) => ({ id, label: labelFor(id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function resolveLogPath(id: string): Promise<string | null> {
  if (STATIC_SOURCES[id]) return STATIC_SOURCES[id];
  const pm2Sources = await getPm2Sources();
  return pm2Sources[id] ?? null;
}
