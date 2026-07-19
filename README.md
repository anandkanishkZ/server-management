# Server Panel

A lightweight, self-hosted server management panel — a leaner, custom alternative to CyberPanel/aaPanel/Plesk, built to run alongside real workloads on a small VPS without competing for RAM.

## Stack

- **API**: Fastify + TypeScript, Prisma (PostgreSQL)
- **Web**: Vite + React (built to static files, no SSR process)
- **Auth**: JWT access tokens + httpOnly refresh cookie, optional TOTP 2FA
- **Privileged helper**: a small root-owned daemon behind a Unix socket, exposing only a fixed whitelist of actions (`nginx.reload`, `service.restart`, …) — the API process itself never runs as root
- **Realtime**: raw WebSocket push for live system stats (CPU/memory/disk/network)

## Layout

```
apps/
  api/      Fastify backend, Prisma schema, auth + system routes
  web/      React dashboard (login, system overview)
helper/     Privileged root-owned helper (Unix socket, whitelisted actions)
deploy/     systemd units + Nginx vhost templates
```

## Status

Phase 1 of the roadmap: authentication (JWT + TOTP), audit logging, and a live system overview dashboard (CPU, memory, swap, per-core load, load average, disks, disk hardware, network throughput). Site management, database tools, file manager, domain/SSL, logs, security tools, and backups are planned but not yet built — see the sidebar nav in the dashboard for the current roadmap.

## Local development

```bash
npm install
cp apps/api/.env.example apps/api/.env   # fill in DATABASE_URL and JWT_SECRET
npm run prisma:generate
npm run dev:api
npm run dev:web
```

## Deployment

See `deploy/panel-api.service`, `deploy/panel-helper.service`, and `deploy/nginx-panel.conf` for a systemd + Nginx reference setup. In production, build both `apps/api` and `apps/web`, then run the API under PM2 or systemd and serve the web build as static files behind Nginx.
