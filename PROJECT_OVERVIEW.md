# Scholario Ops — Project Overview

Scholario Ops is an operations dashboard for applications that run on a **Production (PRD)** VPS with a **Disaster Recovery (DR)** VPS. It answers one question: *is the real PRD and DR infrastructure healthy right now?* It does that from real evidence only. When data is missing it shows **UNKNOWN** or **NOT CONFIGURED**, never "healthy".

Status definitions used in this repository:

| Level | Meaning |
|---|---|
| **CODE READY** | The application code, tests, security controls and deployment files are complete and verified locally |
| **FULL MONITORING READY** | Every data source for an application is connected (agents installed, database probe configured, backups reporting, Cloudflare token with zone access) |
| **HOSTING COMPLETE** | Deployed on the Ops VPS behind nginx/HTTPS, PM2 startup enabled, backups scheduled |

See [COMPLETION_REPORT.md](COMPLETION_REPORT.md) for where each level stands today.

---

## Architecture

```
React dashboard (src/)  ──REST + Server-Sent Events──▶  Node/Express (server/)  ──▶  PostgreSQL (schema "ops")
                                                          │
                       real checks / APIs ◀───────────────┤  HTTPS/TLS/DNS/TCP probes of the application URLs
                                                          │  Cloudflare API (Load Balancer pools, pool health) — read-only
                                                          │  Hostinger API (VPS plan, state, region) — read-only
VPS telemetry agent ──HTTPS, outbound──▶ /api/v1/agent/ingest   CPU/RAM/disk/load/network/services/DB probe
Backup jobs ──HTTPS──▶ /api/v1/backups/report
```

- **One process** serves the API, the SSE realtime stream and the built dashboard. There's no Redis and no WebSocket server.
- **PostgreSQL is the single source of truth.** Configuration is entered in **Setup & Connections** and stored in real columns. Monitor results, incidents, audit, metrics and history are stored too. The schema is created by `server/migrations/*.sql`.
- **Nothing about an application is hardcoded.** ICT, QR Video or any other application is configured the same way in the dashboard.

## Repository layout

| Path | Contents |
|---|---|
| `server/` | Backend. `server.ts` (entry, health, shutdown), `routes.ts` (API), `engine.ts` (monitor scheduler, incidents, agent ingest), `probes.ts` (HTTP/TCP/DNS/SSL), `loadbalancer.ts` (Cloudflare LB), `cloudflare.ts`, `hostinger.ts`, `health.ts` (app/DB/backup/agent evaluation), `readiness.ts` (DR readiness, failover pre-flight, availability), `alerts.ts` (deduplicated alerts), `notify.ts` (Teams/Email/Webhook/PagerDuty), `appMonitors.ts` (URL monitors from app config), `agent.ts` (agent installer), `store.ts` + `db.ts` (PostgreSQL), `logger.ts`, `migrations/` |
| `src/` | React 19 + Vite + Tailwind dashboard |
| `tests/` | `npm test`: end-to-end and unit tests against throw-away PostgreSQL schemas |
| `nginx/`, `ecosystem.config.js`, `deploy/` | Production reverse proxy, PM2 config, database backup script |

## What is monitored and where the data comes from

| Area | Source | States |
|---|---|---|
| Application | HTTP(S) checks of the PRD/DR URLs: status code, response time, timeouts, consecutive failures, DNS/TLS/connection errors | HEALTHY · DEGRADED · DOWN · UNKNOWN |
| TLS certificate | TLS handshake: trust, hostname match, expiry, days remaining | valid · expiring (`SSL_EXPIRY_WARN_DAYS`) · failed |
| Cloudflare Load Balancer | Cloudflare API: pools, enabled/healthy, origins, per-PoP health, RTT, HTTP code, failure reason, routing (pool order). Sync status and last sync are shown. | Live · Not configured · Permission required · Check failed |
| VPS | Telemetry agent (outbound HTTPS, per-server token): CPU, RAM, disk, load, uptime, network, processes, services, heartbeat, restarts, collector errors | ONLINE · STALE · OFFLINE · NOT_CONNECTED |
| Database | Agent probe on the DB server (MySQL/MariaDB/PostgreSQL, set per environment): availability, latency, version, size, connections, long queries, replication role/state/lag | HEALTHY · DEGRADED · DOWN · UNKNOWN · NOT_CONFIGURED |
| Backups | Backup jobs report each run: last backup, age vs threshold, status | HEALTHY · STALE · FAILED · UNKNOWN |
| Provider | Hostinger API: plan, CPU, RAM, disk, OS, state, region | HEALTHY · DEGRADED · UNAVAILABLE · UNKNOWN |
| DR readiness | 13 checks (PRD/DR reachable, PRD/DR app, PRD/DR database, replication healthy and lag, recent backup, DR pool, DR origin, DR SSL, DR URL), each PASS · FAIL · UNKNOWN · NOT_CONFIGURED | READY · PARTIALLY_READY · NOT_READY · UNKNOWN |

**Incidents and alerts:** raised for application down/recovered, Cloudflare origin unhealthy, database unavailable, replication broken, backup stale/failed, DR not ready, agent offline and SSL expiring. There is one incident per problem (deduplicated), with a notification cooldown (`ALERT_COOLDOWN_MIN`) and recovery notifications. With no enabled channel, notifications show NOT CONFIGURED and nothing is sent.

**Failover:** Scholario Ops never changes Cloudflare, DNS or firewalls for Load-Balancer-managed applications. The failover console runs pre-flight checks, shows the manual Cloudflare steps, and records approve/reject decisions in the audit log. Automatic failover is off by default and unavailable for Load-Balancer apps.

## Security

- scrypt password hashing, HS256 access tokens, rotating single-use refresh tokens, per-IP and per-account login lockout, RBAC (viewer/operator/it_administrator/super_admin)
- Live stream opened with one-time 60 s tickets. Streams are dropped when a user is deactivated.
- API rate limit per IP. Input validation. Generic error messages without stack traces.
- CSP, frame and permissions headers. `Cache-Control: no-store` on the API. HSTS at nginx.
- Secrets only in the server `.env` (Cloudflare and Hostinger tokens, JWT secret, DB URL). They are never stored in the database, never returned by the API, and never logged (structured logs with redaction).
- Agent and backup reports are authenticated with per-server tokens and validated. Timestamps outside `AGENT_MAX_CLOCK_SKEW_SEC` are rejected.

## Running locally

```bash
cp .env.example .env     # set DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD
npm ci
npm run dev              # http://localhost:3000
npm run verify           # lint + build + all tests (needs DATABASE_URL)
```

Production: see [DEPLOYMENT.md](DEPLOYMENT.md).
