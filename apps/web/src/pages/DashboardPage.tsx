import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getAccessToken } from "../lib/authStore";
import { apiFetch } from "../lib/api";
import AppShell from "../components/AppShell";
import Sparkline from "../components/Sparkline";
import "./DashboardPage.css";

interface HealthAlert {
  id: string;
  level: "danger" | "warn";
  message: string;
  linkTo?: string;
  linkLabel?: string;
}

interface StaticInfo {
  os: { distro: string; release: string; codename: string; kernel: string; arch: string; hostname: string };
  cpu: { manufacturer: string; brand: string; physicalCores: number; cores: number; speed: string; speedMax: string; socket: string };
  system: { manufacturer: string; model: string; virtual: boolean; virtualHost?: string };
  network: { iface: string; ip4: string; mac: string; speed: number | null; type: string }[];
  disksLayout: { device: string; type: string; name: string; vendor: string; size: number; interfaceType: string; smartStatus: string }[];
}

interface DynamicStats {
  cpu: { load: number; cores: number[] };
  loadAvg: number[];
  memory: { total: number; used: number; free: number; swapTotal: number; swapUsed: number };
  disks: { fs: string; mount: string; size: number; used: number; use: number }[];
  uptime: number;
  network: { iface: string; rxSec: number | null; txSec: number | null }[];
  processes: { all: number; running: number; sleeping: number; blocked: number };
}

const HISTORY_LENGTH = 30;

function bytesToGb(n: number) {
  return n / 1024 ** 3;
}

function fmtGb(n: number) {
  return bytesToGb(n).toFixed(1);
}

function fmtBytesPerSec(n: number | null | undefined) {
  const v = n ?? 0;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)} MB/s`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KB/s`;
  return `${v.toFixed(0)} B/s`;
}

function severity(pct: number): "" | "warn" | "danger" {
  if (pct >= 90) return "danger";
  if (pct >= 70) return "warn";
  return "";
}

function pushHistory(map: Map<string, number[]>, key: string, value: number) {
  const arr = map.get(key) ?? [];
  arr.push(value);
  if (arr.length > HISTORY_LENGTH) arr.shift();
  map.set(key, arr);
  return arr;
}

function icon(children: React.ReactNode) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const CpuIcon = () => icon(<><rect x="6" y="6" width="12" height="12" rx="1.5" /><path d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2" /></>);
const MemoryIcon = () => icon(<><rect x="3" y="7" width="18" height="10" rx="1.5" /><path d="M7 7v10M11 7v10M15 7v10" /></>);
const ClockIcon = () => icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>);
const DiskIcon = () => icon(<><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /></>);
const ServerIcon = () => icon(<><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M7 7h.01M7 17h.01" /></>);
const ActivityIcon = () => icon(<path d="M3 12h4l2 8 4-16 2 8h6" />);
const NetworkIcon = () => icon(<><rect x="9" y="3" width="6" height="5" rx="1" /><rect x="2" y="16" width="6" height="5" rx="1" /><rect x="16" y="16" width="6" height="5" rx="1" /><path d="M12 8v4M12 12H5v4M12 12h7v4" /></>);
const LayersIcon = () => icon(<><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>);
const CubeIcon = () => icon(<><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="M4.5 7.5 12 12l7.5-4.5M12 12v9" /></>);

function RadialGauge({ value }: { value: number }) {
  const size = 76;
  const strokeWidth = 8;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - pct / 100);
  const color = severity(pct) === "danger" ? "#b74700" : severity(pct) === "warn" ? "#915907" : "#0a66c2";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--gray-100)" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
    </svg>
  );
}

function CoreBars({ cores }: { cores: number[] }) {
  return (
    <div className="core-bars">
      {cores.map((load, i) => (
        <div className="core-bar-track" key={i} title={`Core ${i + 1}: ${load.toFixed(0)}%`}>
          <div className={`core-bar-fill ${severity(load)}`} style={{ height: `${Math.max(4, load)}%` }} />
        </div>
      ))}
    </div>
  );
}

function bytesToSize(n: number) {
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(1)} TB`;
  return `${(n / 1024 ** 3).toFixed(0)} GB`;
}

export default function DashboardPage() {
  const [staticInfo, setStaticInfo] = useState<StaticInfo | null>(null);
  const [stats, setStats] = useState<DynamicStats | null>(null);
  const [connected, setConnected] = useState(false);
  const retryRef = useRef<ReturnType<typeof setTimeout>>();
  const cpuHistoryRef = useRef<number[]>([]);
  const netHistoryRef = useRef(new Map<string, number[]>());
  const [, forceTick] = useState(0);
  const [healthAlerts, setHealthAlerts] = useState<HealthAlert[]>([]);

  useEffect(() => {
    // Best-effort - these two feed the health banner only, so a failure here
    // (e.g. a future VIEWER-role user without admin access) shouldn't block
    // the rest of the dashboard from rendering.
    Promise.all([apiFetch("/domains").catch(() => null), apiFetch("/apps").catch(() => null)]).then(([domainsData, appsData]) => {
      const alerts: HealthAlert[] = [];

      for (const d of domainsData?.domains ?? []) {
        if (d.hasCert && d.daysRemaining !== null && d.daysRemaining <= 14) {
          alerts.push({
            id: `ssl-${d.domain}`,
            level: "danger",
            message: `SSL for ${d.domain} expires in ${d.daysRemaining} day(s)`,
            linkTo: "/domains",
            linkLabel: "Renew",
          });
        }
      }

      for (const a of appsData?.apps ?? []) {
        if (a.status !== "online") {
          alerts.push({ id: `app-${a.name}`, level: "danger", message: `${a.name} is ${a.status}, not running`, linkTo: "/apps", linkLabel: "View" });
        } else if (a.restarts > 10 && !a.protected) {
          // panel-api's own restart count reflects every deploy of the panel
          // itself, not crash-loop behavior, so it's excluded here.
          alerts.push({
            id: `app-restarts-${a.name}`,
            level: "warn",
            message: `${a.name} has restarted ${a.restarts} times - possible crash loop`,
            linkTo: "/apps",
            linkLabel: "View",
          });
        }
      }

      setHealthAlerts(alerts);
    });
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;

    async function connect() {
      try {
        const initial = await apiFetch("/system/overview");
        if (!cancelled) {
          setStaticInfo(initial.static);
          setStats(initial.dynamic);
        }
      } catch {
        // socket will populate stats shortly
      }

      const token = getAccessToken();
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${window.location.host}/api/system/stream?token=${token}`);

      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        const dynamic: DynamicStats = JSON.parse(event.data);
        cpuHistoryRef.current.push(dynamic.cpu.load);
        if (cpuHistoryRef.current.length > HISTORY_LENGTH) cpuHistoryRef.current.shift();
        for (const n of dynamic.network) {
          pushHistory(netHistoryRef.current, `${n.iface}:rx`, n.rxSec ?? 0);
          pushHistory(netHistoryRef.current, `${n.iface}:tx`, n.txSec ?? 0);
        }
        setStats(dynamic);
        forceTick((t) => t + 1);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) retryRef.current = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      ws?.close();
    };
  }, []);

  const headerRight = (
    <span className={`live-pill ${connected ? "connected" : ""}`}>
      <span className="live-dot" />
      {connected ? "Live" : "Connecting…"}
    </span>
  );

  if (!stats || !staticInfo) {
    return (
      <AppShell title="Overview" headerRight={headerRight}>
        <div className="skeleton-screen">
          <div className="skeleton-spinner" />
          <span>Loading system stats…</span>
        </div>
      </AppShell>
    );
  }

  const memPct = (stats.memory.used / stats.memory.total) * 100;
  const swapPct = stats.memory.swapTotal > 0 ? (stats.memory.swapUsed / stats.memory.swapTotal) * 100 : 0;
  const uptimeDays = Math.floor(stats.uptime / 86400);
  const uptimeHours = Math.floor((stats.uptime % 86400) / 3600);
  const cores = staticInfo.cpu.cores || 1;

  const primaryDisk = stats.disks.find((d) => d.mount === "/") ?? stats.disks[0];
  const allAlerts: HealthAlert[] = [...healthAlerts];
  if (primaryDisk && primaryDisk.use >= 85) {
    const freeGb = fmtGb(primaryDisk.size - primaryDisk.used);
    allAlerts.unshift({
      id: "disk",
      level: primaryDisk.use >= 90 ? "danger" : "warn",
      message: `Disk usage is at ${primaryDisk.use.toFixed(0)}% (${freeGb} GB free on ${primaryDisk.mount})`,
      linkTo: "/files",
      linkLabel: "File Manager",
    });
  }

  return (
    <AppShell title="Overview" headerRight={headerRight}>
      {allAlerts.length > 0 && (
        <div className="health-alerts">
          {allAlerts.map((a) => (
            <div key={a.id} className={`health-alert health-alert-${a.level}`}>
              <span>{a.message}</span>
              {a.linkTo && (
                <Link className="health-alert-link" to={a.linkTo}>
                  {a.linkLabel ?? "View"} →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="stat-grid">
        <div className="card system-card">
          <div className="card-header">
            <ServerIcon /> System
          </div>
          <div className="spec-rows">
            <div className="spec-row">
              <span>Hostname</span>
              <span>{staticInfo.os.hostname}</span>
            </div>
            <div className="spec-row">
              <span>OS</span>
              <span>
                {staticInfo.os.distro} {staticInfo.os.release}
              </span>
            </div>
            <div className="spec-row">
              <span>Kernel</span>
              <span>{staticInfo.os.kernel}</span>
            </div>
            <div className="spec-row">
              <span>Architecture</span>
              <span>{staticInfo.os.arch}</span>
            </div>
            <div className="spec-row">
              <span>Platform</span>
              <span>
                {staticInfo.system.virtual ? (
                  <span className="badge badge-info">Virtual{staticInfo.system.virtualHost ? ` · ${staticInfo.system.virtualHost}` : ""}</span>
                ) : (
                  <span className="badge badge-neutral">Bare metal</span>
                )}
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <ActivityIcon /> Load Average
          </div>
          <div className="load-avg-row">
            {["1m", "5m", "15m"].map((label, i) => {
              const val = stats.loadAvg[i] ?? 0;
              const pct = Math.min(100, (val / cores) * 100);
              return (
                <div className="load-avg-item" key={label}>
                  <span className="load-avg-value">{val.toFixed(2)}</span>
                  <div className="bar-track thin">
                    <div className={`bar-fill ${severity(pct)}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="load-avg-label">{label}</span>
                </div>
              );
            })}
          </div>
          <div className="stat-caption" style={{ marginTop: 10 }}>
            {cores} logical cores available
          </div>
        </div>

        <div className="card processor-card">
          <div className="card-header">
            <CpuIcon /> Processor
          </div>
          <div className="gauge-row">
            <RadialGauge value={stats.cpu.load} />
            <div className="gauge-info">
              <span className="gauge-value">{stats.cpu.load.toFixed(0)}%</span>
              <span className="gauge-caption">
                {staticInfo.cpu.physicalCores} physical / {staticInfo.cpu.cores} logical
              </span>
              <span className="gauge-caption">
                {staticInfo.cpu.brand} @ {staticInfo.cpu.speed} GHz
              </span>
            </div>
          </div>
          {stats.cpu.cores.length > 1 && <CoreBars cores={stats.cpu.cores} />}
          <div className="trend-row">
            <span className="stat-caption">Load trend</span>
            <Sparkline data={cpuHistoryRef.current} color="#0a66c2" width={140} height={28} />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <DiskIcon /> Storage
          </div>
          {(() => {
            const primary = stats.disks.find((d) => d.mount === "/") ?? stats.disks[0];
            if (!primary) return <div className="stat-caption">No filesystems reported</div>;
            const rest = stats.disks.length - 1;
            return (
              <>
                <span className="stat-value">{fmtGb(primary.size)} GB</span>
                <div className="stat-caption">
                  {fmtGb(primary.used)} GB used ({primary.use.toFixed(0)}%){rest > 0 ? ` · +${rest} more mount${rest > 1 ? "s" : ""}` : ""}
                </div>
                <div className="bar-track">
                  <div className={`bar-fill ${severity(primary.use)}`} style={{ width: `${primary.use}%` }} />
                </div>
              </>
            );
          })()}
        </div>

        <div className="card">
          <div className="card-header">
            <MemoryIcon /> Memory
          </div>
          <span className="stat-value">{fmtGb(stats.memory.used)} GB</span>
          <div className="stat-caption">of {fmtGb(stats.memory.total)} GB used</div>
          <div className="bar-track">
            <div className={`bar-fill ${severity(memPct)}`} style={{ width: `${memPct}%` }} />
          </div>
          {stats.memory.swapTotal > 0 && (
            <>
              <div className="bar-labels">
                <span>Swap</span>
                <span>
                  {fmtGb(stats.memory.swapUsed)} / {fmtGb(stats.memory.swapTotal)} GB
                </span>
              </div>
              <div className="bar-track thin">
                <div className={`bar-fill ${severity(swapPct)}`} style={{ width: `${swapPct}%` }} />
              </div>
            </>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <ClockIcon /> Uptime
          </div>
          <span className="stat-value">
            {uptimeDays}d {uptimeHours}h
          </span>
          <div className="stat-caption">since last reboot</div>
        </div>

        <div className="card">
          <div className="card-header">
            <CubeIcon /> Processes
          </div>
          <span className="stat-value">{stats.processes.all}</span>
          <div className="stat-caption">total processes</div>
          <div className="process-breakdown">
            <span>
              <span className="dot dot-success" /> {stats.processes.running} running
            </span>
            <span>
              <span className="dot dot-neutral" /> {stats.processes.sleeping} sleeping
            </span>
            {stats.processes.blocked > 0 && (
              <span>
                <span className="dot dot-danger" /> {stats.processes.blocked} blocked
              </span>
            )}
          </div>
        </div>

        <div className="card wide-card">
          <div className="card-header">
            <NetworkIcon /> Network
          </div>
          {stats.network.map((n) => {
            const iface = staticInfo.network.find((x) => x.iface === n.iface);
            const rxHist = netHistoryRef.current.get(`${n.iface}:rx`) ?? [];
            const txHist = netHistoryRef.current.get(`${n.iface}:tx`) ?? [];
            return (
              <div className="net-row" key={n.iface}>
                <div className="net-row-info">
                  <div className="net-row-name">
                    {n.iface}
                    {iface?.ip4 && <span className="net-row-ip">{iface.ip4}</span>}
                  </div>
                  <div className="net-row-throughput">
                    <span className="net-throughput-down">↓ {fmtBytesPerSec(n.rxSec)}</span>
                    <span className="net-throughput-up">↑ {fmtBytesPerSec(n.txSec)}</span>
                  </div>
                </div>
                <div className="net-sparklines">
                  <Sparkline data={rxHist} color="#0a66c2" />
                  <Sparkline data={txHist} color="#057642" />
                </div>
              </div>
            );
          })}
        </div>

        {staticInfo.disksLayout.length > 0 && (
          <div className="card wide-card">
            <div className="card-header">
              <LayersIcon /> Disk Hardware
            </div>
            {staticInfo.disksLayout.map((d) => (
              <div className="disk-hw-row" key={d.device}>
                <div className="disk-hw-name">
                  {d.name || d.vendor || d.device}
                  <span className="badge badge-neutral">{d.type}</span>
                  {d.smartStatus && d.smartStatus !== "Unknown" && (
                    <span className={`badge ${d.smartStatus === "Ok" ? "badge-success" : "badge-danger"}`}>SMART: {d.smartStatus}</span>
                  )}
                </div>
                <div className="disk-hw-meta">
                  {bytesToSize(d.size)} · {d.interfaceType || "Unknown interface"}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="card wide-card">
          <div className="card-header">
            <DiskIcon /> Filesystems
          </div>
          {stats.disks.map((d) => (
            <div className="disk-row" key={d.mount}>
              <div className="disk-row-top">
                <span>
                  <span className="disk-mount">{d.mount}</span>
                  <span className="disk-fs">{d.fs}</span>
                </span>
                <span className="disk-usage">
                  {fmtGb(d.used)} / {fmtGb(d.size)} GB
                </span>
              </div>
              <div className="bar-track">
                <div className={`bar-fill ${severity(d.use)}`} style={{ width: `${d.use}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
