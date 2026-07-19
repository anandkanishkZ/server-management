import { useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
import "./SecurityPage.css";

interface UfwRule {
  number: number;
  action: string;
  target: string;
  from: string;
}

interface FirewallStatus {
  enabled: boolean;
  rules: UfwRule[];
}

interface JailSummary {
  name: string;
  currentlyFailed: number;
  totalFailed: number;
  currentlyBanned: number;
  totalBanned: number;
  bannedIps: string[];
}

export default function SecurityPage() {
  const [firewall, setFirewall] = useState<FirewallStatus | null>(null);
  const [fail2ban, setFail2ban] = useState<{ installed: boolean; jails: JailSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ruleMode, setRuleMode] = useState<"allow" | "deny">("allow");
  const [port, setPort] = useState("");
  const [proto, setProto] = useState("tcp");
  const [denyIp, setDenyIp] = useState("");
  const [banInputs, setBanInputs] = useState<Record<string, string>>({});

  async function loadAll() {
    try {
      const [fw, f2b] = await Promise.all([apiFetch("/security/firewall"), apiFetch("/security/fail2ban")]);
      setFirewall(fw);
      setFail2ban(f2b);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load security status");
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function withBusy(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  function handleEnable() {
    if (
      !window.confirm(
        "Enabling the firewall applies a default-deny policy immediately. Make sure SSH (22), HTTP (80/8080) and HTTPS (443) are already in the allow list below, or you may lose remote access to this server. Continue?"
      )
    )
      return;
    withBusy(async () => {
      await apiFetch("/security/firewall/enable", { method: "POST" });
      await loadAll();
    });
  }

  function handleDisable() {
    if (!window.confirm("Disable the firewall? All traffic will be allowed through until it's re-enabled.")) return;
    withBusy(async () => {
      await apiFetch("/security/firewall/disable", { method: "POST" });
      await loadAll();
    });
  }

  function handleAddRule(e: React.FormEvent) {
    e.preventDefault();
    withBusy(async () => {
      if (ruleMode === "allow") {
        await apiFetch("/security/firewall/allow", { method: "POST", body: JSON.stringify({ port: Number(port), proto }) });
        setPort("");
      } else {
        await apiFetch("/security/firewall/deny", { method: "POST", body: JSON.stringify({ ip: denyIp }) });
        setDenyIp("");
      }
      await loadAll();
    });
  }

  function handleDeleteRule(rule: UfwRule) {
    if (!window.confirm(`Delete rule #${rule.number} (${rule.action} ${rule.target} from ${rule.from})?`)) return;
    withBusy(async () => {
      await apiFetch(`/security/firewall/rules/${rule.number}`, { method: "DELETE" });
      await loadAll();
    });
  }

  function handleInstallFail2ban() {
    if (!window.confirm("Install Fail2Ban with the default SSH jail? This installs a new system package.")) return;
    withBusy(async () => {
      await apiFetch("/security/fail2ban/install", { method: "POST" });
      await loadAll();
    });
  }

  function handleUnban(jail: string, ip: string) {
    withBusy(async () => {
      await apiFetch(`/security/fail2ban/${jail}/unban`, { method: "POST", body: JSON.stringify({ ip }) });
      await loadAll();
    });
  }

  function handleBan(jail: string) {
    const ip = banInputs[jail];
    if (!ip) return;
    withBusy(async () => {
      await apiFetch(`/security/fail2ban/${jail}/ban`, { method: "POST", body: JSON.stringify({ ip }) });
      setBanInputs((prev) => ({ ...prev, [jail]: "" }));
      await loadAll();
    });
  }

  return (
    <AppShell title="Security">
      {error && <div className="error-toast">{error}</div>}

      <div className="security-section">
        <div className="security-section-header">
          <span className="security-section-title">
            Firewall (UFW)
            {firewall && <span className={`badge ${firewall.enabled ? "badge-success" : "badge-neutral"}`}>{firewall.enabled ? "Active" : "Inactive"}</span>}
          </span>
          <div className="security-actions">
            {firewall?.enabled ? (
              <button className="btn btn-danger" onClick={handleDisable} disabled={busy}>
                Disable Firewall
              </button>
            ) : (
              <button className="btn btn-primary" onClick={handleEnable} disabled={busy}>
                Enable Firewall
              </button>
            )}
          </div>
        </div>

        {!firewall ? (
          <p>Loading…</p>
        ) : (
          <>
            <table className="rules-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Action</th>
                  <th>To</th>
                  <th>From</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {firewall.rules.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No rules configured.</td>
                  </tr>
                ) : (
                  firewall.rules.map((rule) => (
                    <tr key={rule.number}>
                      <td>{rule.number}</td>
                      <td className={rule.action.includes("ALLOW") ? "rule-action-allow" : "rule-action-deny"}>{rule.action}</td>
                      <td>{rule.target}</td>
                      <td>{rule.from}</td>
                      <td>
                        <button className="unban-btn" onClick={() => handleDeleteRule(rule)} disabled={busy}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <form className="add-rule-form" onSubmit={handleAddRule}>
              <div className="rule-mode-tabs">
                <button type="button" className={`rule-mode-tab ${ruleMode === "allow" ? "active" : ""}`} onClick={() => setRuleMode("allow")}>
                  Allow port
                </button>
                <button type="button" className={`rule-mode-tab ${ruleMode === "deny" ? "active" : ""}`} onClick={() => setRuleMode("deny")}>
                  Block IP
                </button>
              </div>

              {ruleMode === "allow" ? (
                <>
                  <input placeholder="Port (e.g. 3000)" value={port} onChange={(e) => setPort(e.target.value)} required />
                  <select value={proto} onChange={(e) => setProto(e.target.value)}>
                    <option value="tcp">tcp</option>
                    <option value="udp">udp</option>
                  </select>
                </>
              ) : (
                <input placeholder="IP address (e.g. 1.2.3.4)" value={denyIp} onChange={(e) => setDenyIp(e.target.value)} required />
              )}

              <button type="submit" className="btn btn-primary" disabled={busy}>
                Add rule
              </button>
            </form>
          </>
        )}
      </div>

      <div className="security-section">
        <div className="security-section-header">
          <span className="security-section-title">Intrusion Prevention (Fail2Ban)</span>
        </div>

        {!fail2ban ? (
          <p>Loading…</p>
        ) : !fail2ban.installed ? (
          <div className="install-prompt">
            <p>Fail2Ban isn't installed on this server.</p>
            <button className="btn btn-primary" onClick={handleInstallFail2ban} disabled={busy}>
              Install Fail2Ban
            </button>
          </div>
        ) : (
          <div className="jail-grid">
            {fail2ban.jails.map((jail) => (
              <div className="jail-card" key={jail.name}>
                <div className="jail-name">{jail.name}</div>
                <div className="jail-stats">
                  <div className="jail-stat">
                    <span className="jail-stat-value">{jail.currentlyBanned}</span>
                    <span className="jail-stat-label">banned now</span>
                  </div>
                  <div className="jail-stat">
                    <span className="jail-stat-value">{jail.totalBanned}</span>
                    <span className="jail-stat-label">total banned</span>
                  </div>
                  <div className="jail-stat">
                    <span className="jail-stat-value">{jail.totalFailed}</span>
                    <span className="jail-stat-label">failed attempts</span>
                  </div>
                </div>

                {jail.bannedIps.map((ip) => (
                  <div className="banned-ip-row" key={ip}>
                    <span>{ip}</span>
                    <button className="unban-btn" onClick={() => handleUnban(jail.name, ip)} disabled={busy}>
                      Unban
                    </button>
                  </div>
                ))}

                <div className="ban-ip-form">
                  <input
                    placeholder="Ban an IP manually…"
                    value={banInputs[jail.name] ?? ""}
                    onChange={(e) => setBanInputs((prev) => ({ ...prev, [jail.name]: e.target.value }))}
                  />
                  <button className="btn" onClick={() => handleBan(jail.name)} disabled={busy}>
                    Ban
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
