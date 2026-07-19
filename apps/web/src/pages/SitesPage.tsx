import { useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
import "./SitesPage.css";

interface Site {
  name: string;
  enabled: boolean;
  serverNames: string[];
  listenPorts: number[];
  sslEnabled: boolean;
  root: string | null;
  proxyPass: string | null;
}

function icon(children: React.ReactNode) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const RefreshIcon = () => icon(<><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></>);

export default function SitesPage() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [togglingName, setTogglingName] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  async function load() {
    try {
      const data = await apiFetch("/sites");
      setSites(data.sites);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sites");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleToggle(site: Site) {
    if (site.enabled) {
      const primary = site.serverNames[0] ?? site.name;
      if (!window.confirm(`Disable ${primary}? This takes the site offline immediately.`)) return;
    }

    setError(null);
    setTogglingName(site.name);
    try {
      await apiFetch(`/sites/${encodeURIComponent(site.name)}/${site.enabled ? "disable" : "enable"}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setTogglingName(null);
    }
  }

  async function handleReload() {
    setError(null);
    setReloading(true);
    try {
      await apiFetch("/sites/reload", { method: "POST" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reload failed");
    } finally {
      setReloading(false);
    }
  }

  return (
    <AppShell title="Sites">
      <div className="sites-toolbar">
        <button className="btn" onClick={handleReload} disabled={reloading}>
          <RefreshIcon /> {reloading ? "Reloading…" : "Reload Nginx"}
        </button>
      </div>

      {error && <div className="error-toast">{error}</div>}

      {!sites ? (
        <p>Loading sites…</p>
      ) : sites.length === 0 ? (
        <div className="empty-state">No Nginx site configs found in sites-available.</div>
      ) : (
        <div className="site-list">
          {sites.map((site) => {
            const primary = site.serverNames[0] ?? site.name;
            const extra = site.serverNames.length - 1;
            const type = site.proxyPass ? "Reverse proxy" : site.root ? "Static site" : "Unknown";
            const target = site.proxyPass ?? site.root ?? "—";
            const busy = togglingName === site.name;

            return (
              <div className={`site-card ${site.enabled ? "" : "disabled-site"}`} key={site.name}>
                <div className="site-main">
                  <div className="site-domains">
                    <span className="site-domain-name">{primary}</span>
                    {extra > 0 && <span className="site-domain-extra">+{extra} more</span>}
                    <span className={`badge ${site.enabled ? "badge-success" : "badge-neutral"}`}>{site.enabled ? "Enabled" : "Disabled"}</span>
                    {site.sslEnabled && <span className="badge badge-info">SSL</span>}
                    <span className="badge badge-neutral">{type}</span>
                  </div>
                  <div className="site-meta-row">
                    <span className="site-target">{target}</span>
                    {site.listenPorts.length > 0 && <span>· ports {site.listenPorts.join(", ")}</span>}
                    <span>·</span>
                    <span className="site-filename">{site.name}</span>
                  </div>
                </div>

                <div className="site-actions">
                  <label className="switch" title={site.enabled ? "Disable site" : "Enable site"}>
                    <input type="checkbox" checked={site.enabled} disabled={busy} onChange={() => handleToggle(site)} />
                    <span className="switch-track" />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
