import { useEffect, useRef, useState } from "react";
import AppShell from "../components/AppShell";
import { apiFetch } from "../lib/api";
import { getAccessToken } from "../lib/authStore";
import "./LogsPage.css";

interface LogSource {
  id: string;
  label: string;
}

const MAX_LINES = 1000;

function levelClass(line: string): string {
  if (/\berror\b|\[error\]/i.test(line)) return "level-error";
  if (/\bwarn(ing)?\b|\[warn\]/i.test(line)) return "level-warn";
  return "";
}

export default function LogsPage() {
  const [sources, setSources] = useState<LogSource[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch("/logs/sources")
      .then((data) => {
        setSources(data.sources);
        if (data.sources.length > 0) setSelected(data.sources[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load log sources"));
  }, []);

  useEffect(() => {
    if (!selected) return;

    setLines([]);
    setError(null);
    let ws: WebSocket | null = null;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const token = getAccessToken();
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${window.location.host}/api/logs/stream?source=${encodeURIComponent(selected!)}&token=${token}`);

      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "error") {
          setError(msg.message);
          return;
        }
        if (msg.type === "initial") {
          setLines(msg.lines);
        } else if (msg.type === "append") {
          setLines((prev) => {
            const next = [...prev, ...msg.lines];
            return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
          });
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) retryTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, [selected]);

  useEffect(() => {
    if (autoScroll && panelRef.current) {
      panelRef.current.scrollTop = panelRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const filteredLines = filter ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase())) : lines;

  const headerRight = (
    <span className={`live-pill ${connected ? "connected" : ""}`}>
      <span className="live-dot" />
      {connected ? "Live" : "Connecting…"}
    </span>
  );

  return (
    <AppShell title="Logs" headerRight={headerRight}>
      <div className="logs-toolbar">
        <div className="source-tabs">
          {sources?.map((s) => (
            <button key={s.id} className={`source-tab ${selected === s.id ? "active" : ""}`} onClick={() => setSelected(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <input className="logs-filter" placeholder="Filter lines…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="autoscroll-toggle">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
      </div>

      {error && <div className="error-toast">{error}</div>}

      <div className="log-panel" ref={panelRef}>
        {filteredLines.length === 0 ? (
          <div className="log-empty">{lines.length === 0 ? "Waiting for log data…" : "No lines match the filter."}</div>
        ) : (
          filteredLines.map((line, i) => (
            <div className={`log-line ${levelClass(line)}`} key={i}>
              {line}
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
