import fs from "node:fs/promises";
import path from "node:path";

const SITES_AVAILABLE = "/etc/nginx/sites-available";
const SITES_ENABLED = "/etc/nginx/sites-enabled";

export interface Site {
  name: string;
  enabled: boolean;
  serverNames: string[];
  listenPorts: number[];
  sslEnabled: boolean;
  root: string | null;
  proxyPass: string | null;
}

// Not real nginx grammar - just enough to read the flat, mostly-Certbot-generated
// configs this panel is meant to manage. Good enough for display purposes.
function parseConfig(text: string): Omit<Site, "name" | "enabled"> {
  const serverNames = new Set<string>();
  for (const m of text.matchAll(/^\s*server_name\s+([^;]+);/gm)) {
    for (const token of m[1].trim().split(/\s+/)) {
      if (token !== "_") serverNames.add(token);
    }
  }

  const listenPorts = new Set<number>();
  let sslEnabled = false;
  for (const m of text.matchAll(/^\s*listen\s+([^;]+);/gm)) {
    const clause = m[1];
    if (/\bssl\b/.test(clause)) sslEnabled = true;
    const portMatch = clause.match(/(\d+)/);
    if (portMatch) listenPorts.add(Number(portMatch[1]));
  }
  if (/^\s*ssl_certificate\s+/m.test(text)) sslEnabled = true;

  const rootMatch = text.match(/^\s*root\s+([^;]+);/m);
  const proxyMatch = text.match(/^\s*proxy_pass\s+([^;]+);/m);

  return {
    serverNames: [...serverNames],
    listenPorts: [...listenPorts].sort((a, b) => a - b),
    sslEnabled,
    root: rootMatch ? rootMatch[1].trim() : null,
    proxyPass: proxyMatch ? proxyMatch[1].trim() : null,
  };
}

export async function listSites(): Promise<Site[]> {
  const [availableFiles, enabledFiles] = await Promise.all([
    fs.readdir(SITES_AVAILABLE).catch(() => []),
    fs.readdir(SITES_ENABLED).catch(() => []),
  ]);

  const enabledSet = new Set(enabledFiles);

  const sites = await Promise.all(
    availableFiles.map(async (name): Promise<Site> => {
      const text = await fs.readFile(path.join(SITES_AVAILABLE, name), "utf8").catch(() => "");
      return {
        name,
        enabled: enabledSet.has(name),
        ...parseConfig(text),
      };
    })
  );

  return sites.sort((a, b) => a.name.localeCompare(b.name));
}
