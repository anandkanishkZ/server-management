import { useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
import "./AuditLogPage.css";

interface AuditEntry {
  id: string;
  action: string;
  target: string | null;
  payload: unknown;
  ip: string | null;
  createdAt: string;
  userEmail: string | null;
}

interface ActionCount {
  action: string;
  count: number;
}

const PAGE_SIZE = 50;

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function actionCategory(action: string): string {
  return action.split(".")[0];
}

function categoryBadgeClass(category: string): string {
  if (category === "auth") return "badge-info";
  if (["database", "file"].includes(category)) return "badge-neutral";
  if (["firewall", "fail2ban"].includes(category)) return "badge-danger";
  return "badge-success";
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [actions, setActions] = useState<ActionCount[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/audit/actions")
      .then((data) => setActions(data.actions))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setError(null);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    if (actionFilter) params.set("action", actionFilter);
    if (search.trim()) params.set("search", search.trim());

    const handle = setTimeout(() => {
      apiFetch(`/audit?${params.toString()}`)
        .then((data) => {
          setEntries(data.entries);
          setTotal(data.total);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Failed to load audit log"));
    }, 200);

    return () => clearTimeout(handle);
  }, [page, actionFilter, search]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AppShell title="Audit Log">
      {error && <div className="error-toast">{error}</div>}

      <div className="audit-toolbar">
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All actions ({actions.reduce((sum, a) => sum + a.count, 0)})</option>
          {actions.map((a) => (
            <option key={a.action} value={a.action}>
              {a.action} ({a.count})
            </option>
          ))}
        </select>
        <input
          placeholder="Search target or action…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
      </div>

      {!entries ? (
        <p>Loading…</p>
      ) : entries.length === 0 ? (
        <div className="empty-state">No audit entries match.</div>
      ) : (
        <>
          <table className="rules-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Target</th>
                <th>IP</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="audit-time">{fmtTime(e.createdAt)}</td>
                  <td className="audit-user">{e.userEmail ?? "—"}</td>
                  <td>
                    <span className={`badge ${categoryBadgeClass(actionCategory(e.action))} audit-action`}>{e.action}</span>
                  </td>
                  <td className="audit-target" title={e.target ?? ""}>
                    {e.target ?? "—"}
                  </td>
                  <td className="audit-user">{e.ip ?? "—"}</td>
                  <td className="audit-payload" title={e.payload ? JSON.stringify(e.payload, null, 2) : ""}>
                    {e.payload ? JSON.stringify(e.payload) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pagination">
            <button className="btn" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
              Prev
            </button>
            <span>
              Page {page + 1} of {totalPages} ({total} entries)
            </span>
            <button className="btn" onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= totalPages}>
              Next
            </button>
          </div>
        </>
      )}
    </AppShell>
  );
}
