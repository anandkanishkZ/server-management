import { useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";

interface DomainInfo {
  domain: string;
  hasCert: boolean;
  certName: string | null;
  expiryDate: string | null;
  daysRemaining: number | null;
  valid: boolean;
}

function statusBadge(d: DomainInfo) {
  if (!d.hasCert) return <span className="badge badge-neutral">No SSL</span>;
  if (!d.valid) return <span className="badge badge-danger">Expired</span>;
  if (d.daysRemaining !== null && d.daysRemaining <= 14) return <span className="badge badge-danger">Expiring soon</span>;
  if (d.daysRemaining !== null && d.daysRemaining <= 30) return <span className="badge badge-info">Renewing soon</span>;
  return <span className="badge badge-success">Valid</span>;
}

export default function DomainsPage() {
  const [domains, setDomains] = useState<DomainInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const data = await apiFetch("/domains");
      setDomains(data.domains);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load domains");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRenew(d: DomainInfo) {
    if (!d.certName) return;
    setBusy(d.domain);
    setError(null);
    try {
      const result = await apiFetch(`/domains/${encodeURIComponent(d.certName)}/renew`, { method: "POST" });
      window.alert(result.output || "Renewal check complete (no action needed if not yet due).");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Renewal failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleObtain(d: DomainInfo) {
    const email = window.prompt(
      `Issue a Let's Encrypt certificate for "${d.domain}"?\n\nThis requires ${d.domain} to already resolve (DNS) to this server. Enter a contact email for renewal notices:`
    );
    if (!email) return;

    setBusy(d.domain);
    setError(null);
    try {
      const result = await apiFetch("/domains/obtain", { method: "POST", body: JSON.stringify({ domain: d.domain, email }) });
      window.alert(result.output || "Certificate issued.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to obtain certificate");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell title="Domains & SSL">
      {error && <div className="error-toast">{error}</div>}

      {!domains ? (
        <p>Loading…</p>
      ) : domains.length === 0 ? (
        <div className="empty-state">No domains found across configured sites.</div>
      ) : (
        <table className="rules-table">
          <thead>
            <tr>
              <th>Domain</th>
              <th>SSL Status</th>
              <th>Expires</th>
              <th>Days left</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => (
              <tr key={d.domain}>
                <td className="db-name-cell">{d.domain}</td>
                <td>{statusBadge(d)}</td>
                <td>{d.expiryDate ? new Date(d.expiryDate).toLocaleDateString() : "—"}</td>
                <td>{d.daysRemaining ?? "—"}</td>
                <td>
                  {d.hasCert ? (
                    <button className="unban-btn" onClick={() => handleRenew(d)} disabled={busy === d.domain}>
                      {busy === d.domain ? "Working…" : "Renew"}
                    </button>
                  ) : (
                    <button className="unban-btn" onClick={() => handleObtain(d)} disabled={busy === d.domain}>
                      {busy === d.domain ? "Working…" : "Enable SSL"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}
