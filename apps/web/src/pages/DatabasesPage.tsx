import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
import { getAccessToken } from "../lib/authStore";
import { confirmDialog } from "../lib/dialogs";
import { toast } from "../lib/toast";
import "./DatabasesPage.css";

interface DatabaseInfo {
  name: string;
  owner: string;
  size: string;
}

const PROTECTED = new Set(["postgres", "panel"]);

export default function DatabasesPage() {
  const [databases, setDatabases] = useState<DatabaseInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [credentials, setCredentials] = useState<{ name: string; password: string } | null>(null);

  async function load() {
    try {
      const data = await apiFetch("/databases");
      setDatabases(data.databases);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load databases");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCredentials(null);
    try {
      const data = await apiFetch("/databases", { method: "POST", body: JSON.stringify({ name: newName }) });
      setCredentials(data);
      setNewName("");
      toast(`Database "${data.name}" created`, "success");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create database");
    }
  }

  async function handleDrop(db: DatabaseInfo) {
    const ok = await confirmDialog(`This permanently deletes all data in "${db.name}". This cannot be undone.`, {
      danger: true,
      confirmLabel: "Drop database",
      typeToConfirm: db.name,
    });
    if (!ok) return;

    setError(null);
    setBusyName(db.name);
    try {
      await apiFetch(`/databases/${encodeURIComponent(db.name)}`, { method: "DELETE" });
      toast(`"${db.name}" dropped`, "success");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to drop database");
    } finally {
      setBusyName(null);
    }
  }

  async function handleDump(db: DatabaseInfo) {
    setError(null);
    setBusyName(db.name);
    try {
      const { file } = await apiFetch(`/databases/${encodeURIComponent(db.name)}/dump`, { method: "POST" });

      const token = getAccessToken();
      const res = await fetch(`/api/databases/dumps/${encodeURIComponent(file)}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Dump created but download failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file;
      a.click();
      URL.revokeObjectURL(url);
      toast("Dump downloaded", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dump database");
    } finally {
      setBusyName(null);
    }
  }

  return (
    <AppShell title="Databases">
      {error && <div className="error-toast">{error}</div>}

      {credentials && (
        <div className="credentials-banner">
          <div className="credentials-banner-title">Database created</div>
          <div className="credentials-row">
            <span className="label">Database</span> {credentials.name}
          </div>
          <div className="credentials-row">
            <span className="label">Role</span> {credentials.name}
          </div>
          <div className="credentials-row">
            <span className="label">Password</span> {credentials.password}
          </div>
          <div className="credentials-warning">This password is shown once and isn't stored anywhere - copy it now.</div>
        </div>
      )}

      <form className="create-db-form" onSubmit={handleCreate}>
        <input placeholder="New database name" value={newName} onChange={(e) => setNewName(e.target.value)} required />
        <button type="submit" className="btn btn-primary">
          Create database
        </button>
      </form>

      {!databases ? (
        <p>Loading…</p>
      ) : (
        <table className="rules-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Owner</th>
              <th>Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {databases.map((db) => (
              <tr key={db.name}>
                <td className="db-name-cell">{db.name}</td>
                <td>{db.owner}</td>
                <td>{db.size}</td>
                <td>
                  <div className="row-actions">
                    <Link className="unban-btn" to={`/databases/${encodeURIComponent(db.name)}`}>
                      Browse
                    </Link>
                    <button className="unban-btn" onClick={() => handleDump(db)} disabled={busyName === db.name}>
                      Dump
                    </button>
                    {!PROTECTED.has(db.name) && (
                      <button className="unban-btn" onClick={() => handleDrop(db)} disabled={busyName === db.name}>
                        Drop
                      </button>
                    )}
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
