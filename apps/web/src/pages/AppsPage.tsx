import { useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
import "./AppsPage.css";

interface Pm2App {
  name: string;
  status: string;
  pid: number;
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
  protected: boolean;
}

function fmtMemory(bytes: number): string {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtUptime(startedAtMs: number, status: string): string {
  if (status !== "online" || !startedAtMs) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function statusBadge(status: string) {
  if (status === "online") return <span className="badge badge-success">Online</span>;
  if (status === "stopped") return <span className="badge badge-neutral">Stopped</span>;
  return <span className="badge badge-danger">{status}</span>;
}

export default function AppsPage() {
  const [apps, setApps] = useState<Pm2App[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);

  const [deployPath, setDeployPath] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installOutput, setInstallOutput] = useState<string | null>(null);

  const [startName, setStartName] = useState("");
  const [startScript, setStartScript] = useState("");
  const [starting, setStarting] = useState(false);

  async function load() {
    setError(null);
    try {
      const data = await apiFetch("/apps");
      setApps(data.apps);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load apps");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleInstall() {
    if (!deployPath.trim()) return;
    setError(null);
    setInstalling(true);
    setInstallOutput(null);
    try {
      const result = await apiFetch("/apps/install", { method: "POST", body: JSON.stringify({ path: deployPath }) });
      setInstallOutput(result.output || "(no output)");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Install failed");
    } finally {
      setInstalling(false);
    }
  }

  async function handleStart() {
    if (!deployPath.trim() || !startName.trim() || !startScript.trim()) return;
    setError(null);
    setStarting(true);
    try {
      await apiFetch("/apps/start", { method: "POST", body: JSON.stringify({ name: startName, path: deployPath, script: startScript }) });
      setStartName("");
      setStartScript("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start app");
    } finally {
      setStarting(false);
    }
  }

  async function handleAction(name: string, action: "stop" | "restart") {
    setError(null);
    setBusyName(name);
    try {
      await apiFetch(`/apps/${encodeURIComponent(name)}/${action}`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setBusyName(null);
    }
  }

  async function handleDelete(app: Pm2App) {
    if (!window.confirm(`Delete PM2 process "${app.name}"? This stops it and removes it from PM2 (the files on disk are untouched).`)) return;
    setError(null);
    setBusyName(app.name);
    try {
      await apiFetch(`/apps/${encodeURIComponent(app.name)}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusyName(null);
    }
  }

  return (
    <AppShell title="Apps">
      {error && <div className="error-toast">{error}</div>}

      <div className="deploy-section">
        <h2>Deploy a Node.js app</h2>
        <p className="deploy-hint">
          Upload your project via File Manager first (or extract a .zip there), then point to it here. Set the app's port in its own .env file
          (also editable in File Manager) before starting - the panel doesn't inject one. Once running, add a reverse-proxy config from Sites and
          SSL from Domains &amp; SSL.
        </p>

        <div className="deploy-row">
          <input placeholder="/path/relative/to/Hosted Apps, e.g. /my-new-app" value={deployPath} onChange={(e) => setDeployPath(e.target.value)} />
          <button className="btn" onClick={handleInstall} disabled={installing || !deployPath.trim()}>
            {installing ? "Installing…" : "Install Dependencies (npm install)"}
          </button>
        </div>

        {installOutput !== null && <pre className="install-output">{installOutput}</pre>}

        <div className="deploy-row">
          <input placeholder="Process name, e.g. my-app" value={startName} onChange={(e) => setStartName(e.target.value)} />
          <input placeholder="Entry script, e.g. index.js or src/index.js" value={startScript} onChange={(e) => setStartScript(e.target.value)} />
          <button className="btn btn-primary" onClick={handleStart} disabled={starting || !deployPath.trim() || !startName.trim() || !startScript.trim()}>
            {starting ? "Starting…" : "Start as PM2 App"}
          </button>
        </div>
      </div>

      <div className="apps-section-title">Running Processes</div>

      {!apps ? (
        <p>Loading…</p>
      ) : (
        <table className="rules-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>CPU</th>
              <th>Memory</th>
              <th>Uptime</th>
              <th>Restarts</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.name}>
                <td className="db-name-cell">{a.name}</td>
                <td>{statusBadge(a.status)}</td>
                <td>{a.cpu}%</td>
                <td>{fmtMemory(a.memory)}</td>
                <td>{fmtUptime(a.uptime, a.status)}</td>
                <td>{a.restarts}</td>
                <td>
                  <div className="row-actions">
                    {a.status === "online" ? (
                      <button className="unban-btn" onClick={() => handleAction(a.name, "stop")} disabled={a.protected || busyName === a.name}>
                        Stop
                      </button>
                    ) : (
                      <button className="unban-btn" onClick={() => handleAction(a.name, "restart")} disabled={a.protected || busyName === a.name}>
                        Start
                      </button>
                    )}
                    <button className="unban-btn" onClick={() => handleAction(a.name, "restart")} disabled={a.protected || busyName === a.name}>
                      Restart
                    </button>
                    <button className="unban-btn" onClick={() => handleDelete(a)} disabled={a.protected || busyName === a.name}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}
