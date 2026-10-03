# Scholario Ops — Project Overview

> A full-featured, single-page **IT Operations Control Center** built with React + TypeScript + Tailwind CSS v4. Designed to monitor, manage, and respond to operational events across the Scholario educational platform's cloud infrastructure.

---

## Table of Contents

1. [What Is This Project?](#1-what-is-this-project)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Applications Managed](#4-applications-managed)
5. [Infrastructure Overview](#5-infrastructure-overview)
6. [Core Data Model (Types)](#6-core-data-model-types)
7. [State Management — OpsContext](#7-state-management--opscontext)
8. [Navigation & Routing](#8-navigation--routing)
9. [Feature Modules — What's Built](#9-feature-modules--whats-built)
10. [Visual Components](#10-visual-components)
11. [Command Palette](#11-command-palette)
12. [Simulator Engine](#12-simulator-engine)
13. [Dark / Light Theme](#13-dark--light-theme)
14. [Persistence](#14-persistence)
15. [Completion Status — Feature-by-Feature](#15-completion-status--feature-by-feature)
16. [What's Missing / Not Yet Done](#16-whats-missing--not-yet-done)
17. [Running the Project](#17-running-the-project)

---

## 1. What Is This Project?

**Scholario Ops** is an internal operations dashboard for a fictional (but realistically modeled) EdTech company called **Scholario**. It simulates a real SRE/IT Operations control center, covering:

- Live system health monitoring across 8 applications and 16 VPS servers
- Incident management with timelines, notes, severity, and blast radius
- Disaster Recovery (DR) readiness and live failover controls
- Cloudflare Anycast edge, DNS records, and WAF visibility
- Backup integrity verification with SHA-256 checksums
- Deployment pipeline tracking with rollback support
- Runbooks (SOPs) with interactive step execution
- Escalation policies and notification channel testing
- Audit logs for all privileged operator actions
- External Dead-Man watchdog monitoring
- A comprehensive Ctrl+K Command Palette for instant access to everything

The app runs entirely client-side with mock data seeded in `initialData.ts`. There is no real backend API — it's a demo/prototype dashboard.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| UI Framework | React 19 |
| Language | TypeScript 7 (strict) |
| Build Tool | Vite 8 |
| CSS | Tailwind CSS v4 (via `@tailwindcss/vite`) |
| Icons | `lucide-react` v0.546 |
| Animations | `motion` v12 (Framer Motion successor) |
| AI Integration | `@google/genai` v2.4 (dependency present, not yet wired) |
| State | React Context API (`OpsContext`) |
| Persistence | `localStorage` (per-key JSON snapshots) |
| Server (optional) | Express + dotenv (for potential API proxy) |

---

## 3. Project Structure

```
src/
├── App.tsx                          # Root: OpsProvider + Shell + tab-based router
├── main.tsx                         # React DOM entry
├── index.css                        # Tailwind base styles
│
├── types/index.ts                   # All TypeScript interfaces (30+ types)
├── data/initialData.ts              # Seed data for all entities
├── context/OpsContext.tsx           # Global state, actions, computed summaries
│
├── components/
│   ├── layout/
│   │   ├── Shell.tsx                # Sidebar nav + top bar + critical incident banner
│   │   └── CommandPalette.tsx       # Ctrl+K global search + action launcher
│   │
│   ├── overview/
│   │   └── OverviewView.tsx         # Main command center dashboard
│   │
│   ├── applications/
│   │   └── ApplicationsView.tsx     # App catalog + 10-tab detail modal
│   │
│   ├── infrastructure/
│   │   └── InfrastructureView.tsx   # VPS fleet grid + detail modal (system/processes/services/logs)
│   │
│   ├── monitors/
│   │   └── MonitorsView.tsx         # Continuous monitor probes, history, run checks
│   │
│   ├── incidents/
│   │   └── IncidentsView.tsx        # Incident list + 7-tab detail modal
│   │
│   ├── resilience/
│   │   ├── DrDashboardView.tsx      # PRD/DR readiness + failover console
│   │   ├── BackupsView.tsx          # Backup records + integrity status
│   │   └── DependencyMapView.tsx    # Dependency graph visualization
│   │
│   ├── providers/
│   │   ├── CloudflareView.tsx       # Cloudflare zones, DNS, WAF, SSL
│   │   └── HostingerView.tsx        # Hostinger VPS provider overview
│   │
│   ├── operations/
│   │   ├── DeploymentsView.tsx      # Build pipeline + rollback
│   │   ├── RunbooksView.tsx         # Interactive SOPs
│   │   └── MaintenanceView.tsx      # Maintenance windows + suppression
│   │
│   ├── communications/
│   │   └── CommunicationsView.tsx   # Channels + escalation policies
│   │
│   ├── analytics/
│   │   └── ReportsView.tsx          # Daily ops briefing + export
│   │
│   ├── admin/
│   │   └── AuditLogsView.tsx        # Immutable operator audit trail
│   │
│   └── visuals/
│       ├── HeartbeatPulseChart.tsx  # ECG-style pulse waveform
│       ├── TrafficFlowChart.tsx     # Anycast traffic routing architecture diagram
│       ├── IncidentFlowChart.tsx    # Incident state machine flow
│       └── TelemetryAreaGraph.tsx   # Time-series area graph (CPU/RAM/Network/Latency)
```

---

## 4. Applications Managed

Eight Scholario platform applications are modeled with full metadata:

| App | Code Name | Tier | Description | Status (Default) |
|---|---|---|---|---|
| Cipher | `cipher` | TIER 1 | ICT LMS & Online Examination Core Platform | HEALTHY |
| Apex | `apex` | TIER 1 | Student Information System & Admissions Engine | HEALTHY |
| Nimbus | `nimbus` | TIER 2 | Curriculum & Digital Content Delivery Engine | HEALTHY |
| Mosaic | `mosaic` | TIER 1 | Analytics, Reporting & Examination Portal | **CRITICAL** (Active Incident) |
| Ascend | `ascend` | TIER 2 | Faculty, Staff Operations & Resource Scheduling | HEALTHY |
| Vantage | `vantage` | TIER 1 | Finance, Tuition Billing & Payroll Engine | HEALTHY |
| Lumo | `lumo` | TIER 1 | Central Identity, SAML/OAuth2 SSO Gateway | HEALTHY |
| Client Platform | `client-platform` | TIER 2 | Multi-Tenant District Admin & Guardian API | HEALTHY |

Each application has:
- Uptime (24h / 7d / 30d), RTO/RPO targets, replication lag
- PRD and DR server assignments
- P50 / P95 / P99 latency, error rate
- Cloudflare zone, deployment version
- Full dependency tree (DB, Redis, Storage, Workers, External APIs)
- Last tested recovery date & duration

---

## 5. Infrastructure Overview

**16 Hostinger KVM VPS nodes** across 4 regions:

| Region | Nodes |
|---|---|
| Singapore | Cipher PRD/DR, Mosaic PRD/DR, Vantage PRD/DR, Lumo DR, Nimbus DR |
| Frankfurt | Apex PRD, Ascend PRD/DR, Lumo PRD, Client Platform DR |
| Mumbai | Nimbus PRD |
| London | Apex DR, Client Platform PRD |

Each server has live (simulated) telemetry: CPU%, RAM%, Disk%, Load Average (1m/5m/15m), Network In/Out. The Mosaic PRD node (`vps-sg-mosa-prd-01`) starts in a CRITICAL state with CPU at ~97%, RAM at ~95% and a failed `mosaic-engine` service — the active incident scenario.

---

## 6. Core Data Model (Types)

Defined in `src/types/index.ts` — 30+ TypeScript interfaces covering every entity:

| Type | Purpose |
|---|---|
| `Application` | Full app record with infra, DR, latency, dependencies |
| `VpsServer` | Server node with telemetry, processes, services, logs |
| `Monitor` | Continuous probe with history, thresholds, consecutive checks |
| `Incident` | Ticket with timeline, notes, blast radius, runbook link |
| `CloudflareZone` | DNS records, load balancer, WAF, SSL, drift detection |
| `BackupRecord` | Backup with integrity hash, restore status, encryption |
| `Runbook` | SOP with interactive steps, completion tracking |
| `Deployment` | Pipeline stage record with rollback flag |
| `MaintenanceWindow` | Scheduled downtime with monitor suppression |
| `CommunicationChannel` | Webhook/email/Teams/PagerDuty channel |
| `EscalationPolicy` | Severity-based escalation ladder |
| `AuditLog` | Operator action record |
| `DeadManControlPlane` | External independent watchdog state |

Key enums: `OperationalStatus`, `IncidentSeverity`, `IncidentStatus`, `MonitorType`, `Environment`

---

## 7. State Management — OpsContext

`src/context/OpsContext.tsx` is the single source of truth. It exposes:

**State slices:**
- `applications`, `servers`, `monitors`, `incidents`, `cloudflareZones`
- `backups`, `runbooks`, `deployments`, `maintenanceWindows`
- `communicationChannels`, `escalationPolicies`, `auditLogs`, `deadMan`

**Navigation state:**
- `activeTab`, `selectedAppId`, `selectedServerId`, `selectedIncidentId`, `selectedRunbookId`
- `isCommandPaletteOpen`, `lastUpdatedSecondsAgo`

**Actions (all memoized with `useCallback`):**

| Action | What it does |
|---|---|
| `triggerFailover(appId, 'DR'/'PRIMARY')` | Flips Cloudflare LB origin, updates app failover state, logs audit entry |
| `acknowledgeIncident(id, operator)` | Sets acknowledged + timeline event |
| `changeIncidentStatus(id, status)` | Updates status + timeline |
| `changeIncidentSeverity(id, severity)` | Updates severity + timeline |
| `assignIncidentOwner(id, owner)` | Reassigns ownership + timeline |
| `addIncidentNote(id, text)` | Appends note + timeline entry |
| `resolveIncident(id, summary)` | Marks resolved, sets recovery status |
| `toggleRunbookStep(runbookId, stepId)` | Toggles step completion + audit |
| `runProbeCheck(monitorId)` | Simulates a single monitor probe check |
| `runAllProbes()` | Runs all monitor probes at once |
| `sendTestNotification(channelId)` | Simulates dispatch + updates channel status |
| `triggerSimulatedScenario(...)` | See Simulator section below |
| `addAuditEntry(...)` | Appends to immutable audit log |

**Computed `systemSummary`:**
- `totalApps`, `healthyApps`, `totalServers`, `healthyServers`
- `totalMonitors`, `healthyMonitors`, `openIncidents`, `criticalIncidents`
- `drReadinessCount`, `backupsCurrentCount`, `cloudflareStatus`, `overallHealth`

**Background timers:**
- Every 5 seconds: jitters server telemetry (CPU/RAM) for realism, updates Dead-Man heartbeat
- Every 1 second: increments `lastUpdatedSecondsAgo` counter

---

## 8. Navigation & Routing

There is no React Router. Navigation is tab-based via `activeTab` string in context. `App.tsx` renders the correct view component via a `switch` statement on `activeTab`.

**Tab → View mapping:**

| Tab ID | Component |
|---|---|
| `overview` | `OverviewView` |
| `applications` | `ApplicationsView` |
| `infrastructure` | `InfrastructureView` |
| `monitors` | `MonitorsView` |
| `incidents` / `alerts` | `IncidentsView` |
| `resilience` / `failover` | `DrDashboardView` |
| `backups` | `BackupsView` |
| `dependencies` | `DependencyMapView` |
| `hostinger` | `HostingerView` |
| `cloudflare` | `CloudflareView` |
| `deployments` / `changes` | `DeploymentsView` |
| `runbooks` | `RunbooksView` |
| `maintenance` | `MaintenanceView` |
| `communications` / `escalation` / `integrations` / `settings` | `CommunicationsView` |
| `reports` / `uptime` | `ReportsView` |
| `audit` / `users` | `AuditLogsView` |

---

## 9. Feature Modules — What's Built

### 9.1 Shell Layout (`Shell.tsx`)
- Collapsible sidebar (icon-only mode)
- 7 navigation sections with live badges/counts
- Top bar with search button (opens Command Palette), health status badge, simulator dropdown, manual refresh, theme toggle, and operator avatar
- **Active Critical Incident Banner** — red strip below the top bar with incident ID, description, duration, and "INVESTIGATE" CTA
- Independent Watchdog status dot in sidebar footer

### 9.2 Overview Dashboard (`OverviewView.tsx`)
- 8-column metrics bar (Apps, VPS Fleet, Monitors, Incidents, DR Ready, Backups, Cloudflare, Dead-Man)
- **The 5 Operational Answers** panel — auto-correlated answers to: What's healthy? What's failing? What's affected? What should IT do? Has it recovered?
- 4 visual charts (Heartbeat, Traffic Flow, Incident Flow, Telemetry area graphs)
- Application Systems Table — all 8 apps with PRD/DR servers, replication lag, RTO/RPO, uptime, latency
- Hostinger VPS Fleet preview (first 6 nodes)

### 9.3 Applications View (`ApplicationsView.tsx`)
- Card grid of all 8 applications with status, tier, uptime, error rate
- **10-tab Application Detail Modal**: Overview, Health, Monitors, Infrastructure, Dependencies, DR, Backups, Incidents, Deployments, History
- Per-app failover button (with confirmation step)
- All linked entities loaded per app (monitors, incidents, backups, deployments, audit logs)

### 9.4 Infrastructure View (`InfrastructureView.tsx`)
- Searchable VPS fleet grid (filter by region / environment / status)
- Live CPU/RAM/Disk bars with color thresholds
- **4-tab VPS Detail Modal**: System (telemetry + area graph), Processes (PID list), Services (status + version), Logs (recent entries)

### 9.5 Monitors View (`MonitorsView.tsx`)
- Full table of all continuous monitors with type, target, interval, status, response time, uptime%
- Consecutive failure / recovery counters visible
- "Run Probe" button per monitor
- Check history (last 20 results) per monitor

### 9.6 Incidents View (`IncidentsView.tsx`)
- Incident list with severity color coding, status badges
- **7-tab Incident Detail Modal**: Summary, Timeline, Signals, Blast Radius, Communications, Runbook, Notes
- Actions: Acknowledge, Change Status, Change Severity, Assign Owner, Add Note, Resolve
- Embedded `IncidentFlowChart` (state machine visualization)

### 9.7 DR Dashboard (`DrDashboardView.tsx`)
- App selector with per-app DR readiness checklist (6 items: replication, snapshot, restore drill, compute, drift, Cloudflare LB)
- Live failover state indicator (PRIMARY / DR ACTIVE)
- One-click failover / failback toggle (with confirmation)
- Embedded `TrafficFlowChart`

### 9.8 Backups View (`BackupsView.tsx`)
- Table of all backup records with type, size, destination, retention, encryption, integrity, restore test status
- Color-coded status (SUCCESS / FAILED / STALE)

### 9.9 Dependency Map (`DependencyMapView.tsx`)
- Visual dependency topology showing the path: Users → Cloudflare → VPS → Application → Dependencies (DB, Redis, Storage, Workers, External APIs)
- Per-app dependency health table with latency

### 9.10 Cloudflare View (`CloudflareView.tsx`)
- Zone selector for all Cloudflare zones
- Configuration drift detection warning banner
- DNS records table (A, CNAME, TXT, MX)
- Load balancer status (active origin, failover policy, health check)
- WAF event count, SSL expiry, TLS version
- Embedded `TrafficFlowChart`

### 9.11 Hostinger View (`HostingerView.tsx`)
- Provider-level overview of all VPS nodes
- Hardware specs, region grouping, agent version, uptime days

### 9.12 Deployments View (`DeploymentsView.tsx`)
- Deployment history per application
- Stage tracking: BUILDING → DEPLOYING → HEALTH_CHECK → SMOKE_TEST → SUCCESS / FAILED / ROLLED_BACK
- Rollback availability flag

### 9.13 Runbooks View (`RunbooksView.tsx`)
- List of operational runbooks by category (DATABASE, FAILOVER, WEB_SERVER, PERFORMANCE, DEAD_MAN)
- Interactive step-by-step execution (click to mark step complete / incomplete)
- Estimated duration, completion tracking, completedBy + completedAt recorded

### 9.14 Maintenance View (`MaintenanceView.tsx`)
- Scheduled maintenance windows with impact description and monitor suppression list
- Status badges: SCHEDULED / IN_PROGRESS / COMPLETED / EXPIRED
- Approved-by and reason fields

### 9.15 Communications View (`CommunicationsView.tsx`)
- Notification channels: Microsoft Teams webhook, On-Call Email, Generic Webhook, PagerDuty
- Enabled/disabled toggle, last delivery status, failure count
- "Send Test Notification" button (simulated dispatch)
- Escalation policies with severity → channel → delay → auto-escalate ladder

### 9.16 Reports View (`ReportsView.tsx`)
- Pre-generated Daily Operations Briefing in a monospace terminal-style display
- Covers: core health, resilience targets, MTTD, MTTR, compliance & governance
- Copy to clipboard button
- Download as `.txt` file button

### 9.17 Audit Logs View (`AuditLogsView.tsx`)
- Immutable chronological table of all operator actions
- Columns: Timestamp, Operator, Category, Action, Target Resource, Details
- Categories: INCIDENT, FAILOVER, MAINTENANCE, MONITOR, CLOUDFLARE, INFRASTRUCTURE, RUNBOOK
- Auto-populated by all context actions; persisted to `localStorage`

---

## 10. Visual Components

All in `src/components/visuals/`:

| Component | What it renders |
|---|---|
| `HeartbeatPulseChart` | Animated ECG-style waveform showing live monitor pulse |
| `TrafficFlowChart` | Anycast architecture diagram: Users → Cloudflare Edge → LB Pool → PRD/DR Origins |
| `IncidentFlowChart` | Incident lifecycle state machine: OPEN → ACK → INVESTIGATING → MITIGATING → 3-check recovery → RESOLVED |
| `TelemetryAreaGraph` | SVG-based area chart with threshold line, used for CPU / RAM / Network / Latency |

---

## 11. Command Palette

Triggered by `Ctrl+K` (or `Cmd+K` on Mac). Built in `CommandPalette.tsx`.

**Search categories:** ALL · ROUTES · APPS · SERVERS · INCIDENTS · ACTIONS · MONITORS · RUNBOOKS

**What's searchable / actionable:**
- All 20+ navigation routes with descriptions and live badges
- All 8 applications (navigate + inspect)
- All 16 VPS server nodes (navigate + inspect)
- All incident tickets (navigate + inspect)
- All continuous monitor probes (run probe + navigate)
- All runbooks (open + navigate)
- Management Actions: Run all probes, Acknowledge incident, Resolve incident
- Failover / Failback per application
- Send test notifications (Teams, email)
- Download daily ops report
- All 4 simulator scenarios
- Keyboard navigation (↑↓ arrows + Enter), action feedback toast

---

## 12. Simulator Engine

The **SIMULATOR** dropdown in the top bar (and accessible via Command Palette) enables 4 interactive scenarios:

| Scenario | What happens |
|---|---|
| **Verify Recovery & Failback** | Mosaic PRD server returns to HEALTHY, monitors pass 3 consecutive checks, app failover reverts to PRIMARY, INC-1042 resolves, Cloudflare LB restores to PRD origin |
| **Inject MySQL Pool Exhaustion** | Mosaic PRD CPU spikes to ~98%, mosaic-engine service fails, monitors go CRITICAL (3 failures), app goes CRITICAL with DR_ACTIVE, INC-1042 re-opens |
| **Toggle Watchdog Silence** | External Dead-Man flips between HEALTHY ↔ CRITICAL_SILENCE (4 consecutive misses) |
| **Reset State to Baseline** | Clears `localStorage`, restores all initial data |

---

## 13. Dark / Light Theme

- Toggled via the Sun/Moon button in the top bar
- Persisted to `localStorage` as `scholario_theme`
- Applied via `document.documentElement.classList` (`dark` / `light`)
- Every component reads `theme` from context and applies conditional Tailwind classes using `isDark` boolean
- Default theme: **Dark**

---

## 14. Persistence

State is synced to `localStorage` on every change via `useEffect`:

| Key | Data |
|---|---|
| `scholario_apps` | Applications array |
| `scholario_servers` | Servers array |
| `scholario_monitors` | Monitors array |
| `scholario_incidents` | Incidents array |
| `scholario_cf` | Cloudflare zones array |
| `scholario_audit` | Audit logs (last 100 entries) |
| `scholario_theme` | `'dark'` or `'light'` |

Backups, deployments, maintenance windows, and escalation policies are **not** persisted (initialized fresh from `initialData.ts` every session).

---

## 15. Completion Status — Feature-by-Feature

| Feature | Status | Notes |
|---|---|---|
| Shell Layout (sidebar, topbar) | ✅ Complete | Collapsible, dark/light, badges |
| Command Palette (Ctrl+K) | ✅ Complete | Full search, 7 categories, keyboard nav |
| Overview Dashboard | ✅ Complete | All 7 sections built |
| Applications View + Modal | ✅ Complete | 10 tabs in modal |
| Infrastructure View + Modal | ✅ Complete | 4 tabs (system, processes, services, logs) |
| Monitors View | ✅ Complete | Probe run, history table |
| Incidents View + Modal | ✅ Complete | 7 tabs, full action set |
| DR Dashboard + Failover | ✅ Complete | Readiness checklist, live toggle |
| Backups View | ✅ Complete | Integrity, restore status |
| Dependency Map | ✅ Complete | Visual topology + table |
| Cloudflare View | ✅ Complete | DNS, WAF, LB, drift detection |
| Hostinger View | ✅ Complete | Provider-level fleet overview |
| Deployments View | ✅ Complete | Pipeline stages, rollback |
| Runbooks View | ✅ Complete | Interactive step execution |
| Maintenance View | ✅ Complete | Windows, suppression |
| Communications View | ✅ Complete | Channels, escalation policies |
| Reports View | ✅ Complete | Generated text report, download/copy |
| Audit Logs View | ✅ Complete | Immutable table |
| Visual Charts (4 components) | ✅ Complete | ECG, Traffic Flow, Incident Flow, Area Graph |
| Dark / Light Theme | ✅ Complete | All components themed |
| Simulator Engine | ✅ Complete | 4 scenarios |
| localStorage Persistence | ✅ Complete | 6 keys persisted |
| Telemetry Live Simulation | ✅ Complete | 5s jitter loop |
| Dead-Man Watchdog | ✅ Complete | State + sidebar indicator |
| Keyboard Shortcut (Ctrl+K) | ✅ Complete | Global capture listener |
| Critical Incident Banner | ✅ Complete | Auto-shown when critical incident open |
| `@google/genai` AI Feature | ⚠️ Wired but unused | Package installed, no AI calls made yet |
| Real backend / live API | ❌ Not built | All data is static seed from `initialData.ts` |
| Unit / Integration Tests | ❌ Not built | No test framework configured |
| Mobile Responsive Layout | ⚠️ Partial | Grid breakpoints used but sidebar/modals not fully mobile optimized |
| User Authentication | ❌ Not built | Operator name is hardcoded as "Arjun Mehta" |
| URL-based deep linking | ❌ Not built | No React Router; tab state is in-memory |

---

## 16. What's Missing / Not Yet Done

1. **AI / Gemini Integration** — `@google/genai` is installed but completely unused. The intended use case is likely AI-assisted incident root cause analysis or natural language querying of the ops data.
2. **Real API Backend** — The Express server stub in `package.json` (`server.js`) exists but there is no server file. No real API calls are made anywhere.
3. **Authentication / RBAC** — No login screen, no session, no role-based access. The operator identity is a hardcoded string.
4. **URL Deep Linking** — Navigating directly to a specific incident or app via URL is not possible. All state lives in React context.
5. **Tests** — No test runner configured (no Vitest, Jest, or Testing Library setup).
6. **Full Mobile Optimization** — Modals and tables may overflow on small screens. The sidebar has a collapsed icon-only mode but no drawer/overlay pattern.
7. **Real Telemetry** — The Scholario Agent (`scholario-agent`) is referenced in the data but there is no real agent or WebSocket connection. Telemetry is randomly jittered every 5 seconds.
8. **Notifications Delivery** — `sendTestNotification` is a 600ms fake delay. No actual webhook calls are made.
9. **Pagination / Virtualization** — Audit logs and monitor history are rendered as full tables; large datasets would cause performance issues.
10. **WCAG / Accessibility** — No ARIA roles or keyboard trap management in modals. Focus management is basic.

---

## 17. Running the Project

```bash
# Install dependencies
npm install

# Start dev server (port 3000)
npm run dev

# Build for production
npm run build

# Type-check only
npm run lint
```

The app will open at `http://localhost:3000`. No environment variables are required to run the UI — the `.env.example` file exists for the future Express server (likely for a Gemini API key proxy).

---

*Generated: October 2026 · Scholario IT Operations Control Center*
