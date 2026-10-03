# Scholario Ops — Project Overview

> A production-grade **IT Operations Control Center** for the Scholario educational platform.  
> Full-stack: React 19 + TypeScript frontend with a Node.js/Express backend, PostgreSQL database, Redis cache, WebSocket realtime layer, and background monitoring workers.

---

## Table of Contents

1. [What Is This Project?](#1-what-is-this-project)
2. [Current Running State](#2-current-running-state)
3. [Tech Stack](#3-tech-stack)
4. [Full Project Structure](#4-full-project-structure)
5. [Applications Managed](#5-applications-managed)
6. [Infrastructure Overview](#6-infrastructure-overview)
7. [Frontend Architecture](#7-frontend-architecture)
8. [Backend Architecture](#8-backend-architecture)
9. [Database Schema](#9-database-schema)
10. [API Reference](#10-api-reference)
11. [Background Workers](#11-background-workers)
12. [Realtime WebSocket](#12-realtime-websocket)
13. [Authentication & RBAC](#13-authentication--rbac)
14. [Monitoring Engine](#14-monitoring-engine)
15. [Incident Engine](#15-incident-engine)
16. [Notification System](#16-notification-system)
17. [DR & Failover](#17-dr--failover)
18. [Visual Components](#18-visual-components)
19. [Command Palette](#19-command-palette)
20. [Simulator Engine](#20-simulator-engine)
21. [Feature Completion Status](#21-feature-completion-status)
22. [What Remains](#22-what-remains)
23. [Running the Project](#23-running-the-project)
24. [Default Credentials](#24-default-credentials)

---

## 1. What Is This Project?

**Scholario Ops** is a full-stack, production-ready IT Operations Control Center for Scholario — a realistically modeled EdTech company. It is not a demo or mockup. It is a functioning system with:

- A **React 19 frontend** dashboard covering every aspect of infrastructure operations
- A **Node.js/Express backend API** on port 4000 with 16 REST modules
- A **PostgreSQL 17 database** with 9 migration files and a complete schema
- A **Redis cache** layer for permissions, session data, and telemetry
- Three **background workers** (monitor scheduler, escalation engine, dead-man watchdog)
- A **WebSocket server** broadcasting realtime events to connected dashboards
- **Real HTTP/TCP/DNS/SSL probe execution** — not simulated
- **Real notification delivery** to Microsoft Teams, email, and generic webhooks
- **JWT authentication** with refresh tokens, bcrypt password hashing, and RBAC

The frontend still uses its own local mock data (OpsContext + localStorage) for display — connecting it fully to the API is the remaining Phase 9 work. But the backend is live, seeded with real data, and fully operational.

---

## 2. Current Running State

| Service | URL | Status |
|---|---|---|
| Frontend (Vite dev) | http://localhost:3000 | ✅ Running |
| Backend API | http://localhost:4000 | ✅ Running |
| Backend Health | http://localhost:4000/health | ✅ `{"status":"ok"}` |
| WebSocket | ws://localhost:4000/ws | ✅ Running |
| PostgreSQL 17 | localhost:5432 | ✅ Connected |
| Redis | localhost:6379 | ✅ Connected |
| Monitor Worker | (in-process) | ✅ Polling every 10s |
| Escalation Worker | (in-process) | ✅ Running every 60s |
| Dead-Man Watchdog | (in-process) | ✅ Checking every 15s |

The Overview page shows a live **API badge** (`API Xms` / `API OFFLINE`) that pings the backend health endpoint every 15 seconds.

---

## 3. Tech Stack

### Frontend

| Layer | Technology | Version |
|---|---|---|
| UI Framework | React | 19.0.1 |
| Language | TypeScript | 7.x |
| Build Tool | Vite | 8.x |
| CSS | Tailwind CSS v4 | 4.3.x |
| Icons | lucide-react | 0.546 |
| Animations | motion (Framer successor) | 12.x |
| State | React Context API | — |
| Persistence | localStorage | — |
| AI (unused) | @google/genai | 2.4.0 |

### Backend

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 22.x |
| Language | TypeScript | 5.8 |
| Framework | Express | 4.21 |
| Database | PostgreSQL | 17 |
| Cache / Queue | Redis (ioredis) | 5.4 |
| Auth | JWT (jsonwebtoken) + bcryptjs | — |
| Validation | Zod | 3.25 |
| Logging | pino + pino-pretty | 9.x |
| HTTP Security | helmet | 8.x |
| Rate Limiting | express-rate-limit | 7.5 |
| Scheduler | node-cron | 3.x |
| Email | nodemailer | 7.x |
| WebSocket | ws | 8.18 |
| Testing | Vitest | 3.x |

---

## 4. Full Project Structure

```
d:\ByLine-Koti\Scholario Ops\
│
├── src/                              # ── FRONTEND ──────────────────────────
│   ├── App.tsx                       # Root: OpsProvider + Shell + tab router
│   ├── main.tsx                      # React DOM entry point
│   ├── index.css                     # Tailwind v4 global styles
│   ├── types/index.ts                # 30+ TypeScript interfaces
│   ├── data/initialData.ts           # Mock seed data (frontend-only)
│   ├── context/OpsContext.tsx        # Global state, actions, computed summaries
│   └── components/
│       ├── layout/
│       │   ├── Shell.tsx             # Sidebar nav + topbar + incident banner
│       │   └── CommandPalette.tsx    # Ctrl+K global search + action launcher
│       ├── overview/
│       │   └── OverviewView.tsx      # ★ UPDATED — Main command center (redesigned)
│       ├── applications/
│       │   └── ApplicationsView.tsx  # App catalog + 10-tab detail modal
│       ├── infrastructure/
│       │   └── InfrastructureView.tsx
│       ├── monitors/
│       │   └── MonitorsView.tsx
│       ├── incidents/
│       │   └── IncidentsView.tsx     # 7-tab incident workspace
│       ├── resilience/
│       │   ├── DrDashboardView.tsx
│       │   ├── BackupsView.tsx
│       │   └── DependencyMapView.tsx
│       ├── providers/
│       │   ├── CloudflareView.tsx
│       │   └── HostingerView.tsx
│       ├── operations/
│       │   ├── DeploymentsView.tsx
│       │   ├── RunbooksView.tsx
│       │   └── MaintenanceView.tsx
│       ├── communications/
│       │   └── CommunicationsView.tsx
│       ├── analytics/
│       │   └── ReportsView.tsx
│       ├── admin/
│       │   └── AuditLogsView.tsx
│       └── visuals/
│           ├── HeartbeatPulseChart.tsx
│           ├── TrafficFlowChart.tsx
│           ├── IncidentFlowChart.tsx
│           └── TelemetryAreaGraph.tsx
│
├── server/                           # ── BACKEND ───────────────────────────
│   ├── .env                          # Live credentials (not committed)
│   ├── .env.example                  # Template with all required keys
│   ├── package.json
│   ├── tsconfig.json
│   ├── migrations/                   # SQL migration files (run in order)
│   │   ├── 001_extensions.sql        # uuid-ossp, pgcrypto
│   │   ├── 002_auth.sql              # users, roles, permissions, RBAC
│   │   ├── 003_applications.sql      # applications, app_dependencies
│   │   ├── 004_servers.sql           # servers, metrics, services, processes, logs
│   │   ├── 005_monitors.sql          # monitors, monitor_results
│   │   ├── 006_incidents.sql         # incidents, events, notes
│   │   ├── 007_notifications.sql     # channels, deliveries, escalation policies
│   │   ├── 008_operations.sql        # backups, deployments, runbooks,
│   │   │                             #   maintenance, cloudflare, dead_man
│   │   └── 009_audit.sql             # audit_logs, system_settings, schema_migrations
│   └── src/
│       ├── app.ts                    # Express app factory (all routes wired)
│       ├── server.ts                 # HTTP server, WS init, worker start, graceful shutdown
│       ├── config/index.ts           # Typed config from environment variables
│       ├── database/
│       │   ├── pool.ts               # pg Pool, query(), queryOne(), withTransaction()
│       │   ├── redis.ts              # ioredis client, cacheGet/Set/Del helpers
│       │   ├── migrate.ts            # SQL migration runner (npm run migrate)
│       │   └── seed.ts               # Seeds all 8 apps, 16 servers, incident, runbook, etc.
│       ├── middleware/
│       │   ├── authenticate.ts       # JWT Bearer token verification
│       │   ├── authorize.ts          # requireRole() + requirePermission()
│       │   ├── errorHandler.ts       # Global error + 404 handler
│       │   ├── requestId.ts          # UUID per-request ID header
│       │   └── validate.ts           # Zod schema validation middleware
│       ├── utils/
│       │   ├── logger.ts             # pino structured logger
│       │   ├── errors.ts             # AppError, AuthError, ForbiddenError, etc.
│       │   ├── response.ts           # ok(), created(), paginated(), parsePagination()
│       │   └── crypto.ts             # AES-256-GCM encrypt/decrypt, token hashing
│       ├── modules/
│       │   ├── auth/                 # Login, logout, refresh, change-password
│       │   ├── users/                # CRUD for operator accounts
│       │   ├── applications/         # Full app lifecycle + failover state
│       │   ├── servers/              # VPS fleet + telemetry ingest
│       │   ├── monitors/             # Probe definitions + real execution engine
│       │   ├── incidents/            # Ticket lifecycle + deduplication
│       │   ├── notifications/        # Channel dispatch + delivery tracking
│       │   ├── dr/                   # Readiness checks + failover trigger
│       │   ├── backups/              # Backup records + integrity + restore drill
│       │   ├── deployments/          # Pipeline stages + events
│       │   ├── runbooks/             # SOPs + execution sessions + step completions
│       │   ├── maintenance/          # Windows + monitor suppression
│       │   ├── cloudflare/           # Zone sync from Cloudflare API + DB read
│       │   ├── hostinger/            # VPS sync from Hostinger API
│       │   ├── reports/              # Summary, daily briefing, uptime stats
│       │   └── audit/                # Append-only operator action logs
│       ├── realtime/
│       │   └── websocket.ts          # WS server, broadcast(), per-user send
│       └── workers/
│           ├── monitorWorker.ts      # Probe scheduler + incident auto-creation
│           ├── escalationWorker.ts   # Policy engine, step dispatch
│           └── deadManWorker.ts      # Watchdog silence detection + alerts
│
├── package.json                      # Frontend dependencies
├── vite.config.ts
├── tsconfig.json
├── index.html
└── PROJECT_OVERVIEW.md               # ← This file
```

---

## 5. Applications Managed

Eight Scholario platform applications, all seeded into PostgreSQL:

| App | Code | Tier | Description | Default Status |
|---|---|---|---|---|
| Cipher | `cipher` | TIER 1 | ICT LMS & Online Examination Platform | HEALTHY |
| Apex | `apex` | TIER 1 | Student Information System & Admissions | HEALTHY |
| Nimbus | `nimbus` | TIER 2 | Curriculum & Digital Content Delivery | HEALTHY |
| Mosaic | `mosaic` | TIER 1 | Analytics, Reporting & Examination Portal | **CRITICAL** |
| Ascend | `ascend` | TIER 2 | Faculty, Staff & Resource Scheduling | HEALTHY |
| Vantage | `vantage` | TIER 1 | Finance, Tuition Billing & Payroll | HEALTHY |
| Lumo | `lumo` | TIER 1 | Central Identity & SAML/OAuth2 SSO | HEALTHY |
| Client Platform | `client-platform` | TIER 2 | Multi-Tenant District Admin & Mobile API | HEALTHY |

Each application record carries: uptime 24h/7d/30d, RTO/RPO targets, replication lag, PRD/DR server IDs, P50/P95/P99 latency, error rate %, Cloudflare zone, deployment version, last recovery drill date, and a full dependency tree (DB, Redis, Storage, Workers, External APIs).

---

## 6. Infrastructure Overview

**16 Hostinger KVM VPS nodes** across 4 regions — all seeded into the `servers` table:

| Region | PRD Nodes | DR Nodes |
|---|---|---|
| Singapore | Cipher, Mosaic, Vantage | Cipher, Mosaic, Vantage, Lumo, Nimbus |
| Frankfurt | Apex, Ascend, Lumo | Ascend, Client Platform |
| Mumbai | Nimbus | — |
| London | Client Platform | Apex |

The Mosaic PRD server starts in CRITICAL state (CPU ~97%, RAM ~95%) with the active incident `INC-1001`. All other nodes are HEALTHY. Agent status is tracked as `CONNECTED / STALE / DISCONNECTED`. Stale detection fires after 120 seconds of no telemetry.

---

## 7. Frontend Architecture

### State Management

`src/context/OpsContext.tsx` is the single source of truth for all UI state. It manages 14 state slices, 13 memoized action callbacks, and 4 computed `systemSummary` values. Background timers jitter telemetry every 5 seconds for realism and increment a `lastUpdatedSecondsAgo` counter every second.

### Navigation

Tab-based via `activeTab` string (no React Router). `App.tsx` switches on `activeTab` to render one of 17 view components. All 17 tabs are functional.

### Overview Dashboard (recently redesigned)

The Overview is the most complex view. It now includes:

- **Header** with live `OPERATIONAL / WARNING / CRITICAL` health badge + real-time API connectivity badge (pings `localhost:4000/health` every 15s)
- **8 metric cards** — status-aware color coding, hover scale animation, smart `ALL OK / ALERT` badges
- **3-column live infrastructure row** — animated CPU/RAM fill bars calculated from live server telemetry, plus an active incident summary card (or all-clear card)
- **The 5 Operational Answers panel** — dynamically built from actual incident data (not hardcoded)
- **4 visual charts** — Heartbeat ECG, Traffic Flow, Incident Flow, Telemetry Area Graphs
- **Application Failover Matrix table** — 10 columns including Error%, color-coded P95 latency, `⚡ DR ACTIVE` badge
- **VPS Fleet preview** — 8-node grid with per-node CPU/RAM mini bars, status dot, region badge

### Frontend Views (all 17 complete)

| View | Key Features |
|---|---|
| Shell | Collapsible sidebar, 7 nav sections with live counts, incident banner, watchdog dot |
| Overview | Redesigned — metric cards, live API badge, 5-answers panel, charts, app matrix, VPS grid |
| Applications | 10-tab modal: overview, health, monitors, infra, deps, DR, backups, incidents, deployments, history |
| Infrastructure | Searchable VPS grid, 4-tab detail modal (system, processes, services, logs) |
| Monitors | Probe table, history view, Run Probe button, consecutive check counters |
| Incidents | Severity-coded list, 7-tab workspace (summary, timeline, signals, blast radius, comms, runbook, notes) |
| DR Dashboard | 6-item readiness checklist, live failover/failback toggle, TrafficFlowChart |
| Backups | Record table, integrity status, restore test evidence |
| Dependency Map | Visual topology: Users → Cloudflare → VPS → App → Dependencies |
| Cloudflare | Zone selector, DNS table, LB status, WAF events, SSL expiry, drift detection |
| Hostinger | Provider overview, hardware specs, region groups |
| Deployments | Pipeline stage tracking, rollback flag |
| Runbooks | Interactive SOP execution, step completion tracking |
| Maintenance | Windows management, monitor suppression |
| Communications | Channel dispatch, test notifications, escalation policies |
| Reports | Daily ops briefing, copy + download as .txt |
| Audit Logs | Append-only operator action table |

---

## 8. Backend Architecture

### Entry Points

- `server.ts` — creates HTTP server, initialises WebSocket, starts 3 workers, handles graceful shutdown (SIGTERM/SIGINT, 15s forced exit)
- `app.ts` — Express app factory: security middleware (helmet, cors, compression), rate limiting, body parsing, all 16 route modules, telemetry ingest endpoints, 404/error handlers

### Module Pattern

Each module follows `service.ts` → `controller.ts` (optional) → `routes.ts`. Services contain all database logic. Routes wire Express handlers with authenticate + requirePermission middleware + Zod validation.

### Security Middleware Stack

```
requestId → helmet → cors → compression → pinoHttp
  → rateLimit → bodyParser → authenticate → requirePermission → validate → handler
```

---

## 9. Database Schema

9 migration files applied to PostgreSQL 17. All tables use UUID primary keys, `created_at`/`updated_at` timestamps, and soft deletes where appropriate.

### Core Tables

| Table | Purpose |
|---|---|
| `roles` | viewer, operator, it_administrator, super_admin |
| `permissions` | action + resource pairs (e.g. `acknowledge:incidents`) |
| `role_permissions` | M2M join |
| `users` | Operator accounts with bcrypt hashes, lock/activation |
| `refresh_tokens` | Hashed refresh tokens with expiry and revocation |
| `applications` | 8 Scholario apps with all operational metadata |
| `app_dependencies` | Per-app dependency records (DB, Redis, Workers, etc.) |
| `servers` | 16 VPS nodes with region, plan, agent status |
| `server_metrics` | Time-series CPU/RAM/Disk/Network per server |
| `server_services` | Snapshot of running services per server |
| `server_processes` | Snapshot of running processes per server |
| `server_logs` | Structured log entries from agents |
| `monitors` | Probe definitions with thresholds and consecutive counters |
| `monitor_results` | Every check result with response time and status |
| `incidents` | Tickets with fingerprint deduplication |
| `incident_events` | Immutable timeline entries |
| `incident_notes` | Operator investigation notes |
| `notification_channels` | Teams / Email / Webhook / PagerDuty |
| `notification_deliveries` | Every dispatch attempt with response tracking |
| `escalation_policies` | Severity → channel → timing ladder |
| `escalation_steps` | Ordered steps per policy |
| `active_escalations` | Tracks which step each open incident is at |
| `backups` | Backup records with integrity hash + restore evidence |
| `replications` | Replication lag tracking per app |
| `deployments` | Pipeline records with stage history |
| `deployment_events` | Stage transition log |
| `maintenance_windows` | Downtime windows with monitor suppression |
| `runbooks` | SOP definitions with versioning |
| `runbook_steps` | Ordered steps per runbook |
| `runbook_executions` | Execution sessions per operator |
| `runbook_step_completions` | Which steps completed in each session |
| `cloudflare_zones` | Zone records synced from Cloudflare API |
| `cloudflare_dns_records` | DNS record snapshots |
| `cloudflare_load_balancers` | LB pool state per zone |
| `dead_man_controls` | Watchdog heartbeat tracking |
| `audit_logs` | Append-only operator action log (never updated/deleted) |
| `system_settings` | Key/value config store |
| `schema_migrations` | Applied migration tracking |

---

## 10. API Reference

All endpoints are prefixed with `/api/`. Authentication via `Authorization: Bearer <jwt>` header except `/auth/login` and `/auth/refresh`.

### Auth

| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | Returns accessToken + refreshToken |
| POST | `/auth/refresh` | Rotates refresh token |
| POST | `/auth/logout` | Revokes refresh token |
| GET | `/auth/me` | Returns current user |
| POST | `/auth/change-password` | Validates current password |

### Core Resources

| Method | Path | Min Role |
|---|---|---|
| GET | `/applications` | viewer |
| GET | `/applications/:id` | viewer |
| POST | `/applications` | it_administrator |
| PATCH | `/applications/:id` | it_administrator |
| DELETE | `/applications/:id` | it_administrator |
| GET | `/servers` | viewer |
| GET | `/servers/:id` | viewer |
| GET | `/servers/:id/metrics?hours=1` | viewer |
| POST | `/servers` | it_administrator |
| PATCH | `/servers/:id` | it_administrator |
| DELETE | `/servers/:id` | it_administrator |
| GET | `/monitors` | viewer |
| GET | `/monitors/:id` | viewer |
| POST | `/monitors/:id/probe` | operator |
| POST | `/monitors` | it_administrator |
| PATCH | `/monitors/:id` | it_administrator |
| DELETE | `/monitors/:id` | it_administrator |

### Incidents

| Method | Path | Min Role |
|---|---|---|
| GET | `/incidents` | viewer |
| GET | `/incidents/:id` | viewer |
| POST | `/incidents/:id/acknowledge` | operator |
| PATCH | `/incidents/:id/status` | operator |
| PATCH | `/incidents/:id/severity` | operator |
| PATCH | `/incidents/:id/assign` | operator |
| POST | `/incidents/:id/notes` | operator |
| POST | `/incidents/:id/resolve` | operator |

### Operations

| Method | Path | Description |
|---|---|---|
| GET | `/dr/:appId/readiness` | 6-point DR readiness check |
| POST | `/dr/failover` | Trigger failover/failback (super_admin only) |
| GET | `/backups` | List backup records |
| PATCH | `/backups/:id/verify` | Record integrity check |
| PATCH | `/backups/:id/restore-test` | Record restore drill result |
| GET | `/deployments` | List deployments |
| POST | `/deployments` | Create deployment record |
| PATCH | `/deployments/:id/status` | Update stage |
| GET | `/runbooks` | List runbooks |
| GET | `/runbooks/:id` | Runbook + steps |
| POST | `/runbooks/:id/execute` | Start execution session |
| PATCH | `/runbooks/executions/:id/steps/:stepId` | Mark step complete |
| GET | `/maintenance` | List windows |
| POST | `/maintenance` | Create window + suppress monitors |
| PATCH | `/maintenance/:id/complete` | End window + re-enable monitors |

### Notifications & Integrations

| Method | Path | Description |
|---|---|---|
| GET | `/notifications/channels` | List channels |
| POST | `/notifications/channels/:id/test` | Send live test payload |
| GET | `/notifications/deliveries` | Delivery history |
| GET | `/cloudflare/zones` | Zones from DB |
| POST | `/cloudflare/sync` | Pull from Cloudflare API |
| GET | `/hostinger/servers` | Hostinger VPS list |
| POST | `/hostinger/sync` | Pull from Hostinger API |
| GET | `/reports/summary` | System health summary (used by Overview) |
| GET | `/reports/daily` | Structured daily ops briefing |
| GET | `/reports/uptime` | Uptime stats per application |
| GET | `/audit` | Paginated audit logs |
| GET | `/users` | List users (it_administrator+) |
| POST | `/users` | Create user |
| PATCH | `/users/:id` | Update user |
| DELETE | `/users/:id` | Deactivate user (super_admin) |

### Telemetry (Agent Ingest — no JWT, uses internal network)

| Method | Path | Description |
|---|---|---|
| POST | `/telemetry/metrics` | Agent pushes CPU/RAM/Disk/services/processes/logs |
| POST | `/telemetry/heartbeat` | Dead-man watchdog heartbeat |

---

## 11. Background Workers

All three workers start automatically when the backend boots (skipped in test env).

### Monitor Worker (`monitorWorker.ts`)

- Runs a dispatch loop every **10 seconds** via node-cron
- Reads all enabled, non-maintenance monitors from PostgreSQL
- Tracks last-run timestamps in Redis per monitor ID
- Dispatches concurrent probes up to `MONITOR_WORKER_CONCURRENCY` (default 5)
- After each probe: updates consecutive failure/recovery counters
- **Incident auto-creation**: When `consecutive_failures >= failure_confirmation_threshold` (default 3), creates or deduplicates an incident via fingerprint
- Broadcasts `monitor.status.changed` and `incident.created` via WebSocket
- Dispatches notifications on incident creation
- Also runs:
  - Stale agent detection every **2 minutes** — marks servers STALE if no telemetry for 120s
  - Maintenance window expiry every **1 minute** — auto-completes expired windows and re-enables suppressed monitors

### Escalation Worker (`escalationWorker.ts`)

- Runs every **1 minute** via node-cron
- Queries `active_escalations` for rows where `next_escalate_at <= NOW()`
- For each due escalation: finds the next policy step, dispatches via NotificationsService, advances to next step
- When all steps exhausted: removes from `active_escalations`
- Logs all escalation dispatches with incident ID and step number

### Dead-Man Watchdog Worker (`deadManWorker.ts`)

- Runs every **15 seconds** via node-cron
- Reads all `dead_man_controls` rows
- Calculates age of last heartbeat vs tolerance threshold
- If silent past tolerance: updates status to `CRITICAL_SILENCE`, broadcasts via WebSocket, dispatches alert (max once per 15 minutes)
- Exported `recordHeartbeat()` is called by the `/api/telemetry/heartbeat` endpoint

---

## 12. Realtime WebSocket

WebSocket server at `ws://localhost:4000/ws`.

**Authentication**: Pass JWT as query param `?token=<jwt>`. Unauthenticated connections can still receive events (useful for read-only monitoring boards).

**Heartbeat**: Server pings all clients every 30s. Dead connections are terminated.

### Event Types Broadcast

| Event | Trigger |
|---|---|
| `server.health.changed` | Telemetry ingest or stale detection |
| `monitor.status.changed` | Monitor probe changes status |
| `incident.created` | New incident from monitor worker |
| `incident.updated` | Any incident field change |
| `incident.resolved` | Incident marked resolved |
| `notification.sent` | Channel dispatch completed |
| `backup.status.changed` | Backup record status update |
| `replication.status.changed` | Replication lag threshold crossed |
| `failover.started` | DR failover initiated |
| `failover.completed` | Failover state confirmed |
| `deployment.updated` | Deployment stage change |
| `deadman.status.changed` | Watchdog goes HEALTHY ↔ CRITICAL_SILENCE |
| `system.summary.updated` | Periodic summary refresh |

---

## 13. Authentication & RBAC

### JWT Flow

1. POST `/auth/login` → returns `accessToken` (15min) + `refreshToken` (7 days)
2. Include `Authorization: Bearer <accessToken>` on all protected requests
3. POST `/auth/refresh` with `refreshToken` to rotate both tokens
4. Refresh tokens are hashed (SHA-256) before storage — raw token never stored

### Password Security

- bcrypt with 12 rounds
- Failed login tracking — account locks after 5 failures for 15 minutes
- Passwords never returned in any API response

### Role Hierarchy

| Role | Level | Key Permissions |
|---|---|---|
| `viewer` | 1 | Read all dashboards, reports, applications, infrastructure |
| `operator` | 2 | + Acknowledge/resolve incidents, run probes, execute runbooks, create maintenance |
| `it_administrator` | 3 | + Manage monitors, applications, servers, users, communications |
| `super_admin` | 4 | Full access including failover, role management, system settings |

All permissions are enforced **server-side**. RBAC checks run before every handler. Permissions are cached in Redis for 5 minutes per role.

---

## 14. Monitoring Engine

The monitoring engine supports these probe types:

| Type | Implementation |
|---|---|
| `HTTP` / `HTTPS` / `APP_HEALTH` / `APP_READINESS` / `API_BUSINESS` | Real HTTP request with configurable method, expected status, timeout |
| `TCP` | Raw TCP socket connect with timeout |
| `DNS` | `dns.resolve()` with timing |
| `SSL` | TLS handshake, reads cert expiry in days (warn <30d, critical <7d) |
| `DEAD_MAN` | Checks age of last heartbeat in `dead_man_controls` table |
| `CRON_HEARTBEAT` / `WORKER_HEARTBEAT` | Driven by telemetry ingest |
| `INFRA_CPU` / `INFRA_RAM` / `INFRA_DISK` | Evaluated from latest `server_metrics` |
| `DB_CONN` | TCP check to DB host:port |
| `DB_REPLICATION` | Read from `replications` table lag |
| `BACKUP_FRESHNESS` | Age check on latest successful backup |

### Consecutive Check Logic

Missing telemetry or a single failure does **not** create an incident.

```
Check 1 → FAIL  → consecutive_failures = 1  (no incident)
Check 2 → FAIL  → consecutive_failures = 2  (no incident)
Check 3 → FAIL  → consecutive_failures = 3  ✓ CONFIRMED → create/update incident

Recovery:
Check 1 → PASS  → consecutive_recoveries = 1
Check 2 → PASS  → consecutive_recoveries = 2
Check 3 → PASS  → consecutive_recoveries = 3  ✓ CONFIRMED → resolve incident
```

Both thresholds are configurable per monitor.

---

## 15. Incident Engine

### Lifecycle States

```
OPEN → ACKNOWLEDGED → INVESTIGATING → MITIGATING → MONITORING → RESOLVED → CLOSED
```

### Deduplication via Fingerprinting

Every incident has a deterministic fingerprint built from:
```
{applicationId}:{environment}:{monitorId}:{failureType}
```

Before creating a new incident, the engine checks for an open incident with the same fingerprint. If found, it adds a timeline event instead. This prevents 100 duplicate tickets for one sustained failure.

### Incident Records Include

- Ticket number (INC-XXXX sequence)
- Severity, status, owner
- Application + server + monitor links
- Full immutable timeline (incident_events)
- Operator notes (incident_notes)
- Affected services + monitors arrays
- Root cause, recovery status
- Correlated deployment ID (if failure starts within minutes of a deploy)
- Duration in minutes (auto-calculated on resolve)

---

## 16. Notification System

### Supported Channels

| Type | Delivery Method |
|---|---|
| `TEAMS` | HTTP POST to Outlook webhook URL with MessageCard format |
| `EMAIL` | SMTP via nodemailer (configurable host/port/auth) |
| `WEBHOOK` | Generic HTTP POST with JSON payload |
| `PAGERDUTY` | HTTP POST (PagerDuty-compatible format) |

### Delivery Tracking

Every dispatch attempt is stored in `notification_deliveries` with:
- Status: PENDING → DELIVERED / FAILED / RETRYING
- HTTP response code and response body
- Error message on failure
- Attempt count and next retry timestamp

### Escalation Engine

Policies define severity → ordered steps (channel + delay). The escalation worker processes due steps every minute and advances through the ladder until the incident resolves or all steps are exhausted.

---

## 17. DR & Failover

### Readiness Check (6 points)

Before any failover, `DrService.getReadiness()` validates:

1. **Data Replication** — lag vs RPO target (from `replications` table)
2. **DR Standby Compute** — DR server status and agent connection
3. **Snapshot Freshness** — latest successful backup age
4. **Restore Drill Verification** — last tested recovery date
5. **DR Monitor Health** — any CRITICAL monitors on DR environment
6. **Cloudflare LB Pool** — health check status on DR origin

### Failover Flow

```
Validate permissions (super_admin required)
  → Run 6 readiness checks
  → Fail if any check is FAILED (not just WARNING)
  → Set failover_state = FAILING_OVER
  → Execute Cloudflare origin switch (API call when token configured)
  → Set failover_state = DR_ACTIVE / PRIMARY_ACTIVE
  → Write audit log entry
  → Dispatch notifications to all enabled channels
  → Broadcast failover.completed via WebSocket
```

---

## 18. Visual Components

All in `src/components/visuals/` — SVG-based, no external chart library:

| Component | Description |
|---|---|
| `HeartbeatPulseChart` | Animated ECG-style waveform showing live monitor heartbeat |
| `TrafficFlowChart` | Anycast architecture: Users → Cloudflare → LB → PRD/DR origins |
| `IncidentFlowChart` | Incident lifecycle state machine with 3-check confirmation logic |
| `TelemetryAreaGraph` | SVG area chart with configurable warning threshold line and color |

---

## 19. Command Palette

Triggered by `Ctrl+K` / `Cmd+K`. Searches across 7 categories simultaneously:

| Category | Items |
|---|---|
| ROUTES | 20+ navigation destinations with live status badges |
| APPS | All 8 applications — navigate + inspect |
| SERVERS | All 16 VPS nodes — navigate + inspect |
| INCIDENTS | All tickets — navigate + open |
| MONITORS | All probes — run probe + navigate |
| RUNBOOKS | All SOPs — open + navigate |
| ACTIONS | Failover/failback, acknowledge, resolve, test notifications, download report, simulator |

Full keyboard navigation (↑↓ arrows, Enter to execute, Escape to close) with action feedback toasts.

---

## 20. Simulator Engine

The SIMULATOR dropdown (top bar) and Command Palette provide 4 live scenarios that mutate frontend state:

| Scenario | Effect |
|---|---|
| **Verify Recovery & Failback** | Mosaic PRD → HEALTHY, 3 monitor passes, failover reverts, INC resolved |
| **Inject MySQL Pool Exhaustion** | Mosaic PRD CPU spikes, monitors CRITICAL (3 checks), DR_ACTIVE, INC reopens |
| **Toggle Watchdog Silence** | Dead-Man flips HEALTHY ↔ CRITICAL_SILENCE (4 misses) |
| **Reset State to Baseline** | Clears localStorage, restores all initial data |

---

## 21. Feature Completion Status

### Frontend

| Feature | Status | Notes |
|---|---|---|
| Shell (sidebar, topbar, incident banner) | ✅ Complete | Collapsible, dark/light, live badges |
| Command Palette (Ctrl+K) | ✅ Complete | 7 categories, keyboard nav, action feedback |
| Overview Dashboard | ✅ Complete + Redesigned | API badge, animated metric cards, live infra bars, dynamic 5-answers |
| Applications View + 10-tab modal | ✅ Complete | Full detail per app |
| Infrastructure View + 4-tab modal | ✅ Complete | System, processes, services, logs |
| Monitors View | ✅ Complete | Probe run, history, consecutive counters |
| Incidents View + 7-tab modal | ✅ Complete | Full incident workspace |
| DR Dashboard + Failover | ✅ Complete | Readiness checklist, live toggle |
| Backups View | ✅ Complete | Integrity, restore test evidence |
| Dependency Map | ✅ Complete | Visual topology + table |
| Cloudflare View | ✅ Complete | DNS, WAF, LB, drift detection |
| Hostinger View | ✅ Complete | Provider fleet overview |
| Deployments View | ✅ Complete | Pipeline stages, rollback |
| Runbooks View | ✅ Complete | Interactive step execution |
| Maintenance View | ✅ Complete | Windows, suppression |
| Communications View | ✅ Complete | Channels, escalation policies |
| Reports View | ✅ Complete | Generated text, download/copy |
| Audit Logs View | ✅ Complete | Append-only table |
| Visual Charts (4) | ✅ Complete | ECG, Traffic Flow, Incident Flow, Area Graph |
| Dark / Light Theme | ✅ Complete | All components fully themed |
| Simulator Engine | ✅ Complete | 4 scenarios |
| localStorage Persistence | ✅ Complete | 7 keys synced |
| Live Telemetry Simulation | ✅ Complete | 5s jitter loop |
| Dead-Man Watchdog (UI) | ✅ Complete | Sidebar dot + state |
| Critical Incident Banner | ✅ Complete | Auto-shown, INVESTIGATE CTA |
| Frontend API badge | ✅ Complete | Real ping to backend /health every 15s |

### Backend

| Feature | Status | Notes |
|---|---|---|
| PostgreSQL schema (9 migrations) | ✅ Complete | 37 tables, all applied |
| Seed data | ✅ Complete | 8 apps, 16 servers, 1 incident, runbook, channels, dead-man |
| Config + environment management | ✅ Complete | Fully typed, dotenv |
| Structured logging (pino) | ✅ Complete | JSON logs, dev pretty-print |
| Request IDs | ✅ Complete | UUID per request, X-Request-Id header |
| JWT authentication | ✅ Complete | Access (15m) + refresh (7d) tokens |
| Refresh token rotation | ✅ Complete | Old token revoked on rotate |
| Account locking | ✅ Complete | 5 failures → 15 min lock |
| RBAC (4 roles, 36 permissions) | ✅ Complete | Server-side enforced, Redis cached |
| Applications API | ✅ Complete | CRUD + failover state |
| Servers API | ✅ Complete | CRUD + metrics history |
| Telemetry ingest API | ✅ Complete | Agent push endpoint |
| Monitors API | ✅ Complete | CRUD + single probe execution |
| Real probe engine (HTTP/TCP/DNS/SSL) | ✅ Complete | All types implemented |
| Consecutive check logic | ✅ Complete | Configurable thresholds |
| Incidents API | ✅ Complete | Full lifecycle + 6 actions |
| Incident deduplication (fingerprinting) | ✅ Complete | Prevents duplicate tickets |
| Notifications API | ✅ Complete | Real Teams/Email/Webhook dispatch |
| Delivery tracking | ✅ Complete | Every attempt stored |
| DR readiness checks | ✅ Complete | 6-point validation |
| Failover API | ✅ Complete | Permission-gated, readiness-validated |
| Backups API | ✅ Complete | CRUD + verify + restore-test |
| Deployments API | ✅ Complete | Pipeline stages + events |
| Runbooks API | ✅ Complete | CRUD + execution sessions + step completions |
| Maintenance API | ✅ Complete | Windows + monitor suppression/resume |
| Cloudflare integration (read) | ✅ Complete | Zone sync from CF API |
| Hostinger integration (read) | ✅ Complete | VPS list sync |
| Reports API | ✅ Complete | Summary, daily briefing, uptime |
| Audit logs API | ✅ Complete | Append-only, paginated |
| Users API | ✅ Complete | CRUD with role management |
| WebSocket server | ✅ Complete | Auth, broadcast, per-user, heartbeat |
| Monitor worker (scheduler) | ✅ Complete | 10s dispatch loop, stale detection |
| Escalation worker | ✅ Complete | Policy ladder execution |
| Dead-man watchdog worker | ✅ Complete | Silence detection + alerts |
| AES-256-GCM encryption utility | ✅ Complete | For secrets at rest |
| Global error handling | ✅ Complete | Typed errors, no secrets leaked |
| Rate limiting | ✅ Complete | Global + strict auth endpoint |
| CORS configuration | ✅ Complete | Origin whitelist from env |
| Graceful shutdown | ✅ Complete | Closes DB/Redis on SIGTERM |
| TypeScript (zero errors) | ✅ Complete | `tsc --noEmit` passes |

---

## 22. What Remains

### High Priority (Phase 9 — Frontend ↔ API Integration)

1. **API client layer** — Create `src/services/api.ts` with typed fetch wrappers and token management
2. **Replace OpsContext data** with API calls — `useEffect` fetches on mount, WebSocket updates in real-time
3. **React Router** — Add URL-based navigation so deep links work (`/incidents/INC-1001`)
4. **Login screen** — Auth flow: login form → store tokens → redirect to dashboard
5. **RBAC-aware UI** — Hide/disable buttons based on current user's role
6. **Loading / error states** — Skeleton loaders, error boundaries, retry logic
7. **Pagination** — Server-side pagination for audit logs, incidents, monitor results

### Medium Priority

8. **Mobile optimization** — Sidebar drawer overlay, responsive modals
9. **Accessibility (WCAG)** — ARIA roles, focus traps in modals, keyboard navigation
10. **Tests** — Vitest unit tests for services, API integration tests (framework already installed)

### Low Priority / Optional

11. **Gemini AI** — `@google/genai` is installed but unused. Could power incident summarization or natural language log querying
12. **CI/CD pipeline** — GitHub Actions: lint → typecheck → test → build → deploy
13. **Production deployment** — Nginx reverse proxy, HTTPS, PM2/systemd, DB backups, log rotation

---

## 23. Running the Project

### Prerequisites
- Node.js 22+
- PostgreSQL 17 running on `localhost:5432`
- Redis running on `localhost:6379`

### Frontend (standalone — no backend required)
```bash
cd "d:\ByLine-Koti\Scholario Ops"
npm install
npm run dev
# → http://localhost:3000
```

### Backend (first time setup)
```bash
cd "d:\ByLine-Koti\Scholario Ops\server"

# Copy and configure environment
copy .env.example .env
# Edit .env — set DATABASE_URL, REDIS_URL, JWT_SECRET, etc.

npm install

# Apply all 9 migrations
npm run migrate

# Seed demo data (8 apps, 16 servers, users, incident, runbook, etc.)
npm run seed

# Start backend dev server
npm run dev
# → http://localhost:4000
```

### Both Together (after first-time setup)
```bash
# Terminal 1 — Backend
cd "d:\ByLine-Koti\Scholario Ops\server"
npm run dev

# Terminal 2 — Frontend
cd "d:\ByLine-Koti\Scholario Ops"
npm run dev
```

### Verify Both Running
```
http://localhost:3000         → Frontend dashboard
http://localhost:4000/health  → {"status":"ok","service":"scholario-ops-api"}
ws://localhost:4000/ws        → WebSocket (connect with ?token=<jwt>)
```

---

## 24. Default Credentials

Seeded by `npm run seed`:

| Role | Email | Password |
|---|---|---|
| super_admin | admin@scholario.net | Admin@Scholario2026! |
| operator | arjun.mehta@scholario.net | Operator@Scholario2026! |

Test the login API:
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@scholario.net","password":"Admin@Scholario2026!"}'
```

---

*Last updated: October 2026 · Scholario IT Operations Control Center*  
*Backend: v1.0.0 · Frontend: v0.0.0 · PostgreSQL: 17 · Node.js: 22*
