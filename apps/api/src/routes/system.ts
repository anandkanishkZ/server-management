import type { FastifyInstance } from "fastify";
import os from "node:os";
import si from "systeminformation";
import { verifyAccessToken } from "../lib/jwt.js";

// OS/CPU model/NIC identity barely ever change while the process is alive,
// so they're fetched once and cached instead of re-queried every tick.
let staticInfoCache: Awaited<ReturnType<typeof loadStaticInfo>> | null = null;

async function loadStaticInfo() {
  const [osInfo, cpu, system, nics, diskLayout] = await Promise.all([
    si.osInfo(),
    si.cpu(),
    si.system(),
    si.networkInterfaces(),
    si.diskLayout(),
  ]);

  return {
    os: {
      distro: osInfo.distro,
      release: osInfo.release,
      codename: osInfo.codename,
      kernel: osInfo.kernel,
      arch: osInfo.arch,
      hostname: osInfo.hostname,
    },
    cpu: {
      manufacturer: cpu.manufacturer,
      brand: cpu.brand,
      physicalCores: cpu.physicalCores,
      cores: cpu.cores,
      speed: cpu.speed,
      speedMax: cpu.speedMax,
      socket: cpu.socket,
    },
    system: {
      manufacturer: system.manufacturer,
      model: system.model,
      virtual: system.virtual,
      virtualHost: system.virtualHost,
    },
    network: (Array.isArray(nics) ? nics : [])
      .filter((n) => !n.internal)
      .map((n) => ({ iface: n.iface, ip4: n.ip4, mac: n.mac, speed: n.speed, type: n.type })),
    disksLayout: diskLayout.map((d) => ({
      device: d.device,
      type: d.type,
      name: d.name,
      vendor: d.vendor,
      size: d.size,
      interfaceType: d.interfaceType,
      smartStatus: d.smartStatus,
    })),
  };
}

async function collectDynamicStats() {
  const [currentLoad, mem, fsSize, time, networkStats, processes] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.time(),
    si.networkStats(),
    si.processes(),
  ]);

  return {
    cpu: {
      load: currentLoad.currentLoad,
      cores: currentLoad.cpus.map((c) => c.load),
    },
    loadAvg: os.loadavg(),
    memory: {
      total: mem.total,
      used: mem.active,
      free: mem.available,
      swapTotal: mem.swaptotal,
      swapUsed: mem.swapused,
    },
    disks: fsSize.map((d) => ({ fs: d.fs, mount: d.mount, size: d.size, used: d.used, use: d.use })),
    uptime: time.uptime,
    network: networkStats.map((n) => ({ iface: n.iface, rxSec: n.rx_sec, txSec: n.tx_sec })),
    processes: { all: processes.all, running: processes.running, sleeping: processes.sleeping, blocked: processes.blocked },
  };
}

async function getStaticInfo() {
  if (!staticInfoCache) staticInfoCache = await loadStaticInfo();
  return staticInfoCache;
}

export default async function systemRoutes(app: FastifyInstance) {
  app.get("/system/overview", { preHandler: app.authenticate }, async () => {
    const [staticInfo, dynamic] = await Promise.all([getStaticInfo(), collectDynamicStats()]);
    return { static: staticInfo, dynamic };
  });

  // Browsers cannot set an Authorization header on a WebSocket handshake,
  // so the access token is passed as a query param and verified manually here.
  app.get("/system/stream", { websocket: true }, (socket, req) => {
    const token = (req.query as { token?: string } | undefined)?.token;
    try {
      if (!token) throw new Error("missing token");
      verifyAccessToken(token);
    } catch {
      socket.close(4001, "Unauthorized");
      return;
    }

    const interval = setInterval(async () => {
      try {
        socket.send(JSON.stringify(await collectDynamicStats()));
      } catch {
        clearInterval(interval);
      }
    }, 3000);

    socket.on("close", () => clearInterval(interval));
  });
}
