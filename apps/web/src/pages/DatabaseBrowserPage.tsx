import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
import "./DatabaseBrowserPage.css";

interface TableRef {
  schema: string;
  table: string;
}

interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
  isPrimaryKey: boolean;
}

type Row = Record<string, unknown>;

const PAGE_SIZE = 50;

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function tableKey(ref: TableRef) {
  return `${ref.schema}.${ref.table}`;
}

export default function DatabaseBrowserPage() {
  const { name = "" } = useParams<{ name: string }>();

  const [tables, setTables] = useState<TableRef[] | null>(null);
  const [selected, setSelected] = useState<TableRef | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[] | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ rowIdx: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const [mode, setMode] = useState<"browse" | "sql">("browse");
  const [sqlText, setSqlText] = useState("");
  const [sqlBusy, setSqlBusy] = useState(false);
  const [sqlResult, setSqlResult] = useState<{ columns: string[]; rows: Row[]; rowCount: number } | null>(null);

  useEffect(() => {
    apiFetch(`/databases/${encodeURIComponent(name)}/tables`)
      .then((data) => {
        setTables(data.tables);
        if (data.tables.length > 0) setSelected(data.tables[0]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load tables"));
  }, [name]);

  async function loadRows(ref: TableRef, p: number, sc: string | null, sd: "asc" | "desc") {
    setError(null);
    try {
      const [colsData, rowsData] = await Promise.all([
        apiFetch(`/databases/${encodeURIComponent(name)}/tables/${ref.schema}/${ref.table}/columns`),
        apiFetch(
          `/databases/${encodeURIComponent(name)}/tables/${ref.schema}/${ref.table}/rows?limit=${PAGE_SIZE}&offset=${p * PAGE_SIZE}${
            sc ? `&sort=${encodeURIComponent(sc)}&dir=${sd}` : ""
          }`
        ),
      ]);
      setColumns(colsData.columns);
      setRows(rowsData.rows);
      setTotal(rowsData.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load table data");
    }
  }

  useEffect(() => {
    if (!selected) return;
    setPage(0);
    setSortCol(null);
    setEditing(null);
    setAdding(false);
    loadRows(selected, 0, null, "asc");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected && tableKey(selected)]);

  function handleSort(col: string) {
    if (!selected) return;
    const nextDir = sortCol === col && sortDir === "asc" ? "desc" : "asc";
    setSortCol(col);
    setSortDir(nextDir);
    loadRows(selected, page, col, nextDir);
  }

  function changePage(delta: number) {
    if (!selected) return;
    const next = Math.max(0, page + delta);
    setPage(next);
    loadRows(selected, next, sortCol, sortDir);
  }

  function rowPk(row: Row): Record<string, unknown> {
    const pk: Record<string, unknown> = {};
    for (const c of columns ?? []) {
      if (c.isPrimaryKey) pk[c.name] = row[c.name];
    }
    return pk;
  }

  function startEdit(rowIdx: number, col: ColumnInfo, row: Row) {
    if (col.isPrimaryKey) return;
    setEditing({ rowIdx, col: col.name });
    setEditValue(formatCell(row[col.name]));
  }

  async function commitEdit(row: Row) {
    if (!editing || !selected) return;
    const { rowIdx, col } = editing;
    setEditing(null);

    const original = formatCell(row[col]);
    if (editValue === original) return;

    setError(null);
    try {
      const value = editValue.trim() === "" ? null : editValue;
      const { row: updated } = await apiFetch(`/databases/${encodeURIComponent(name)}/tables/${selected.schema}/${selected.table}/rows`, {
        method: "PATCH",
        body: JSON.stringify({ pk: rowPk(row), changes: { [col]: value } }),
      });
      setRows((prev) => {
        if (!prev) return prev;
        const next = [...prev];
        next[rowIdx] = updated;
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save change");
    }
  }

  async function handleDeleteRow(row: Row) {
    if (!selected) return;
    if (!window.confirm(`Delete this row? ${JSON.stringify(rowPk(row))}`)) return;

    setError(null);
    try {
      await apiFetch(`/databases/${encodeURIComponent(name)}/tables/${selected.schema}/${selected.table}/rows`, {
        method: "DELETE",
        body: JSON.stringify({ pk: rowPk(row) }),
      });
      await loadRows(selected, page, sortCol, sortDir);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete row");
    }
  }

  async function handleSaveNewRow() {
    if (!selected) return;
    setError(null);
    try {
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(draft)) {
        if (v.trim() !== "") values[k] = v;
      }
      await apiFetch(`/databases/${encodeURIComponent(name)}/tables/${selected.schema}/${selected.table}/rows`, {
        method: "POST",
        body: JSON.stringify({ values }),
      });
      setAdding(false);
      setDraft({});
      await loadRows(selected, page, sortCol, sortDir);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to insert row");
    }
  }

  async function runQuery() {
    setSqlBusy(true);
    setError(null);
    setSqlResult(null);
    try {
      const result = await apiFetch(`/databases/${encodeURIComponent(name)}/query`, { method: "POST", body: JSON.stringify({ sql: sqlText }) });
      setSqlResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setSqlBusy(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AppShell title={`Database: ${name}`}>
      {error && <div className="error-toast">{error}</div>}

      <div className="browser-toolbar">
        <div className="mode-tabs">
          <button className={`mode-tab ${mode === "browse" ? "active" : ""}`} onClick={() => setMode("browse")}>
            Tables
          </button>
          <button className={`mode-tab ${mode === "sql" ? "active" : ""}`} onClick={() => setMode("sql")}>
            SQL Query
          </button>
        </div>
        {mode === "browse" && selected && (
          <button className="btn btn-primary" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "+ Add row"}
          </button>
        )}
      </div>

      {mode === "sql" ? (
        <div className="sql-console">
          <textarea
            className="sql-textarea"
            placeholder="SELECT * FROM your_table LIMIT 100;"
            value={sqlText}
            onChange={(e) => setSqlText(e.target.value)}
          />
          <div>
            <button className="btn btn-primary" onClick={runQuery} disabled={sqlBusy || !sqlText.trim()}>
              {sqlBusy ? "Running…" : "Run query"}
            </button>
          </div>
          {sqlResult && (
            <div className="data-grid-wrap">
              <div className="grid-toolbar">{sqlResult.rowCount} row(s)</div>
              <table className="data-grid">
                <thead>
                  <tr>
                    {sqlResult.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sqlResult.rows.map((r, i) => (
                    <tr key={i}>
                      {sqlResult.columns.map((c) => (
                        <td key={c}>
                          <span className="cell-content">{formatCell(r[c])}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="browser-layout">
          <div className="table-rail">
            <div className="table-rail-header">Tables ({tables?.length ?? 0})</div>
            {tables?.map((t) => (
              <button
                key={tableKey(t)}
                className={`table-rail-item ${selected && tableKey(selected) === tableKey(t) ? "active" : ""}`}
                onClick={() => setSelected(t)}
              >
                {t.schema === "public" ? t.table : `${t.schema}.${t.table}`}
              </button>
            ))}
          </div>

          <div className="browser-main">
            {!selected || !columns || !rows ? (
              <p>Loading…</p>
            ) : (
              <div className="data-grid-wrap">
                <div className="grid-toolbar">
                  <span>{total} row(s)</span>
                </div>
                <table className="data-grid">
                  <thead>
                    <tr>
                      {columns.map((c) => (
                        <th key={c.name} onClick={() => handleSort(c.name)}>
                          {c.name}
                          {c.isPrimaryKey ? " 🔑" : ""}
                          {sortCol === c.name ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                          <span className="col-type">{c.dataType}</span>
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {adding && (
                      <tr>
                        {columns.map((c) => (
                          <td key={c.name}>
                            <input
                              className="cell-input"
                              placeholder={c.isNullable ? "NULL" : c.name}
                              value={draft[c.name] ?? ""}
                              onChange={(e) => setDraft((prev) => ({ ...prev, [c.name]: e.target.value }))}
                            />
                          </td>
                        ))}
                        <td>
                          <button className="unban-btn" onClick={handleSaveNewRow}>
                            Save
                          </button>
                        </td>
                      </tr>
                    )}
                    {rows.map((row, rowIdx) => (
                      <tr key={rowIdx}>
                        {columns.map((c) => {
                          const isEditing = editing?.rowIdx === rowIdx && editing.col === c.name;
                          const raw = row[c.name];
                          return (
                            <td key={c.name}>
                              {isEditing ? (
                                <input
                                  className="cell-input"
                                  autoFocus
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={() => commitEdit(row)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                    if (e.key === "Escape") setEditing(null);
                                  }}
                                />
                              ) : (
                                <span
                                  className={`cell-content ${c.isPrimaryKey ? "pk" : ""} ${raw === null ? "null-value" : ""}`}
                                  onClick={() => startEdit(rowIdx, c, row)}
                                >
                                  {raw === null ? "NULL" : formatCell(raw)}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td>
                          <button className="unban-btn" onClick={() => handleDeleteRow(row)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="pagination">
                  <button className="btn" onClick={() => changePage(-1)} disabled={page === 0}>
                    Prev
                  </button>
                  <span>
                    Page {page + 1} of {totalPages}
                  </span>
                  <button className="btn" onClick={() => changePage(1)} disabled={page + 1 >= totalPages}>
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
