# Task 01 — Existing Application Codebase Analysis

**Project:** Application Dependency & Business Impact Monitoring MVP  
**Platform:** Scholario Ops (`scholario-ops` 1.0.0) — existing production monitoring application  
**Constraint:** Extend this platform. Do not rewrite it.  
**Status:** Verified 16 Nov 2026 against the source tree and the configured database. After approval, migration `017_dependency_mvp.sql` was applied by restarting the dev server. No application, server, monitor, or dependency row was inserted.

The dependency register this MVP needs is already in the product. New work should extend `registry_components`, `dependency_links`, and the impact functions. It should not add a second dependency system beside them.

The database in `.env` is local PostgreSQL database `scholario_ops_dev`, schema `ops`, role `scholario_ops`. It is not a remote production host. “PRD” and “DR” in this note are the `environment` values stored on server rows.

### Platform facts verified from that database

- Nine applications. Each has a production server id. Six also have a disaster-recovery server id. LXP Portal, Scholario Lumo, and Scholario Websites do not.
- `registry_components` has one `APPLICATION` row for each of those nine, each pointing at that application id. `dependency_links` has zero rows.
- ICT (Cipher LMS) and QR Videos store application status `HEALTHY`. Failover state is `PRIMARY_ACTIVE`, so that status comes from PRD monitors. Both have `CRITICAL` monitors on DR.
- The other seven applications have no monitors and store status `UNKNOWN`.
- All 15 servers store `agentStatus` `DISCONNECTED`, `status` `UNKNOWN`, and a `lastSeen` value. `vpsOperationalStatus` would return `STALE` for that shape. The stored status has not been rewritten to `STALE`.
- Incidents: 22 `OPEN`, 9 `CLOSED`, 47 `RESOLVED`. None were changed.
- `017_dependency_mvp.sql` is applied. `dependency_links` has `method` and `updated_at`. The link count is still zero.

### Rules for any later dependency work

1. Do not insert a second copy of an application that already exists.
2. Do not insert a second copy of a server that already exists.
3. Keep “runs on” (PRD/DR server ids) separate from service dependencies.
4. Do not treat UNKNOWN as DOWN.
5. Do not treat a missing dependency row as proof that no dependency exists.
6. Do not invent dependencies between applications.
7. Preserve existing monitor and incident behaviour.
8. Reuse `registryImpact`, `previewImpact`, and `registryPaths` before writing another impact implementation.

---

## 1. Existing backend architecture

One Node.js process (`server/server.ts`, Node `>= 20`, ESM, TypeScript) serves the REST API, the Server-Sent Events stream, and the React dashboard. PostgreSQL is the system of record. There is no Redis and no WebSocket server.

### Folder structure

| Path | Role |
|---|---|
| `server/server.ts` | Entry: Express, headers, rate limit, health, API mount, Vite (dev) or static SPA (prod), shutdown |
| `server/routes.ts` | All HTTP handlers in `buildRouter()` |
| `server/store.ts` | Load the working set into memory; `persist()` writes dirty rows back |
| `server/db.ts` | `pg` pool, transactions, migration runner |
| `server/migrations/` | `001_init.sql` through `017_dependency_mvp.sql`. The configured database has applied `001`–`016` only |
| `server/engine.ts` | Monitor scheduler, outcome application, derived application and server status |
| `server/probes.ts` | HTTP(S), TCP, DNS, TLS probes |
| `server/appMonitors.ts` | Creates and updates URL and SSL monitors from `prdUrl` / `drUrl` |
| `server/health.ts` | Per-environment app, database, and backup health |
| `server/readiness.ts` | DR readiness and failover pre-flight |
| `server/auth.ts` | Passwords, tokens, `requireAuth`, `requireRole` |
| `server/registry.ts` | Dependency register validation and `registryImpact` |
| `server/incidentImpact.ts` | Impact snapshots, paths, live status for register rows |
| `server/alerts.ts`, `server/notify.ts` | Alert evaluation and channel delivery |
| `server/cloudflare.ts`, `server/loadbalancer.ts`, `server/workers.ts`, `server/hostinger.ts` | Read-only provider sync |
| `server/providers/` | Provider connections, inventory sync, VPS registration |
| `server/config.ts`, `server/validate.ts`, `server/logger.ts`, `server/secrets.ts` | Env, validation, redacted logs, sealed secrets |

There is no `controllers/`, `services/`, or `repositories/` tree. The split that exists is:

- **HTTP:** `server/routes.ts` (validation, role checks, `{ success, data }` responses).
- **Domain services:** one module per concern (`engine`, `health`, `registry`, `auth`, and the rest).
- **Persistence:** `db.ts` plus `store.ts`. History, metrics, and notification deliveries are batched by `history.ts`, `resourceHistory.ts`, and `deliveries.ts`.

Startup order: listen immediately, retry PostgreSQL, migrate, load the store, then start the engine and sync jobs. Until the store is ready, `/api` returns 503.

### Middleware (inline in `server.ts` and `routes.ts`)

There is no middleware folder. Order on the API:

1. Security headers and optional CORS (`server.ts`).
2. Request logging (status, duration; query strings are not logged).
3. Liveness and readiness before the store gate.
4. Store-ready gate (503 while starting).
5. Per-IP rate limit. Agent ingest, heartbeats, and health are excluded.
6. `express.json` (512 KB on agent ingest, 1 MB elsewhere).
7. Public machine routes, then `requireAuth` (`server/routes.ts` around the worker-events handler).
8. For authenticated writes, the response waits on `flush()` so a success means the row is in PostgreSQL.
9. Terminal 404 and error handler: validation 400, registry or measurement conflict 409, missing secrets key 503, other errors 500 with no stack trace.

### Authentication and authorization

Implemented in `server/auth.ts`. Roles, lowest to highest: `viewer`, `operator`, `it_administrator`, `super_admin`. `requireRole` checks the signed-in user. The same levels are mirrored in `src/lib/roles.ts` and `RbacGuard` so buttons hide; the API is the real check.

Sessions use scrypt password hashes, HS256 access tokens, and rotating refresh tokens. Login is rate-limited per IP and per account. The live stream uses a single-use ticket, not the access token in the URL. Optional OIDC routes exist (`/api/auth/oidc/*`). The first `super_admin` is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` only when the user table is empty.

Machine callers authenticate separately: per-server agent tokens, heartbeat tokens, and `DEPLOY_REPORT_TOKEN` for deployment reports.

---

## 2. Existing frontend architecture

React 19, React Router 7, Vite 8, Tailwind CSS 4, `lucide-react`. Entry: `src/main.tsx` → `src/App.tsx`.

| Path | Role |
|---|---|
| `src/App.tsx` | Routes, auth gate, lazy page loading |
| `src/context/AuthContext.tsx` | Session |
| `src/context/OpsContext.tsx` | Bootstrap payload, lists, SSE updates, toasts |
| `src/services/api.ts` | Hand-written REST client and realtime subscribe |
| `src/services/auth.ts` | Login, refresh, logout |
| `src/types/index.ts` | Models shared with the server |
| `src/lib/` | Roles, status explanation, traffic, resources, feature actions |
| `src/components/<area>/` | One folder per product area |
| `src/components/layout/Shell.tsx` | Sidebar, theme, refresh, command palette |
| `src/components/ui/` | Shared presentation components |
| `src/components/visuals/` | Charts |

`/login` is public. Every other route is inside `ProtectedRoute` and `OpsProvider`. `/` redirects to `/overview`. `/real-vps` redirects to `/setup`. Unknown paths render `NotFoundView` inside the shell.

Overview ships in the main bundle. Other pages are `React.lazy`, wrapped in `Suspense` and `ViewErrorBoundary`. `DashboardView` sets `activeTab` from the URL. The sidebar id and the path segment are the same string (`navigate('/' + item.id)`).

### Navigation

| Section | Sidebar label | Routes |
|---|---|---|
| Configuration | Setup & Connections | `/setup` |
| Command Center | Overview, Incidents | `/overview`, `/incidents` |
| Monitoring | Applications, Monitors, Credentials, Infrastructure, Capacity, Impact, Dependencies | `/applications`, `/monitors`, `/credentials`, `/infrastructure`, `/resources`, `/impact`, `/dependencies` |
| Resilience | PRD / DR Readiness, Backups | `/resilience`, `/backups` |
| Providers | Provider VPS, Cloudflare Edge | `/hostinger`, `/cloudflare` |
| Operations | Deployments, Maintenance, Runbooks | `/deployments`, `/maintenance`, `/runbooks` |
| Alerting | Notifications | `/communications` |
| Analytics & Compliance | Reliability & SLOs, Reports, Audit Logs | `/reliability`, `/reports`, `/audit` |
| Admin | Users & Account | `/users` |

There is no `/applications/:id` route. Application detail is a modal inside `ApplicationsView`. Server detail is tabs inside `InfrastructureView`. Incident detail is state inside `IncidentsView`.

### Application listing and detail

- **List:** `src/components/applications/ApplicationsView.tsx`. Search covers name, code name, URLs, DNS, and linked server hostname and IP. Each row shows status, tier, and routing.
- **Detail:** `ApplicationDetailModal` in the same file. It shows PRD/DR health dimensions (`HealthDimensions`), monitors, failover console, and impact preview. Edit reuses `AppEditor` from `SetupView`.
- **Setup:** `src/components/setup/SetupView.tsx` is where servers and applications are created. Saving a PRD or DR URL is what creates the managed HTTPS/HTTP and SSL monitors.
- **Overview:** `ApplicationStatusPanel` lists every application. DR is shown only when a DR server or URL is configured. PRD-only applications are valid.

### Server and monitoring screens

- `infrastructure/InfrastructureView.tsx`, `ServerTabs.tsx`, `ServerMetrics.tsx`, `telemetryUi.tsx` — agent telemetry.
- `monitors/MonitorsView.tsx`, `CreateMonitorModal.tsx`, `EndpointMetricsVisualizer.tsx` — monitor list, manual probe, history.
- `monitors/CredentialsView.tsx` — tracked credentials and certificate expiry.
- `resilience/DrDashboardView.tsx`, `LbFailoverConsole.tsx`, `GoLivePanel.tsx` — readiness and failover (the console records a decision; it does not change Cloudflare for load-balancer apps).
- `setup/DependencyRegister.tsx` and `resilience/DependencyMapView.tsx` — the existing register and its map.
- `impact/ImpactView.tsx` — “what breaks” using the register.

### State

`OpsContext` loads `GET /api/v1/bootstrap` and then applies SSE events (`monitor_update`, `applications_changed`, `servers_changed`, and others). There is no Redux and no React Query. Pages read context and call `src/services/api.ts` for writes.

---

## 3. Database and ORM

| Item | Fact |
|---|---|
| Engine | PostgreSQL |
| Access | `pg` (node-postgres). Pool max 10. |
| ORM | None. SQL is written in `store.ts`, history modules, and migration files. |
| Schema | `DB_SCHEMA`, default `ops`. Names are validated before interpolation. |
| Migrations | Forward-only files in `server/migrations/`, each in a transaction, recorded in `schema_migrations`. Placeholder `{{schema}}` is replaced at apply time. The server migrates on startup. `npm run db:migrate` is the same runner. |
| Working set | At startup the operational rows are loaded into `db`. Callers mutate `db` and call `persist()`. A short delay later, dirty rows are upserted and removed rows are deleted, in one transaction. |

Configuration operators type (servers, applications, load-balancer mapping, monitors) uses real columns. Several collections are `id` + `jsonb` (`channels`, `runbooks`, `deployments`, `backups`, `go_live_runs`). Live status on servers, applications, and monitors is also kept in a `state jsonb` column.

### Application and server records (schema)

`applications` (`001_init.sql`, later columns for routing): `id` (uuid), `name`, `code_name` (unique, lower-case), `tier` (`TIER_1`–`TIER_3`), `rto_target_min`, `rpo_target_min`, `prd_server_id`, `dr_server_id` (both nullable FKs to `servers`), `prd_url`, `dr_url`, Cloudflare zone and DNS fields, `auto_failover`, `failover_state` (`PRIMARY_ACTIVE`, `DR_ACTIVE`, `FAILING_OVER`), health-check settings, `state jsonb`.

`servers`: `id`, unique `hostname`, unique `ip`, `environment` (`PRD` or `DR`), provider, region, plan CPU/RAM/disk, `agent_token` (never sent to the browser), optional Hostinger VM id, `state jsonb`.

`application_environments` (migration 003): per PRD/DR inventory (port, health path, web server, process manager, database engine and name, replication and backup thresholds). Null means not confirmed.

`application_load_balancers`: one row per application (account, hostname, PRD pool, DR pool).

`application_routing` (migration 012): how public traffic reaches the app. This is separate from service dependencies.

Hosting is the pair `prd_server_id` / `dr_server_id` plus `servers.environment`. It is not a dependency-link type.

### Dependency tables that already exist (migration 007, uniqueness adjusted in 008)

`registry_components`: kind is one of `APPLICATION`, `SERVER`, `DATABASE`, `STORAGE`, `THIRD_PARTY_API`, `PROVIDER`, `BUSINESS_FEATURE`. Optional `application_id` (application or feature), optional `server_id` (server kind only), owner, tier, user count, and served audiences.

`dependency_links`: `from_id` depends on `to_id`. `link_type` is `HARD` or `SOFT`. Optional `feature_id` points at a `BUSINESS_FEATURE` row. A component cannot depend on itself.

These rows are loaded into `db.registry` and `db.dependencyLinks`.

---

## 4. Existing monitoring architecture

### How application health is calculated

`recomputeApplication` in `server/engine.ts` runs on the monitor loop.

1. The active environment is DR only when `failoverState === 'DR_ACTIVE'`. Otherwise it is PRD.
2. Enabled monitors for that application and environment are collected. Statuses of `UNKNOWN` are dropped. The worst remaining status wins. If none remain, the monitor contribution is `UNKNOWN`.
3. Rank, worst last: `HEALTHY` < `MAINTENANCE` < `UNKNOWN` < `STALE` < `WARNING` < `CRITICAL`.
4. Register links can worsen that result. A HARD link to something already `WARNING`, `CRITICAL`, `STALE`, or `MAINTENANCE` can pull the application to that status. A SOFT link can only pull it to `WARNING`. A dependency with no live check is ignored. A healthy dependency never makes an unmonitored application look healthy.
5. `FAILING_OVER` raises the result to at least `WARNING`.

A separate function, `appHealth` in `server/health.ts`, is the URL-only view used by DR readiness. It looks at the managed `app-url` HTTP(S) monitor (or the first HTTP-family monitor): no monitor → `NOT_CONFIGURED`; no check yet → `UNKNOWN`; monitor `HEALTHY` → `HEALTHY`; `CRITICAL` → `DOWN`; `WARNING` → `DEGRADED`.

`Application.dependencies` on the API is a derived list of monitors plus those register signals. It is not the stored dependency graph. The stored graph is `dependency_links`.

### How production server status is calculated

`recomputeServer` sets agent freshness from `lastSeen`, then sets `servers.status` with `vpsOperationalStatus` in `src/lib/trafficHealth.ts`.

- No `lastSeen` → `UNKNOWN`.
- Agent `STALE` or `DISCONNECTED` → `STALE`.
- Connected but CPU, memory, or disk missing → `UNKNOWN`.
- Any of those three at or above 95% → `CRITICAL`.
- Any at or above 85% → `WARNING`.
- Otherwise `HEALTHY`.

HTTP monitors and Cloudflare routing do not change VPS status. The UI explanation in `explainVps` uses a slightly different vocabulary for a disconnected agent (`CRITICAL` on the dimension card, `STALE` on the stored server status). Both come from the same agent timestamps.

### How disaster recovery servers are stored

A DR server is a `servers` row with `environment = 'DR'`. The application points at it with `applications.dr_server_id`. The DR URL is `applications.dr_url`. Per-environment facts are `application_environments` for `DR`. DR is optional: an empty `dr_server_id` is a PRD-only application.

Hostinger registration infers PRD vs DR from the hostname (`environmentFromHostname`: a `.dr`, `-dr`, or `.DR` label means DR; everything else is PRD). That inference runs when a VM is registered. It is not a live inventory of the nine products.

### How HTTPS, HTTP, and SSL monitors work

`syncAppUrlMonitors` (`server/appMonitors.ts`) keeps two managed monitors per environment that has a URL:

- `managedBy = 'app-url'`: type `HTTPS` when the URL is `https:`, otherwise `HTTP`. Target is the URL. Interval, timeout, and expected status come from the application health-check settings (default 30 s / 15 s).
- `managedBy = 'app-ssl'`: type `SSL`, only for `https` URLs when SSL monitoring is on.

Removing a URL removes those managed monitors. Manually created monitors are left alone.

`engine.ts` runs the check. HTTP(S) uses `httpProbe`: status code, optional body match, warning and critical latency. A slow-but-up result is `degraded` and becomes monitor status `WARNING`. SSL uses `sslProbe`: TLS handshake, trust, expiry. Inside `SSL_EXPIRY_WARN_DAYS` the check is degraded (`WARNING`). Expired or untrusted is a failure.

A failure stays `UNKNOWN` or `WARNING` until `failureConfirmationThreshold` consecutive failures (default 3 on managed monitors), then `CRITICAL`. Recovery from `CRITICAL` waits for `recoveryConfirmationThreshold` successes (default 2). Confirmed `CRITICAL` opens one incident per monitor fingerprint. Maintenance windows mark the monitor `MAINTENANCE` and do not count against uptime.

### Where results are stored

| Data | Store |
|---|---|
| Latest monitor status, last probe, latency, certificate days | Monitor row `state` jsonb, in memory and in `monitors` |
| Last 60 samples shown in the UI | Same state (`history`) |
| Every accepted check | `check_results` (batched by `history.ts`), kept for `CHECK_HISTORY_RETENTION_DAYS` |
| Hourly uptime buckets | `monitor_buckets` |
| Agent CPU/RAM/disk rollups | `server_metrics` (plus extra series from migration 004) |
| Incidents | `incidents` |
| Operator actions | `audit_logs` |

### How UNKNOWN, HEALTHY, and CRITICAL are handled

`OperationalStatus` is `HEALTHY`, `WARNING`, `CRITICAL`, `UNKNOWN`, `MAINTENANCE`, `STALE`.

- **UNKNOWN** means no accepted evidence yet, or only unknown inputs. It is excluded when rolling monitors up to an application, so one unchecked monitor does not paint the application unknown if another monitor has a real status. An application with no usable checks stays `UNKNOWN`.
- **HEALTHY** means a confirmed successful check (or, for a VPS, a fresh agent sample under the warning thresholds).
- **CRITICAL** means a confirmed failure (monitors) or a resource at or above 95% (VPS). It is what opens a monitor incident. It is not the same word as incident severity `CRITICAL`, database health `DOWN`, or DR overall `NOT_READY`.

Missing evidence is not stored as healthy. Nullable metrics mean “not reported”.

---

## 5. Existing nine application records

Read on 16 Nov 2026 from `scholario_ops_dev` (localhost, schema `ops`). Names are not hardcoded. Setup creates an application. `scripts/seed-apps-from-servers.ts` can also create one from servers and mints a new UUID each run. These nine rows already exist. Do not insert them again.

Every application has `failover_state` `PRIMARY_ACTIVE` and `auto_failover` false. ICT is `TIER_1` with RTO 30 minutes and RPO 15 minutes. The other eight are `TIER_2` with RTO 60 and RPO 60. Each has a matching `APPLICATION` register component. No server register component exists. No dependency link exists.

| Application | Code | Id | Tier | PRD server | DR server | URLs stored | Monitors | Stored status |
|---|---|---|---|---|---|---|---|---|
| ICT (Cipher LMS) | `ict` | `62489948-c776-4048-8525-50332f0d4892` | TIER_1 | `93.127.167.135` (`3f23afa1-e688-43bf-82a8-d0d6ff689a2b`, PRD) | `187.126.113.32` (`ba2c89b8-3ca1-43c2-ac25-b8aaf16ba9f0`, DR) | PRD and DR | PRD: HTTP HEALTHY (not managed), HTTPS `app-url` HEALTHY, SSL `app-ssl` HEALTHY. DR: HTTP HEALTHY (not managed), HTTPS `app-url` CRITICAL, SSL `app-ssl` HEALTHY | HEALTHY |
| QR Videos | `qr-videos` | `42cb0410-9e07-4955-9394-405dd7293076` | TIER_2 | `qr.videos.prd` (`150458d6-dcd4-40ac-910c-fa63b05705fb`) | `qr.videos.dr` (`ce0397d7-d90d-45e4-8ebe-42e6961f2c50`) | PRD and DR | PRD: HTTPS `app-url` HEALTHY, SSL `app-ssl` HEALTHY. DR: HTTPS `app-url` CRITICAL, SSL `app-ssl` CRITICAL | HEALTHY |
| Scholario Social LMS | `scholario-social-lms` | `650a37ce-39d6-4d68-8d66-98ee4e0e975c` | TIER_2 | `scholario.social.lms.prd` (`efd4e97e-b31f-47f2-bf0f-107dd2c65a8a`) | `scholario.social.lms.dr` (`961db2f8-a9cd-45c8-a94c-460c97003e1c`) | neither | none | UNKNOWN |
| Scholario Ascend | `scholario-ascend` | `36c72a65-ab30-4321-9136-a714e86b2e17` | TIER_2 | `scholario.ascend.prd` (`b5b36bcb-ba1e-40ef-8730-616303cf6df2`) | `scholario.ascend.dr` (`66f5fa63-041a-4bbd-90c6-2912fc8353af`) | neither | none | UNKNOWN |
| Vantage | `vantage` | `711d6c51-e006-480b-a0cf-df041c4a3f4a` | TIER_2 | `vantage.prd` (`ec496615-a0ad-4558-a81a-a53aae192281`) | `vantage.dr` (`2c64891b-5e6d-487a-9746-e561b96aad67`) | neither | none | UNKNOWN |
| LXP Portal | `lxp-portal` | `75108dd3-e9fe-4fbb-9763-6f0e197d1077` | TIER_2 | `lxp.portal.vps` (`1e8a1812-2a4d-4616-8ff9-e6e173a41384`) | none | neither | none | UNKNOWN |
| Scholario Lumo | `scholario-lumo` | `107402a9-5f80-49de-8820-a8a88e2501af` | TIER_2 | `scholario.lumo.prd` (`9e922108-58e6-4bf7-bbef-47b342eb2c1d`) | none | neither | none | UNKNOWN |
| Scholario Websites | `scholario-websites` | `0f6d97d2-7d06-4efe-bb20-f90d269c7c30` | TIER_2 | `scholario.websites` (`b49974ba-6437-4918-9fbf-7b6812d1a547`) | none | neither | none | UNKNOWN |
| Scholario KG LMS | `scholario-kg-lms` | `6347fe16-8a34-4530-b769-415429e08246` | TIER_2 | `scholario.kg.lms.prd` (`5ca0a03a-6e3b-40c7-b974-1dc8cfbd3a81`) | `scholario.kg.lms.dr` (`254daa9e-5565-4587-8ce5-b412d2c649f0`) | neither | none | UNKNOWN |

One extra monitor has no application id: disabled HTTP, environment PRD, stored status `CRITICAL`, `managed_by` empty. It is not one of the managed URL or SSL monitors. This review did not enable, disable, or delete it.

ICT and QR Videos stay `HEALTHY` while DR monitors are `CRITICAL` because `recomputeApplication` uses the active environment, and `PRIMARY_ACTIVE` means PRD. A DR failure does not paint the application down until failover state is `DR_ACTIVE`. UNKNOWN on the other seven means no usable monitor evidence. It is not DOWN and it is not CRITICAL.

All 15 servers are referenced by exactly one application as PRD or DR. None are unattached. Hostinger is the provider on every row. Stored `agentStatus` is `DISCONNECTED` on every row, and `lastSeen` is present, so these are not “never reported”. Stored server `status` is `UNKNOWN`. `vpsOperationalStatus` returns `STALE` when `lastSeen` is set and `agentStatus` is `DISCONNECTED`. The dimension card in `explainVps` uses `CRITICAL` for a disconnected agent. Three different words describe one fact. A disconnected agent does not by itself change application status.

`src/mocks/dependencyDemoData.ts` contains illustrative links between these names. Those rows are not in `dependency_links`. An empty link table means the relationships have not been written down. It does not mean the applications have no dependencies. Later work attaches links to the ids above. It does not create applications or servers, and it does not copy the demo file into the database.

---

## 6. Reusable components and services

**Backend, reuse as-is**

| Piece | Use for the dependency module |
|---|---|
| `server/registry.ts` | Create and validate components and HARD/SOFT links. `registryImpact` is the direct blast-radius walk. |
| `server/incidentImpact.ts` | Snapshots, `registryPaths`, `previewImpact`, live status |
| `src/lib/featureAction.ts` | Wording for a feature that stops (HARD) or degrades (SOFT) |
| `server/routes.ts` registry and impact routes | `GET/POST/PATCH/DELETE /api/v1/registry`, dependency-link writes, `GET /api/v1/registry/:id/impact`, `GET /api/v1/registry/:id/paths`, `GET /api/v1/impact/preview` |
| `requireAuth` / `requireRole` | Register writes are `it_administrator`. Reads are any signed-in user. |
| `persist`, `audit`, `broadcast` | Same save, audit, and SSE path as the rest of Setup |

**Frontend, reuse as-is**

| Piece | Use |
|---|---|
| `setup/DependencyRegister.tsx` | Register editor already on Setup |
| `resilience/DependencyMapView.tsx` | Map at `/dependencies` |
| `impact/ImpactView.tsx` | Impact page |
| `ui/ImpactPreviewCard.tsx`, `ui/FailoverImpactPreview.tsx` | Impact summaries |
| `ui/EmptyState`, `ErrorState`, `Skeleton`, `Pagination`, `InventoryFilters`, `useDialog`, `RbacGuard`, `ViewErrorBoundary` | Forms and lists |
| `OpsContext` `registry` and `dependencyLinks` | Already on the bootstrap payload |
| `ApplicationsView` modal and `SetupView` `AppEditor` | Application identity and hosting fields. Do not duplicate those forms for dependencies. |

Shared types to extend, not replace: `RegistryComponent`, `DependencyLink`, `RegistryImpact`, `RegistryPaths` in `src/types/index.ts`.

Stack conventions to keep: TypeScript ESM, Tailwind utility classes, no new UI kit, no ORM, no second client cache. Server and UI already import the same `src/types` and `src/lib` modules.

---

## 7. Potential implementation risks

1. **A second dependency model.** `Application.dependencies` looks like a dependency list and is rebuilt every recompute from monitors. Writing the MVP into that array would fight the engine and would be wiped. The durable model is `dependency_links`.

2. **Hosting treated as a service dependency.** `prd_server_id` / `dr_server_id` already mean “this app runs on this VPS”. A HARD link from the app to that server would make VPS CPU pressure mark the application down (`registrySignals`). That is a different fact from “the login feature needs this API”.

3. **Feature links are hard even when the parent link is soft.** In `failureEdges`, a `featureId` on a link always produces a hard edge to that feature, including when `link_type` is `SOFT`. A “soft feature dependency” would currently stop the feature. Change that only with an explicit decision and tests.

4. **Impact is graph reachability, not a sum of users.** `largestUserCountStopped` is the max user count on the path, because the same people are counted on the application and its features. Summing them would overstate impact.

5. **In-memory store and the unapplied migration.** `store.ts` already loads and saves `dependency_links.method` and `updated_at`. `server/migrations/017_dependency_mvp.sql` is the matching migration. The configured database has neither column and has not recorded `017`. Do not edit `001`–`016`. Do not remove `017` while `store.ts` still names those columns, and do not restart onto `store.ts` without `017`. The runner migrates before it loads the store, so the next start of this tree applies the two columns and then reads them. That start was not done in this review.

6. **`routes.ts` is one file.** New endpoints belong next to the existing registry routes, or in a small router mounted from `buildRouter`, so the rest of the file is not restructured.

7. **Status vocabulary.** Application `CRITICAL` is not incident severity `CRITICAL` and not `appHealth`’s `DOWN`. Impact UI should keep using `RegistryLiveStatus` and HARD/SOFT, and should not invent a third status scale.

8. **Ids are still not in git.** The nine applications and their server links are stated to exist in PostgreSQL. Seeding new application or server rows, or copying README’s ICT block into new rows, would duplicate them. Dependency links still must not be guessed.

9. **Register name uniqueness.** Names are unique per kind via `name_key` (`server/registryName.ts`), checked at commit. A bulk import that reuses a name will 409.

10. **Production safety.** Register writes already audit and persist. A bad link changes Overview status through `recomputeApplication`. Ship the model and empty UI before any production link is saved.

---

## 8. Recommended dependency module architecture

Extend the register. Do not add `application_dependencies` as a parallel table.

| MVP term | Use what already exists |
|---|---|
| Dependency Register | `registry_components` and `DependencyRegister` |
| Dependency resource | A component whose kind is `DATABASE`, `STORAGE`, `THIRD_PARTY_API`, or `PROVIDER`. Add a kind only if none of these fit, in a new migration. |
| Consumer | `dependency_links.from_id` (the thing that depends) |
| Provider | `dependency_links.to_id` (the thing depended on). An application that provides a feature is the `APPLICATION` component with the same `application_id` as the `BUSINESS_FEATURE`. |
| Hard / soft | `link_type` `HARD` or `SOFT` |
| Feature mapping | `BUSINESS_FEATURE` plus optional `feature_id` on the link |
| Direct impact | `registryImpact` and `GET /api/v1/registry/:id/impact` (one hop is already available by reading `affected`; multi-hop is what the function does today) |
| Hosting | Leave on `applications.prd_server_id`, `dr_server_id`, and `servers`. A `SERVER` register row may point at `server_id` for display. Do not create a HARD “runs on” link as part of hosting. |

Direction stays: “from depends on to”. Failure walks from the provider toward consumers (`failureEdges`).

Direct impact for the MVP should stay the existing walk: when a component fails, list consumers reached by HARD edges as stopped and consumers reached only through a SOFT edge as degraded. Do not fold VPS telemetry into that list.

UI: keep editing on Setup → Dependency Register and reading on `/dependencies` and `/impact`. Application detail may show the links for that application’s register row. It should not grow a second editor for servers and URLs.

The register is empty on purpose. An empty link list is not a finding that these applications have no dependencies. Do not add links until an operator confirms each one. Do not add links between the nine applications to fill the register. Hosting stays on the server ids that are already stored.

Impact calculation to reuse, and not reimplement:

- `registryImpact` in `server/registry.ts` walks HARD and SOFT failure edges.
- `previewImpact` and `registryPaths` in `server/incidentImpact.ts` serve maintenance, failover, and the impact page.
- `featureAction` in `src/lib/featureAction.ts` is the sentence for a stopped or degraded feature.
- `recomputeApplication` already folds a checked HARD or SOFT link into application status. A new calculator must not run beside it.

---

## 9. Files likely to require changes

Only after approval. None of these were changed in this task.

| Likely file | Why |
|---|---|
| `src/types/index.ts` | Only if a new kind or field is approved |
| `server/migrations/017_*.sql` | Only for a new column or kind. Do not edit earlier files. |
| `server/store.ts` | Load and save any new column |
| `server/registry.ts` | Validation and, if approved, the soft-feature edge rule |
| `server/incidentImpact.ts` | If impact wording or direct-only scope changes |
| `server/routes.ts` | Thin additions beside the current registry routes |
| `src/services/api.ts` | Client methods for any new field |
| `src/components/setup/DependencyRegister.tsx` | Resource and feature editing |
| `src/components/resilience/DependencyMapView.tsx` | Consumer / provider labels |
| `src/components/impact/ImpactView.tsx` | Direct impact presentation |
| `src/components/applications/ApplicationsView.tsx` | Read-only links on the detail modal |
| `src/context/OpsContext.tsx` | Only if bootstrap shape changes |
| `tests/` | Register and impact tests next to `tests/incident-impact.test.ts` |

Unlikely to need edits for this module: `engine.ts` probe path, `probes.ts`, `appMonitors.ts`, `auth.ts`, Cloudflare and Hostinger sync. `recomputeApplication` already consumes HARD/SOFT signals. Touch it only if that rule itself must change.

---

## 10. Where Tasks 02 and 03 stand

The model assessment is `docs/TASK-02-DEPENDENCY-MODEL-ASSESSMENT.md`. The module design is `docs/TASK-03-DEPENDENCY-MODULE-PLAN.md`. Both are ready for approval. This file does not authorise a restart, a link insert, or a second table.

What those two documents now hold, and what they still refuse to do:

1. Application ids, server ids, tiers, and monitor statuses are recorded from `scholario_ops_dev`. They were not inferred.
2. Consumer, provider, Hard, and Soft already fit `dependency_links`. The only proposed columns are `method` and `updated_at`.
3. `017` and the `store.ts` mapping are already in the tree. They have not been applied to this database. No link is backfilled.
4. `tests/dependency-link-method.test.ts` covers the column pair on a throw-away schema and refuses `scholario_ops_dev`. It was not run as part of this review.
5. A SOFT link that names a feature still stops that feature. Task 03 leaves that rule in place.
6. The register screen, the map, the impact page, and the application detail tab already show consumer, provider, Hard, and Soft. They read the live register. Demo mode is labelled illustrative and does not save.

---

## 11. Documentation compared with the source

Compared on 16 Nov 2026: `docs/Scholario-Ops-Project-Document.docx` (6 Oct 2026), `PROJECT_OVERVIEW.md`, `README.md`, `docs/CODEBASE_AUDIT_AND_FUTURE_SCOPE.md`, and the code those files describe. The PDF in `docs/` is the same project document. The operator notes in this task are included where they meet the code.

| Document | What it says | What the code does |
|---|---|---|
| Project document, stack | React Router 6, and Motion for animation | `react-router-dom` 7.18. No `motion` or `framer-motion` import under `src/` |
| Project document, data model | 18 tables, all created by `001_init.sql` | `001` creates the original set. Migrations `002`–`016` add environment inventory, notification deliveries and reads, `registry_components`, `dependency_links`, provider connections and instances, resource limits and measurements, routing and worker events, tracked credentials, and go-live runs |
| Project document, modules | Ten modules. The dependency map sits under DR | Current navigation also has Credentials, Capacity, Impact, Dependencies, Reliability, and a Dependency Register inside Setup. Impact and the register are implemented, not only a map |
| Project document, shape of an app | Every application has its own PRD and DR servers, and is either a Cloudflare load balancer or a DNS failover record | `dr_server_id` may be empty. `trafficRouting` also allows a Worker or custom routing (`server/migrations/012_traffic_routing.sql`) |
| Project document, probes | Result classes end at `CONNECTION_ERROR` | `ProbeStatus` also includes `AUTH_ERROR` and `UNKNOWN` |
| Project document, incidents | Opens on confirmed DOWN | The monitor status that opens an incident is `CRITICAL`. `appHealth` is the function that maps that to `DOWN` for the URL dimension. `UNKNOWN` is not mapped to `DOWN` |
| Project document, DR score | Any FAIL makes the application NOT READY | `readiness.ts` does that for an applicable FAIL. If the essential checks are not PASS and nothing has failed, the overall is `UNKNOWN`, not `NOT_READY`. An application with no DR server is not failed for lacking one |
| Project document, dead-man | Only an external ping every 60 seconds | `DEADMAN_HEARTBEAT_URL` is still read in `server/config.ts` and documented in `README.md`. `PROJECT_OVERVIEW.md` says those variables are deprecated and ignored. That overview sentence does not match `config.ts`. A second heartbeat is built from agent reports in `server/deadman.ts` |
| `PROJECT_OVERVIEW.md`, layout | Migrations listed as `001`–`003` in the folder table | The folder contains `001` through `017`. The configured database has applied `001` through `016` only |
| `CODEBASE_AUDIT_AND_FUTURE_SCOPE.md` | A SOFT dependency is shown and does not paint the application red | A SOFT link whose target is `CRITICAL`, `WARNING`, or `STALE` sets the application to `WARNING`. It does not set `CRITICAL` |
| Same audit | A register row with no check stays UNKNOWN and does not page | `registrySignals` drops a link that has no live check. It does not add an UNKNOWN dependency, and it does not change application status |
| `README.md`, ICT | Printed hosts, URLs, and pool ids are the stored ICT configuration | The stored hostnames are `93.127.167.135` (PRD) and `187.126.113.32` (DR). URL text and pool ids were not selected in this read |
| Operator note, monitors | QR Videos and ICT have HTTP, HTTPS, and SSL monitors | Confirmed, with a split the note did not state. ICT has unmanaged HTTP plus managed HTTPS and SSL on both environments. QR Videos has managed HTTPS and SSL only. Application status is HEALTHY because the active environment is PRD. DR monitors on both applications include CRITICAL |
| Operator note, seven applications | UNKNOWN because no monitors are configured | Confirmed for all seven. Three of them, LXP Portal, Scholario Lumo, and Scholario Websites, also have no DR server |
| Operator note, agents | All agents show DISCONNECTED | Confirmed as stored `agentStatus`. `lastSeen` is present on every server, and stored server `status` is UNKNOWN. The status function would call that STALE. It is not application CRITICAL and not DOWN |
| Operator note, register | Zero relationships | Confirmed for links. Nine APPLICATION components already point at the nine applications. Empty links are not the same as no dependencies |

No difference was found on these points: PostgreSQL with no ORM, one Node process, four roles, missing evidence is not stored as healthy, and HARD/SOFT impact already lives in `server/registry.ts`.

## Inspection log

**Inspected**

- `package.json`, `README.md`, `PROJECT_OVERVIEW.md`, `docs/CODEBASE_AUDIT_AND_FUTURE_SCOPE.md`, and `docs/Scholario-Ops-Project-Document.docx` (6 Oct 2026; the PDF beside it is the same document). Section 11 is the comparison.
- `server/server.ts`, `server/db.ts`, `server/store.ts` (application, server, monitor, and dependency-link maps), `server/routes.ts` (route table, auth gate, registry routes), `server/auth.ts`, `server/health.ts`, `server/engine.ts` (probe outcomes and recompute), `server/probes.ts` (SSL probe), `server/appMonitors.ts`, `server/registry.ts`, `server/incidentImpact.ts` (exports), `server/providers/register.ts`.
- Migrations `001` through `017`, and `schema_migrations` in the configured database (applied through `016`).
- `src/App.tsx`, `src/main.tsx`, `src/components/layout/Shell.tsx`, `src/context/OpsContext.tsx` (state shape), `src/types/index.ts` (status, application, register), `src/lib/trafficHealth.ts`, `src/lib/roles.ts`, `src/lib/featureAction.ts`, `src/services/api.ts`, `ApplicationsView.tsx` (list, modal, dependency tab), `DependencyRegister.tsx`, `DependencyMapView.tsx`.
- Read-only SQL against `scholario_ops_dev`: applications, servers, monitors, registry components, dependency links, incident status counts, migration history, and `dependency_links` columns. No URL, IP column, token, or password was selected. ICT hostnames are IP-shaped because that is what the hostname column stores.

**Could not inspect**

- A remote production database. `.env` points at localhost `scholario_ops_dev`. If a separate production database exists, these rows were not read from it.
- Cloudflare and Hostinger APIs. The running process is already logging token failures for both. This review did not call them.
- The in-memory store of the process that is already running. Database values can differ from that process until it restarts and migrates.
- Browser behaviour. This task is analysis only.

**Blockers**

- No dependency between the nine applications is stored, and none should be invented. The demo file is not evidence.
- Approving Task 02 is what allows the next process start to apply `017`. Until that approval, do not restart this tree.

**Approval asked for**

1. Extend the existing register, as in section 8. Reuse `registryImpact`.
2. Accept the ids in section 5 as the rows future links must point at.
3. Approve Task 02 and Task 03. Do not insert links as part of that approval.
