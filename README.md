# Scholario Ops

Operations dashboard for applications running on a PRD (main) VPS and a DR (standby) VPS, with Cloudflare DNS failover.
All data is real. The server probes your endpoints, an agent on each VPS reports telemetry, and Cloudflare and Hostinger are read through their APIs.

All backend code is in `server/` (entry point `server/server.ts`). One process serves both the API and the React dashboard. **PostgreSQL is the single source of truth**: every server, application, Cloudflare mapping, monitor, check result, incident and audit entry lives in the schema `DB_SCHEMA` (default `ops`) of `DATABASE_URL`. Back up that database.

> The frontend is in `src/` (React + Vite); the backend is in `server/`.

## Run locally

```bash
cp .env.example .env      # set ADMIN_EMAIL (and optionally ADMIN_PASSWORD)
npm install
npm run dev               # http://localhost:3000
```

If `ADMIN_PASSWORD` is empty, the first start prints a generated password in the console.

## Configuration: entered in the dashboard, stored in PostgreSQL

Nothing about an application is hardcoded. An administrator enters it in **Setup & Connections**, and it's saved to PostgreSQL. The monitoring engine, Cloudflare poller, DR readiness and failover pre-flight all read it from there.

| Form | Fields | Table |
|---|---|---|
| Add / edit server | hostname, public IP, role PRD/DR, provider, region, plan name, CPU cores, RAM GB, disk GB, notes | `servers` |
| Add / edit application | name, code name, tier, PRD/DR server, RTO, RPO, description | `applications` |
| → Origin / application URLs | PRD URL, DR URL, expected status, interval, timeout, TLS monitoring | `applications` (`prd_url`, `dr_url`, `hc_*`) → managed monitors |
| → Cloudflare Load Balancer | account ID, LB hostname, PRD pool ID, DR pool ID ("Load pools" lists them through the server) | `application_load_balancers` |
| → DNS / failover | Cloudflare zone, failover DNS record, automatic failover (off by default; unavailable with an LB) | `applications` |

- **Saving a URL takes effect on the next check.** It creates or updates that environment's URL monitor and TLS monitor (marked "app URL").
- **Changing pools or the LB hostname takes effect on the next Cloudflare poll.**
- **The Cloudflare API token stays in `.env` on the server.** "Load pools" asks the backend, which calls Cloudflare and returns only pool names, IDs and origins.

On first start against an empty database, an existing `data/ops-store.json` (the old file store) is imported once and renamed `*.imported-to-postgres-<date>`.

## ICT (current configuration, stored in PostgreSQL)

| | Production / Primary | Disaster Recovery / Standby |
|---|---|---|
| VPS | 93.127.167.135 (KVM 8: 8 CPU, 32 GB, 400 GB) | 187.126.113.32 (KVM 2: 2 CPU, 8 GB, 100 GB) |
| URL | https://ict.kodeit.digital/login/index.php | https://dr-ict.kodeit.digital/login/index.php |
| Cloudflare pool | ict-production `96da29b691ca39967f46d46fa32cdfee` | ict-dr-standby `287cdf4fdd2d9f86e4c9700784079549` |

To change any of these, edit the server or the ICT application in Setup. These values exist only in the database; to set up a new, empty database, enter them in Setup or restore a database backup (`pg_dump --schema=ops`).

All status values come from live sources:
- **HTTPS monitors** check both URLs every 30 s. Results are classified as UP, DEGRADED, DOWN, TIMEOUT, DNS_ERROR, TLS_ERROR or CONNECTION_ERROR and stored in `DATA_DIR/checks/`.
- **Cloudflare Load Balancing** reads pools, pool health, origin RTT and response codes every 60 s, read-only (account `3d3255caf03b25ccf9e2d7abd0d26d15`). If the token or a permission is missing, the dashboard says "Not configured" or "Cloudflare permission required".
- **Agent** sends CPU, memory, disk, load, network, services and processes. Install it on each ICT VPS from Infrastructure/Setup. It only makes outbound HTTPS calls to `PUBLIC_URL`, so no ports are opened on the VPS.
- **Incidents** are raised when a monitor is confirmed DOWN (with Cloudflare origin correlation) or when Cloudflare marks an origin unhealthy. Recovery is recorded automatically.
- **DR readiness** runs 13 checks (PASS, FAIL, WARNING or UNKNOWN) and gives an overall READY, NOT READY, DEGRADED or UNKNOWN.
- **Failover**: Scholario Ops never changes Cloudflare for ICT. The failover console runs pre-flight checks, shows the manual steps for Cloudflare, and records an approve or reject decision in the audit log.

## First-time setup (in the dashboard → **Setup**)

1. **Add server.** Register the Main VPS (role PRD) and the DR VPS (role DR) with their public IPs.
2. **Agent.** Run the install command on each VPS as root. Within about 15 seconds the agent shows CONNECTED.
3. **Add application.** Choose the PRD and DR servers, the Cloudflare zone and the DNS record to switch on failover. Optionally tick the starter health monitors.
4. **Notifications.** Add a Teams, Email, Webhook or PagerDuty channel.

## Production

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the step-by-step guide: Ubuntu VPS, PostgreSQL, PM2, nginx + HTTPS, moving your data, agents, backups and a checklist.

## Integrations (`.env`)

| Variable | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Read-only ICT monitoring: Account › Load Balancing: Monitors and Pools › Read, Zone › Load Balancers › Read and Zone › Zone › Read. DNS:Edit is only needed for DNS-record failover of other apps. |
| `HOSTINGER_API_TOKEN` | Optional. Imports plan, CPU, RAM and state for registered servers. |
| `SMTP_*` | Email notification channels. |
| `DEADMAN_HEARTBEAT_URL` | Deprecated and ignored. The dead-man heartbeat now covers the monitored servers, applications, services and databases from the agents' reports — no external watchdog. |
| `DEPLOY_REPORT_TOKEN` | Lets CI report deployments to `POST /api/v1/deployments/report`. |

## Scripts

- `npm test`: end-to-end tests against throw-away PostgreSQL schemas (needs `DATABASE_URL`).
- `npm run db:migrate`: apply PostgreSQL migrations.

- `npm run dev`: API and UI with Vite.
- `npm run build`: production build.
- `npm start`: run the build.
- `npm run lint`: type-check the frontend and backend.
