# Scholario Ops — Project Overview

_Last updated: 8 October 2026 (branch `koti`, after PR #10)_

Scholario Ops is an operations dashboard for applications that run on a **Production (PRD)** VPS with a **Disaster Recovery (DR)** VPS. It answers one question: *is the real PRD and DR infrastructure healthy right now?* It does that from real evidence only. When data is missing it shows **UNKNOWN** or **NOT CONFIGURED**, never "healthy".

Status definitions used in this repository:

| Level | Meaning |
|---|---|
| **CODE READY** | The application code, tests, security controls and deployment files are complete and verified locally |
| **FULL MONITORING READY** | Every data source for an application is connected (agents installed, database probe configured, backups reporting, Cloudflare token with zone access) |
| **HOSTING COMPLETE** | Deployed on the Ops VPS behind nginx/HTTPS, PM2 startup enabled, backups scheduled |

---

## 1. Where the project stands

| Area | Status | Notes |
|---|---|---|
| Backend (Node/Express, PostgreSQL) | ✅ Done | All backend code is in `server/`. PostgreSQL schema `ops` is the only source of truth. Mock data, localStorage data and Redis have all been removed. |
| Dashboard (React) | ✅ Done | 18 protected pages plus login. All data comes from the API. |
| Realtime | ✅ Done | Server-Sent Events with one-time tickets. There is no WebSocket server, even though the hook file is still named `useWebSocket.ts`. |
| Monitoring engine | ✅ Done | HTTP/TCP/DNS/SSL probes, incidents, alerts, escalation, dead-man heartbeat |
| Integrations | ✅ Done (code) | Cloudflare Load Balancer (read-only), Hostinger VPS API (read-only), VPS telemetry agent v3.2.0, backup and deployment reporting |
| Notifications | ✅ Done | Microsoft Teams, Email (SMTP), Webhook, PagerDuty. Deduplicated, with cooldown and recovery messages. |
| Security | ✅ Done | See §8 |
| Automated tests | ✅ 41 tests | `npm test` against throw-away PostgreSQL schemas (see §10) |
| CI/CD | ✅ Done | GitHub Actions: test on every PR, deploy to production on push to `main` with health check and automatic rollback (see §11) |
| Production hosting | ✅ Set up | `https://scholario-ops.bylinelearning.cloud` → nginx → Node on `127.0.0.1:4100` (PM2 `scholario-ops`) |
| Full monitoring of real apps | ⚠ Depends on configuration | Each application needs: agents installed on the PRD/DR servers, DB probe configured per environment, backup jobs reporting, and a Cloudflare token with the right permissions. Until those are connected the dashboard correctly shows UNKNOWN / NOT CONFIGURED. |

Data migration: the old JSON stores (`data/ops-store.json`, `data/metrics.json`, `data/checks/`) were imported into PostgreSQL on 2026-10-06. Their `*.imported-to-postgres-*` copies are kept in `data/` only as a backup.

> **Note:** [COMPLETION_REPORT.md](COMPLETION_REPORT.md) is out of date. It describes an earlier design that used Redis, WebSockets, bcrypt, port 4000/ws and seeded demo users, and none of that exists in the current code. Trust this overview and the code when they disagree with it.

### Project history (high level)

1. **Prototype:** a React UI with mock data, `OpsContext` and localStorage.
2. **Rebrand and UI:** Scholario Ops branding, light/dark themes, mobile layout, incident timeline, project overview page.
3. **First backend:** a separate backend server with auth, monitors and a 2-VPS testbench.
4. **Real backend (current):** everything consolidated into `server/` with PostgreSQL migrations. Mock data removed. Real probes, Cloudflare/Hostinger/agent integrations, SSE realtime, and per-application PRD/DR inventory (migration 003).
5. **Delivery:** CI/CD pipeline, release manager script with rollback, branch protection docs. Recent fixes: install platform optional dependencies in CI (PR #9 and #10).

---

## 2. Architecture

```
React dashboard (src/)  ──REST + Server-Sent Events──▶  Node/Express (server/)  ──▶  PostgreSQL (schema "ops")
                                                          │
                       real checks / APIs ◀───────────────┤  HTTPS/TLS/DNS/TCP probes of the application URLs
                                                          │  Cloudflare API (Load Balancer pools, pool health) — read-only
                                                          │  Hostinger API (VPS plan, state, region) — read-only
                                                          │  Dead-man heartbeat → external service (healthchecks.io etc.)
VPS telemetry agent ──HTTPS, outbound──▶ /api/v1/agent/ingest   CPU/RAM/disk/load/network/services/DB probe
Backup jobs ──HTTPS──▶ /api/v1/backups/report
CI pipelines ──HTTPS──▶ /api/v1/deployments/report  (Bearer DEPLOY_REPORT_TOKEN)
```

- **One process** serves the API, the SSE realtime stream and the built dashboard. There's no Redis and no WebSocket server.
- **PostgreSQL is the single source of truth.** Configuration is entered in **Setup & Connections** and stored in real columns. Monitor results, incidents, audit, metrics and history are stored too. The schema is created by `server/migrations/*.sql`, which the server applies itself at startup.
- **Nothing about an application is hardcoded.** ICT, QR Video or any other application is configured the same way in the dashboard.
- **The Ops server must not run on the monitored servers.** It has to stay up when they go down.

## 3. Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 20 (22 LTS used in CI), TypeScript, ESM |
| Backend | Express 4, `pg` (PostgreSQL 14+; CI uses 17), `nodemailer`, `dotenv` |
| Frontend | React 19, React Router 7, Vite 8, Tailwind CSS 4, `lucide-react` icons |
| Build | `vite build` (dashboard → `dist/`) and `esbuild` (server bundle → `dist-server/server.js` plus migrations) |
| Dev runner | `tsx` (server with Vite middleware via `--dev`) |
| Tests | Node built-in test runner (`tsx --test`) |
| Agent | Python 3, standard library only (installed by a generated shell script) |
| Hosting | Ubuntu VPS, nginx + Let's Encrypt, PM2 |

## 4. Repository layout

| Path | Contents |
|---|---|
| `server/server.ts` | Entry point: config, DB connect and migrate, Express app, health endpoints, static dashboard, graceful shutdown |
| `server/routes.ts` | All REST API routes (see §6) |
| `server/engine.ts` | Monitor scheduler (1 s tick), incident open/resolve, escalation, agent ingest, recompute loop, dead-man heartbeat |
| `server/probes.ts` | HTTP/HTTPS, TCP, DNS and SSL probes |
| `server/health.ts` | Evaluation of application, database, backup and agent health |
| `server/readiness.ts` | DR readiness (13 checks), failover pre-flight, availability |
| `server/loadbalancer.ts`, `server/cloudflare.ts` | Cloudflare Load Balancer and zone sync (read-only) |
| `server/hostinger.ts` | Hostinger VPS API sync (read-only) |
| `server/alerts.ts`, `server/notify.ts` | Deduplicated alerts. Teams/Email/Webhook/PagerDuty delivery. |
| `server/appMonitors.ts` | Creates and removes URL monitors automatically from an application's PRD/DR URLs |
| `server/agent.ts` | Telemetry agent (embedded Python) plus install/uninstall scripts |
| `server/auth.ts` | Password hashing, tokens, lockout, RBAC, first-admin bootstrap |
| `server/history.ts` | Batched writes of check results to `check_results` (availability/SLA) |
| `server/events.ts` | SSE event bus |
| `server/store.ts`, `server/db.ts` | PostgreSQL access layer, migrations runner |
| `server/config.ts`, `server/validate.ts`, `server/logger.ts` | Env config, input validation, structured logs with redaction |
| `server/migrations/` | `001_init.sql`, `002_indexes.sql`, `003_environment_inventory.sql` |
| `server/scripts/migrate.ts` | `npm run db:migrate` |
| `src/` | React dashboard: `components/` (by area), `context/` (`AuthContext`, `OpsContext`), `services/api.ts`, `hooks/useWebSocket.ts` (SSE), `types/` |
| `tests/` | `agent`, `config-flow`, `loadbalancer`, `monitoring`, `production` test suites plus fixtures |
| `deploy/` | `release.sh` (release manager), `ecosystem.production.cjs`, `backup-db.sh` |
| `nginx/scholario-ops.conf`, `ecosystem.config.js` | Reverse proxy and PM2 config |
| `.github/workflows/ci-cd.yml` | CI/CD pipeline |
| `docs/` | `CI-CD.md`, `BRANCH-PROTECTION.md`, project document (`.docx` / `.pdf`) |

## 5. Dashboard pages

Login at `/login`. Every other route needs a session and is wrapped in the `Shell` layout, which has the sidebar, command palette, theme toggle and live/reconnecting status.

| Route | Page | Purpose |
|---|---|---|
| `/overview` | Overview | Overall health, applications, incidents, ICT status panel |
| `/setup` | Setup & Connections | Servers, applications (PRD/DR URLs, inventory, DB probe, thresholds), Cloudflare LB mapping, agent install |
| `/applications` | Applications | Per-application PRD/DR health, DR readiness, availability |
| `/infrastructure` | Infrastructure | VPS telemetry: CPU, RAM, disk, load, network, services, processes |
| `/monitors` | Monitors | HTTP/TCP/DNS/SSL monitors, history, latency charts, manual probe |
| `/incidents` | Incidents | Incident list and timeline: acknowledge, status, severity, assign, notes, resolve |
| `/resilience` | DR / Resilience | DR dashboard, Load Balancer failover console |
| `/backups` | Backups | Backup status and age per environment |
| `/dependencies` | Dependency map | Application → server → database → provider relationships |
| `/hostinger` | Hostinger | VPS plan, state and region from the Hostinger API |
| `/cloudflare` | Cloudflare | Zones, Load Balancers, pools, origin health |
| `/deployments` | Deployments | Deployments reported by CI pipelines |
| `/runbooks` | Runbooks | Step checklists (toggle / reset) |
| `/maintenance` | Maintenance | Maintenance windows (suppress alerts) |
| `/communications` | Communications | Notification channels, test sends, escalation policies |
| `/reports` | Reports | Summary, uptime, daily reports |
| `/audit` | Audit logs | Every configuration and operator action |
| `/users` | Users | User management and roles |

## 6. API summary

All routes are under `/api`. Health endpoints live outside the API router: `/api/health/live` (liveness) and `/api/health/ready` (readiness; returns 503 when the DB is down).

| Group | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/change-password`, `GET /auth/me` |
| Machine reports (token auth) | `POST /v1/agent/ingest`, `GET /v1/agent/install/:serverId`, `GET /v1/agent/uninstall`, `GET/POST /v1/heartbeat/:token`, `POST /v1/deployments/report`, `POST /v1/backups/report` |
| Realtime | `POST /v1/realtime/ticket` → `GET /v1/realtime/stream?ticket=…` (SSE) |
| Bootstrap & system | `GET /v1/bootstrap`, `/v1/integrations`, `/v1/system/summary`, `/v1/deadman/status` (= `/v1/health/heartbeats`) |
| Servers | CRUD on `/v1/servers`, `/:id/metrics`, `/:id/agent`, `POST /:id/rotate-token` |
| Applications | CRUD on `/v1/applications`, `/:id/dr-readiness`, `/:id/availability`, `/:id/failover/preflight`, `POST /:id/failover/decision`, `POST /:id/failover` |
| Monitors | CRUD on `/v1/monitors`, `/:id/toggle`, `/:id/probe`, `/:id/history`, `POST /v1/monitors/probe-all` |
| Tools | `POST /v1/tools/http`, `/tcp`, `/dns`, `/ssl` (one-off diagnostics) |
| Incidents | `GET/POST /v1/incidents`, `/:id/acknowledge`, `/:id/status`, `/:id/severity`, `/:id/assign`, `/:id/notes`, `/:id/resolve` |
| Notifications | CRUD on `/v1/channels`, `POST /:id/test`, `GET/PUT /v1/escalation-policies` |
| Operations | `/v1/maintenance` (create/complete/delete), `/v1/runbooks` (CRUD, step toggle, reset), `GET /v1/deployments` |
| Health data | `GET /v1/backups`, `/v1/backups/status`, `/v1/health/databases`, `/v1/health/agents` |
| Providers | `GET /v1/cloudflare/zones`, `/accounts`, `/lb-pools`, `GET /v1/loadbalancers`, `POST /v1/cloudflare/sync`, `/v1/loadbalancers/sync`, `GET /v1/hostinger/vms`, `POST /v1/hostinger/sync` |
| Admin | CRUD on `/v1/users`, `GET /v1/audit` |
| Reports | `GET /v1/reports/summary`, `/uptime`, `/daily` |

## 7. Database (PostgreSQL, schema `ops`)

Tables: `meta`, `users`, `refresh_tokens`, `servers`, `applications`, `application_environments`, `application_load_balancers`, `monitors`, `monitor_buckets`, `check_results`, `server_metrics`, `incidents`, `audit_logs`, `channels`, `escalation_policies`, `maintenance_windows`, `runbooks`, `deployments`, `backups`.

- `application_environments` (migration 003) holds the per-environment (PRD/DR) inventory: app port, health path, web server, process manager, routing, DB engine/name/port (`mysql` / `mariadb` / `postgresql`), and threshold overrides for replication lag and backup age. `NULL` means "not confirmed yet" and is shown as UNKNOWN/PENDING.
- Retention: metrics `METRICS_RETENTION_HOURS` (48 h), check history `CHECK_HISTORY_RETENTION_DAYS` (90 d), audit `AUDIT_RETENTION_ENTRIES` (5000).
- Backups of the ops schema: `deploy/backup-db.sh` (`pg_dump`), also run automatically before each production deploy.

## 8. What is monitored and where the data comes from

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
| Dead-man heartbeat | Per monitored server (PRD / DR), from the agent reports: server heartbeat (age, delivery latency, missed reports), local application checks (HTTP status, latency, last success, consecutive failures), watched systemd services, database probes. No external watchdog. | HEALTHY · DEGRADED · FAILING · UNKNOWN |

**Telemetry agent (v3.2.0):** a Python 3 script that uses only the standard library. It reads `/proc`, `df`, `ps`, `systemctl` and `journalctl`, and is configured in `/etc/scholario-agent.conf`. Install it with the one-line command shown in Setup (`/api/v1/agent/install/:serverId`). Tokens are per server and can be rotated. The installer never contains database credentials.

**Incidents and alerts:** raised for application down/recovered, Cloudflare origin unhealthy, database unavailable, replication broken, backup stale/failed, DR not ready, agent offline and SSL expiring. There is one incident per problem (deduplicated), with a notification cooldown (`ALERT_COOLDOWN_MIN`) and recovery notifications. Escalation policies per severity repeat notifications for incidents nobody has acknowledged. Maintenance windows suppress alerts. With no enabled channel, notifications show NOT CONFIGURED and nothing is sent.

**Failover:** Scholario Ops never changes Cloudflare, DNS or firewalls for Load-Balancer-managed applications. The failover console runs pre-flight checks, shows the manual Cloudflare steps, and records approve/reject decisions in the audit log. Automatic failover is off by default and unavailable for Load-Balancer apps.

## 9. Security

- scrypt password hashing, HS256 access tokens (default TTL 8 h), rotating single-use refresh tokens (7 d), per-IP and per-account login lockout
- RBAC with 4 levels: `viewer` < `operator` < `it_administrator` < `super_admin`, enforced on the API and mirrored in the UI (`RbacGuard`)
- First `super_admin` is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` only when no users exist. If the password is weak or empty, a random one is generated and saved to a file that must be deleted after first login. There are no default or demo accounts.
- Live stream opened with one-time 60 s tickets, never with access tokens in the URL. Streams are dropped when a user is deactivated.
- API rate limit per IP (`API_RATE_LIMIT_PER_MIN`). Input validation. Generic error messages without stack traces.
- CSP, frame and permissions headers. `Cache-Control: no-store` on the API. HSTS at nginx.
- Secrets only in the server `.env` (Cloudflare and Hostinger tokens, JWT secret, DB URL, SMTP, deploy-report token). They are never stored in the database, never returned by the API, and never logged (structured logs with redaction).
- Agent and backup reports are authenticated with per-server tokens and validated. Timestamps outside `AGENT_MAX_CLOCK_SKEW_SEC` are rejected.
- Startup with the database unavailable keeps the process up. Readiness and the API return 503 instead of crash-looping.

## 10. Tests

`npm test` runs 41 tests. Each run creates throw-away PostgreSQL schemas and drops them afterwards, so it needs `DATABASE_URL`.

| Suite | Covers |
|---|---|
| `production.test.ts` | Liveness/readiness, DB-down startup, auth/lockout/RBAC, SSE tickets, authenticated telemetry, incident open/resolve, security headers, rate limiting, graceful shutdown, secret-free JSON logs |
| `config-flow.test.ts` | Migrations, server/application create/edit/validate, managed monitors following URL edits, Cloudflare token never reaching the browser, reload after restart |
| `monitoring.test.ts` | Hostinger success/auth failure/timeout/429, Cloudflare unavailable, app health, SSL failures, DNS/timeout classification, DB states, backup states, agent heartbeat, DR readiness rules, notification dedup/cooldown |
| `loadbalancer.test.ts` | Pool listing, pool health parsing, origin failure → DR routing + incident + recovery, concurrent syncs, missing permission |
| `agent.test.ts` | Installer contents, Python syntax and DB probe parsing |

`npm run verify` runs lint (type-check), build and all tests.

## 11. CI/CD and deployment

- **Pull request → `main`:** job `test` on Ubuntu 24.04 with Node 22 and a disposable `postgres:17` service. Steps: `npm ci --include=optional` → lint → build → test.
- **Push → `main`:** same tests, then the tested artifact `scholario-ops-<sha>.tar.gz` (built `dist/`, `dist-server/`, migrations, lockfile, `deploy/`) is copied over SSH as the restricted `scholario-deploy` user. On the server, `scholario-ops-release deploy <sha>` (a root-owned copy of `deploy/release.sh`) does the following:
  - prepares `/var/www/scholario-ops-releases/<id>/`
  - runs `npm ci --omit=dev`
  - takes a pre-deploy DB backup
  - atomically switches the `current` symlink
  - reloads PM2
  - health-checks `https://scholario-ops.bylinelearning.cloud/api/health/live`
  - **rolls back automatically** on failure

  It keeps 5 successful and 2 failed releases. `rollback` and `status` commands are also available.
- `/var/www/scholario-ops/` holds the persistent `.env`, `data/`, `logs/`, `backups/` and the PM2 config. Deploys never touch them, nginx, the firewall or other PM2 apps on the server (`a11y-backend`, `ascend-demo-api`, `ascend-demo-web`).
- Branch protection for `main` (PR required, `test` status check, no force pushes) is described in [docs/BRANCH-PROTECTION.md](docs/BRANCH-PROTECTION.md).
- Full details: [DEPLOYMENT.md](DEPLOYMENT.md), [docs/CI-CD.md](docs/CI-CD.md).

## 12. Configuration (`.env`)

Only `DATABASE_URL` and `ADMIN_EMAIL` / `ADMIN_PASSWORD` are needed to start. Every other setting enables an integration or tunes a default. The full list with comments is in [.env.example](.env.example).

| Group | Keys |
|---|---|
| Server | `PORT`, `HOST`, `PUBLIC_URL`, `DATABASE_URL`, `DB_SCHEMA`, `DATA_DIR`, `CORS_ORIGINS`, `TRUST_PROXY` |
| Auth | `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `JWT_SECRET`, `ACCESS_TOKEN_TTL_SEC`, `REFRESH_TOKEN_TTL_SEC` |
| Cloudflare | `CLOUDFLARE_API_TOKEN` (read: LB Monitors & Pools, Load Balancers, Zone), `CLOUDFLARE_SYNC_INTERVAL_SEC`, `CLOUDFLARE_LB_SYNC_INTERVAL_SEC` |
| Hostinger | `HOSTINGER_API_TOKEN`, `HOSTINGER_SYNC_INTERVAL_SEC`, `HOSTINGER_TIMEOUT_MS` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| Dead-man | none — built in (the old `DEADMAN_*` variables are deprecated and ignored) |
| Engine | `TELEMETRY_STALE_THRESHOLD_SEC`, `METRICS_RETENTION_HOURS`, `MONITOR_WORKER_CONCURRENCY`, `AUDIT_RETENTION_ENTRIES`, `CHECK_HISTORY_RETENTION_DAYS`, `AGENT_MAX_CLOCK_SKEW_SEC` |
| Thresholds | `BACKUP_MAX_AGE_HOURS` (26), `REPLICATION_MAX_LAG_SEC` (300), `SSL_EXPIRY_WARN_DAYS` (21), `DR_LATENCY_THRESHOLD_MS` (2000), `ALERT_COOLDOWN_MIN` (15), `API_RATE_LIMIT_PER_MIN` (600) |
| Logging / CI | `LOG_LEVEL`, `LOG_FORMAT`, `DEPLOY_REPORT_TOKEN` |

## 13. Running locally

```bash
cp .env.example .env     # set DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD
npm ci
npm run dev              # http://localhost:3000 (API + dashboard with Vite HMR)
npm run db:migrate       # optional — the server also migrates at startup
npm run verify           # lint + build + all tests (needs DATABASE_URL)
npm run build && npm start   # production build: dist/ + dist-server/server.js
```

## 14. Open items / next steps

| Item | Notes |
|---|---|
| Connect real data sources per application | Install agents on PRD and DR servers, configure the DB probe per environment, schedule backup jobs to call `/v1/backups/report`, set `CLOUDFLARE_API_TOKEN` with LB read permissions. Until then the dashboard shows UNKNOWN / NOT CONFIGURED. |
| Notification channels | Add Teams/Email/Webhook/PagerDuty channels and escalation policies in Communications |
| Dead-man heartbeat | Built in: stale / disconnected agents, failing application checks, failed services and unavailable databases open incidents |
| Branch protection | Apply the ruleset from `docs/BRANCH-PROTECTION.md` in GitHub, if it isn't applied yet |
| Housekeeping | Rename `src/hooks/useWebSocket.ts` (it uses SSE). Refresh or remove the outdated `COMPLETION_REPORT.md`. Remove `.env.legacy-server.bak` and the imported JSON backups in `data/` once they're no longer needed. |
| Frontend | Code-split the bundle. Finish modal focus traps and mobile modal layouts. |
