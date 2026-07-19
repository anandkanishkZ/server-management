import { useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
import { confirmDialog } from "../lib/dialogs";
import { toast } from "../lib/toast";
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

  const [showNewSite, setShowNewSite] = useState(false);
  const [newSiteType, setNewSiteType] = useState<"static" | "proxy">("proxy");
  const [newDomain, setNewDomain] = useState("");
  const [newAliases, setNewAliases] = useState("");
  const [newRoot, setNewRoot] = useState("");
  const [newPort, setNewPort] = useState("");
  const [creating, setCreating] = useState(false);

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
      const ok = await confirmDialog(`Disable ${primary}? This takes the site offline immediately.`, { danger: true, confirmLabel: "Disable" });
      if (!ok) return;
    }

    setError(null);
    setTogglingName(site.name);
    try {
      await apiFetch(`/sites/${encodeURIComponent(site.name)}/${site.enabled ? "disable" : "enable"}`, { method: "POST" });
      toast(`${site.serverNames[0] ?? site.name} ${site.enabled ? "disabled" : "enabled"}`, "success");
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
      toast("Nginx reloaded", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reload failed");
    } finally {
      setReloading(false);
    }
  }

  async function handleCreateSite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const aliasDomains = newAliases
        .split(/[,\s]+/)
        .map((a) => a.trim())
        .filter(Boolean);

      const body =
        newSiteType === "static"
          ? { type: "static", domain: newDomain, aliasDomains, root: newRoot }
          : { type: "proxy", domain: newDomain, aliasDomains, port: Number(newPort) };

      await apiFetch("/sites", { method: "POST", body: JSON.stringify(body) });
      toast(`${newDomain} created`, "success");
      setShowNewSite(false);
      setNewDomain("");
      setNewAliases("");
      setNewRoot("");
      setNewPort("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create site");
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell title="Sites">
      <div className="sites-toolbar">
        <button className="btn btn-primary" onClick={() => setShowNewSite((v) => !v)}>
          {showNewSite ? "Cancel" : "+ New Site"}
        </button>
        <button className="btn" onClick={handleReload} disabled={reloading}>
          <RefreshIcon /> {reloading ? "Reloading…" : "Reload Nginx"}
        </button>
      </div>

      {error && <div className="error-toast">{error}</div>}

      {showNewSite && (
        <form className="new-site-form" onSubmit={handleCreateSite}>
          <div className="rule-mode-tabs">
            <button type="button" className={`rule-mode-tab ${newSiteType === "proxy" ? "active" : ""}`} onClick={() => setNewSiteType("proxy")}>
              Reverse Proxy
            </button>
            <button type="button" className={`rule-mode-tab ${newSiteType === "static" ? "active" : ""}`} onClick={() => setNewSiteType("static")}>
              Static Site
            </button>
          </div>

          <div className="new-site-fields">
            <label>
              Domain
              <input placeholder="example.com" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} required />
            </label>
            <label>
              Alias domains (optional)
              <input placeholder="www.example.com" value={newAliases} onChange={(e) => setNewAliases(e.target.value)} />
            </label>
            {newSiteType === "proxy" ? (
              <label>
                Local port
                <input placeholder="3000" value={newPort} onChange={(e) => setNewPort(e.target.value)} required />
              </label>
            ) : (
              <label>
                Document root
                <input placeholder="/home/ubuntu/app/frontend/dist" value={newRoot} onChange={(e) => setNewRoot(e.target.value)} required />
              </label>
            )}
          </div>

          <p className="new-site-hint">
            Creates a plain HTTP (port 80) config, tests it with <code>nginx -t</code>, and enables it - rolled back automatically if the test
            fails. Add SSL afterward from the Domains &amp; SSL page.
          </p>

          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? "Creating…" : "Create Site"}
          </button>
        </form>
      )}

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
