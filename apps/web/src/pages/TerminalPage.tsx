import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import AppShell from "../components/AppShell";
import { getAccessToken } from "../lib/authStore";
import "./TerminalPage.css";

export default function TerminalPage() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!mountRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      theme: { background: "#0b0f16" },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(mountRef.current);
    fitAddon.fit();

    let ws: WebSocket | null = null;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const token = getAccessToken();
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${window.location.host}/api/terminal/stream?token=${token}`);

      ws.onopen = () => {
        setConnected(true);
        ws?.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      };
      ws.onmessage = (event) => term.write(event.data);
      ws.onclose = () => {
        setConnected(false);
        term.writeln("\r\n\x1b[33m[disconnected - retrying...]\x1b[0m");
        if (!cancelled) retryTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    const dataListener = term.onData((data) => {
      ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "input", data }));
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    });
    resizeObserver.observe(mountRef.current);

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      dataListener.dispose();
      resizeObserver.disconnect();
      ws?.close();
      term.dispose();
    };
  }, []);

  const headerRight = (
    <span className={`live-pill ${connected ? "connected" : ""}`}>
      <span className="live-dot" />
      {connected ? "Connected" : "Connecting…"}
    </span>
  );

  return (
    <AppShell title="Terminal" headerRight={headerRight}>
      <div className="terminal-warning">
        <span>⚠️</span>
        <span>
          <strong>Full shell access as the server's own OS user, which has passwordless sudo.</strong> This is equivalent to an SSH session, not a
          sandboxed console - anyone who can reach this page can run any command on the server. It doesn't grant you anything beyond what SSH
          already does, but treat it with the same care.
        </span>
      </div>
      <div className="terminal-wrap">
        <div className="terminal-mount" ref={mountRef} />
      </div>
    </AppShell>
  );
}
