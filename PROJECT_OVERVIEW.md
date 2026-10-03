# Scholario Ops — Project Overview

> A full-featured, single-page **IT Operations Control Center** built with React 19 + TypeScript + Tailwind CSS v4. Designed to monitor, manage, and respond to operational events across the Scholario educational platform's cloud infrastructure.

---

## Table of Contents

1. [What Is This Project?](#1-what-is-this-project)
2. [Tech Stack & Typography](#2-tech-stack--typography)
3. [Project Structure](#3-project-structure)
4. [Applications Managed](#4-applications-managed)
5. [Infrastructure Overview](#5-infrastructure-overview)
6. [Core Data Model (Types)](#6-core-data-model-types)
7. [State Management — OpsContext](#7-state-management--opscontext)
8. [Navigation & Routing](#8-navigation--routing)
9. [Feature Modules — What's Built](#9-feature-modules--whats-built)
10. [Visual Flow Charts, Heartbeat Monitors & Graphs](#10-visual-flow-charts-heartbeat-monitors--graphs)
11. [Command Palette (Ctrl+K)](#11-command-palette-ctrlk)
12. [Simulator Engine](#12-simulator-engine)
13. [Dual Light & Dark Enterprise Themes](#13-dual-light--dark-enterprise-themes)
14. [Persistence](#14-persistence)
15. [Completion Status — Feature-by-Feature](#15-completion-status--feature-by-feature)
16. [Running the Project](#16-running-the-project)

---

## 1. What Is This Project?

**Scholario Ops** is an internal operations control center for a fictional (but realistically modeled) EdTech company called **Scholario**. It simulates a real SRE/IT Operations command center, covering:

- Live system health monitoring across 8 applications and 16 VPS servers
- Incident management with timelines, notes, severity, and blast radius containment
- Disaster Recovery (DR) readiness and live Anycast failover controls
- Cloudflare Anycast edge, DNS records, and WAF bot defense visibility
- Backup integrity verification with SHA-256 checksums
- Deployment pipeline tracking with rollback support
- Runbooks (SOPs) with interactive step execution
- Escalation policies and notification channel testing
- Immutable audit logs for all privileged operator actions
- External Dead-Man watchdog monitoring (Zurich out-of-band node)
- A comprehensive Ctrl+K Command Palette for instant keyboard access
- Interactive operations simulator with 4 live scenarios

The app runs client-side with full interactive state seeded in `initialData.ts` and managed via `OpsContext`, with `localStorage` persistence and simulated real-time telemetry jitter.

---

## 2. Tech Stack & Typography

| Layer | Technology | Purpose |
|---|---|---|
| UI Framework | React 19 | Component hierarchy, hooks, state management |
| Language | TypeScript (strict) | Strong typing, zero implicit any, full type safety |
| Build Tool | Vite 8 | Development server (port 3000) & static build |
| CSS & Styling | Tailwind CSS v4 | `@theme` CSS configuration, zero-runtime overhead |
| Primary Typography | **Inter** | Complete weight spectrum (300–900) via Google Fonts, OpenType features (`cv02`, `cv03`, `cv04`, `cv11`) for the entire UI, headers, body, descriptions |
| Tabular Typography | **JetBrains Mono** | Tabular numbers (`tabular-nums`) for hostnames, IPv4 addresses, commit hashes, latency readouts, and status tags |
| Icons | `lucide-react` v0.546 | Crisp SVG vector glyphs across all 14 views |
| Animations | CSS Keyframes & `motion` v12 | ECG waveforms, packet pulses, scanner needles |
| State Management | React Context API (`OpsContext`) | Global operational state, actions, computed summaries |
| Persistence | `localStorage` | Instant persistence for state, audit logs, and theme preferences |

---

## 3. Project Structure

```
src/
├── App.tsx                          # Root: OpsProvider + Shell + activeTab router
├── main.tsx                         # React DOM 19 entry point
├── index.css                        # Tailwind v4 theme, Inter font system, animations
│
├── types/index.ts                   # 30+ TypeScript operational interfaces & enums
├── data/initialData.ts              # Seed data for 8 apps, 16 VPS, 55+ probes, incidents
├── context/OpsContext.tsx           # Global state, actions, computed summaries, persistence
│
├── components/
│   ├── layout/
│   │   ├── Shell.tsx                # Sidebar nav + top bar + critical banner + theme switcher
│   │   └── CommandPalette.tsx       # Ctrl+K global search + action execution launcher
│   │
│   ├── overview/
│   │   └── OverviewView.tsx         # Main Command Center dashboard + The 5 Answers panel
│   │
│   ├── applications/
│   │   └── ApplicationsView.tsx     # App catalog + 10-tab detail modal + failover
│   │
│   ├── infrastructure/
│   │   └── InfrastructureView.tsx   # VPS fleet grid + 4-tab server detail modal + area graphs
│   │
│   ├── monitors/
│   │   └── MonitorsView.tsx         # Continuous probes, probe triggers, check history
│   │
│   ├── incidents/
│   │   └── IncidentsView.tsx        # Incident command workspace + 7-tab modal + state machine
│   │
│   ├── resilience/
│   │   ├── DrDashboardView.tsx      # PRD/DR readiness checklist + live failover console
│   │   ├── BackupsView.tsx          # Backup records + SHA-256 integrity verification
│   │   └── DependencyMapView.tsx    # Topology dependency graph visualization
│   │
│   ├── providers/
│   │   ├── CloudflareView.tsx       # Cloudflare Anycast CDN, DNS, WAF, SSL, LB origin pool
│   │   └── HostingerView.tsx        # Hostinger KVM VPS provider fleet overview
│   │
│   ├── operations/
│   │   ├── DeploymentsView.tsx      # Build pipeline stages + rollback triggers
│   │   ├── RunbooksView.tsx         # Interactive standard operating procedures (SOPs)
│   │   └── MaintenanceView.tsx      # Maintenance windows + monitor probe suppression
│   │
│   ├── communications/
│   │   └── CommunicationsView.tsx   # Teams / SMS / email channels + escalation ladders
│   │
│   ├── analytics/
│   │   └── ReportsView.tsx          # Daily operations briefing + text export
│   │
│   ├── admin/
│   │   └── AuditLogsView.tsx        # Immutable operator audit trail
│   │
│   └── visuals/
│       ├── HeartbeatPulseChart.tsx  # Zurich Watchdog ECG rhythm, jitter, signal, countdown
│       ├── TrafficFlowChart.tsx     # 5-stage Anycast CDN & failover topology flow
│       ├── IncidentFlowChart.tsx    # 7-step incident recovery state machine
│       └── TelemetryAreaGraph.tsx   # Smooth cubic Bézier sparklines with threshold lines
```

---

## 4. Applications Managed

Eight Scholario platform applications are modeled with comprehensive operational metadata:

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

Each application tracks uptime SLA (24h / 7d / 30d), RTO/RPO targets, replication lag, assigned PRD and DR server nodes, P50 / P95 / P99 latency percentiles, error rate, Cloudflare zone configuration, and full dependency trees.

---

## 5. Infrastructure Overview

**16 Hostinger KVM VPS nodes** across 4 global regions:

- **Singapore**: Cipher PRD/DR, Mosaic PRD/DR, Vantage PRD/DR, Lumo DR, Nimbus DR
- **Frankfurt**: Apex PRD, Ascend PRD/DR, Lumo PRD, Client Platform DR
- **Mumbai**: Nimbus PRD
- **London**: Apex DR, Client Platform PRD

Every server has live telemetry: CPU%, RAM%, Disk%, Load Average (1m/5m/15m), and Network In/Out. The Mosaic PRD node (`vps-sg-mosa-prd-01`) starts in a CRITICAL state with CPU at ~98%, RAM at ~96%, and a failed `mosaic-engine` service, demonstrating the active incident scenario.

---

## 6. Core Data Model (Types)

Defined in `src/types/index.ts` — 30+ strict TypeScript interfaces:

- `Application`: Full app record with infra, DR, latency percentiles, dependencies
- `VpsServer`: Server node with live telemetry, processes, services, logs
- `Monitor`: Continuous probe with check history, consecutive failure/recovery thresholds
- `Incident`: Ticket with timeline, investigation notes, blast radius, linked runbook
- `CloudflareZone`: DNS records, load balancer origin pool, WAF status, SSL, drift detection
- `BackupRecord`: Backup archive with SHA-256 integrity hash, restore drill status, encryption
- `Runbook`: SOP with interactive step execution and operator audit tracking
- `Deployment`: Pipeline stage tracking with instant rollback capability
- `MaintenanceWindow`: Scheduled downtime with automatic monitor probe suppression
- `CommunicationChannel`: Webhook/email/Teams/PagerDuty dispatch channels
- `EscalationPolicy`: Severity-based notification ladder
- `AuditLog`: Immutable operator action record
- `DeadManControlPlane`: External independent watchdog state

---

## 7. State Management — OpsContext

`src/context/OpsContext.tsx` is the single source of truth, exposing:

- **State slices**: `applications`, `servers`, `monitors`, `incidents`, `cloudflareZones`, `backups`, `runbooks`, `deployments`, `maintenanceWindows`, `communicationChannels`, `escalationPolicies`, `auditLogs`, `deadMan`.
- **Navigation state**: `activeTab`, `selectedAppId`, `selectedServerId`, `selectedIncidentId`, `selectedRunbookId`, `isCommandPaletteOpen`, `lastUpdatedSecondsAgo`.
- **Actions**: `triggerFailover`, `acknowledgeIncident`, `changeIncidentStatus`, `changeIncidentSeverity`, `assignIncidentOwner`, `addIncidentNote`, `resolveIncident`, `toggleRunbookStep`, `runProbeCheck`, `runAllProbes`, `sendTestNotification`, `triggerSimulatedScenario`, `addAuditEntry`, `toggleTheme`.
- **System summaries**: Auto-computed `systemSummary` for healthy apps, servers, monitors, open incidents, DR readiness, and overall cluster health.
- **Background loops**: 5-second telemetry jitter cycle, 1-second elapsed counter ticker.

---

## 8. Navigation & Routing

Tab-based routing via `activeTab` string in `OpsContext`, rendered by `App.tsx`:

| Tab ID | View Component | Description |
|---|---|---|
| `overview` | `OverviewView` | Operations Command Center, 5 Core Answers, All Charts |
| `applications` | `ApplicationsView` | Catalog grid + 10-tab application detail modal |
| `infrastructure` | `InfrastructureView` | VPS fleet grid + 4-tab server detail modal + area graphs |
| `monitors` | `MonitorsView` | 55+ probes, continuous heartbeat stream, manual probe triggers |
| `incidents` / `alerts` | `IncidentsView` | Incident command workspace + 7-tab incident modal |
| `resilience` / `failover` | `DrDashboardView` | PRD/DR readiness checklist + Anycast failover console |
| `backups` | `BackupsView` | Backup archive table with SHA-256 integrity status |
| `dependencies` | `DependencyMapView` | End-to-end topology visual dependency flow |
| `hostinger` | `HostingerView` | Provider-level VPS fleet specifications and regions |
| `cloudflare` | `CloudflareView` | Anycast CDN, DNS records, WAF defense, LB origin pool |
| `deployments` / `changes` | `DeploymentsView` | Build pipeline tracking and rollback execution |
| `runbooks` | `RunbooksView` | Standard operating procedures with interactive step tracking |
| `maintenance` | `MaintenanceView` | Scheduled windows with automated alert suppression |
| `communications` / `escalation` | `CommunicationsView` | Notification dispatch channels & escalation ladders |
| `reports` / `uptime` | `ReportsView` | Monospace daily operations briefing with export |
| `audit` / `users` | `AuditLogsView` | Immutable audit trail of all privileged operator actions |

---

## 9. Feature Modules — What's Built

### 9.1 Shell Layout (`Shell.tsx`)
- Collapsible sidebar with navigation sections and live badges/counts
- Top bar with global search button (Ctrl+K), cluster environment status, simulator dropdown, manual probe refresh, one-click Light/Dark theme toggle, and operator avatar
- **Active Critical Incident Banner**: Red alert banner with incident details and one-click "INVESTIGATE" CTA
- Independent Watchdog status dot in the sidebar footer

### 9.2 Overview Dashboard (`OverviewView.tsx`)
- 8-column high-density global metrics bar
- **The 5 Operational Answers** auto-correlation panel:
  1. What is healthy right now?
  2. What is failing right now?
  3. What is affected?
  4. What should IT do?
  5. Has it recovered?
- 4 embedded visual charts (ECG Waveform, Anycast Traffic Flow, Incident State Machine, Telemetry Area Graphs)
- Application Systems Table and Hostinger VPS Fleet preview

### 9.3 Applications View (`ApplicationsView.tsx`)
- Card grid of all 8 applications with status, tier, uptime, and latency
- **10-tab Application Detail Modal**: Overview, Health, Monitors, Infrastructure, Dependencies, DR, Backups, Incidents, Deployments, History
- Live failover trigger button with confirmation safety step
- Embedded `TrafficFlowChart`

### 9.4 Infrastructure View (`InfrastructureView.tsx`)
- Searchable, filterable VPS fleet grid
- Live CPU, RAM, Disk, and Network telemetry bars
- **4-tab Server Detail Modal**: System (telemetry + area graph), Processes (PID list), Services (systemd status), Operational Logs
- 4 Telemetry Area Graphs (Cluster CPU Load, ECC Memory RAM Mesh, Anycast Outbound Throughput, P95 Probe Latency)

### 9.5 Monitors View (`MonitorsView.tsx`)
- Comprehensive table of all 55+ probes with type, target, interval, latency, and consecutive check counters
- Per-probe manual "Run Probe" trigger
- Check history (last 20 probe results)
- Embedded `HeartbeatPulseChart`

### 9.6 Incidents View (`IncidentsView.tsx`)
- Incident ticket list with severity badges, status, duration, and blast radius
- **7-tab Incident Detail Modal**: Summary, Timeline, Signals, Correlation & Blast Radius, Communications, Runbook, Investigation Notes
- Operator actions: Acknowledge, Change Status, Change Severity, Assign Owner, Add Note, Sign Off & Resolve
- Embedded `IncidentFlowChart`

---

## 10. Visual Flow Charts, Heartbeat Monitors & Graphs

### 10.1 Real-Time ECG Heartbeat Chart (`HeartbeatPulseChart`)
- **Watchdog Stream**: Continuous cardiac rhythm waveform for the independent Zurich Dead-Man Watchdog (`ch-zh-monitor-01`).
- **Telemetry Readouts**:
  - Pulse interval (1.0s / 1.0 Hz) with live sequence counter
  - Millisecond roundtrip jitter (`14.2 ms ±0.8ms`) with live variance
  - Signal strength readout (`99.8% · -42 dBm`) with a visual 5-bar RSSI signal meter
  - Live silence detection countdown timer (`4.8s / 5.0s`, resetting on each pulse, animated progress bar, and timeout alarm when silenced)
- **Controls**: One-click toggle for watchdog silence simulation and instant probe trigger.
- **Embedded in**: Command Center Overview and Monitors View.

### 10.2 Traffic & Failover Architecture Flow Chart (`TrafficFlowChart`)
- **5-Stage Topology Architecture**:
  1. **End Users** (Worldwide Clients, 14,200 req/min, Global PoPs)
  2. **Cloudflare Anycast CDN** (Edge PoPs in 330+ cities, TLS 1.3, SSL Full Strict)
  3. **WAF Bot Defense** (Managed Rules, Rate Limiting, ML Threat Intelligence)
  4. **Origin Pool Load Balancer** (Traffic Director, 5s health probe interval)
  5. **Primary (PRD) vs Standby (DR) Origins** (Hostinger Singapore KVM VPS nodes)
- **Dynamic Packet Pulses**:
  - Green healthy flow lines for legitimate traffic
  - Amber quarantined bypasses showing blocked/challenged malicious bots
  - Real-time latency readouts (`TLS 1.3 · 14ms`, `Filter · 1.2ms`, `Probe · 5s`)
- **Controls**: Target application selector and interactive **Reroute Origin Traffic** toggle.
- **Embedded in**: Command Center Overview, Applications View, Disaster Recovery Console, and Cloudflare View.

### 10.3 Incident Recovery Lifecycle Flowchart (`IncidentFlowChart`)
- **7-Step State Machine**:
  1. `Telemetry Anomaly` (MySQL max pool 500/500 saturated)
  2. `3 Consecutive Probe Failures` (Confirmed 3/3 failure sequence)
  3. `Blast Radius Isolation` (Incident fingerprinted & quarantined)
  4. `Automated Traffic Reroute` (Anycast shifted to DR Standby origin)
  5. `Root Cause Mitigation` (Pool recycled via Runbook RB-01)
  6. `3 Consecutive Recovery Checks` (Monitor confirms 3 back-to-back passes)
  7. `Verified Resolved` (SLA restored & immutable postmortem created)
- **Controls**: Interactive failure injection and verification resolution trigger.
- **Embedded in**: Command Center Overview and Incidents View.

### 10.4 Fleet Telemetry Area Graphs (`TelemetryAreaGraph`)
- Smooth cubic Bézier-curve area sparkline charts with gradient fills, hover point markers, Min / Avg / Peak / Current stat readouts, and warning threshold lines.
- **Standardized Metrics**:
  - `Cluster CPU Load` (Singapore Origin / VPS Fleet, warning threshold 80%)
  - `ECC Memory RAM Mesh` (16 Nodes Aggregated, warning threshold 85%)
  - `Anycast Outbound Throughput` (Global Edge Outbound, Mbps)
  - `P95 Probe Latency` (Global Probes Mesh, warning threshold 150ms)
- **Embedded in**: Command Center Overview and Hostinger Infrastructure fleet view.

---

## 11. Command Palette (Ctrl+K)

Triggered globally via `Ctrl+K` (or `Cmd+K` on Mac):

- **8 Filter Categories**: ALL · ROUTES · APPS · SERVERS · INCIDENTS · ACTIONS · MONITORS · RUNBOOKS
- **Instant Search**: Search through all 20+ routes, 8 apps, 16 VPS servers, incidents, monitors, runbooks, and operator actions with keyboard navigation (↑/↓ arrows + Enter).
- **Execution**: Run probes, acknowledge/resolve incidents, divert traffic, dispatch notifications, trigger simulator scenarios, and download daily reports directly from the palette.

---

## 12. Simulator Engine

Accessible via the top-bar **SIMULATOR** menu or Command Palette:

1. **Verify Recovery & Failback**: Restores Mosaic PRD server to HEALTHY, confirms 3 consecutive monitor passes, reverts Anycast failover to PRIMARY, and resolves INC-1042.
2. **Inject MySQL Pool Exhaustion**: Spikes Mosaic PRD CPU to ~98%, fails the engine service, fails 3 consecutive probes, triggers INC-1042, and diverts traffic to DR.
3. **Toggle Watchdog Silence**: Flips Zurich Dead-Man watchdog between HEALTHY and CRITICAL_SILENCE (4 consecutive misses, escalation dispatched).
4. **Reset State to Baseline**: Clears `localStorage` and restores nominal baseline state.

---

## 13. Dual Light & Dark Enterprise Themes

- **Dark Mode (Default)**: Deep carbon canvas (`#0B0F17`), SOC deep navy containers (`#111726`), dark border lines (`#1E293B`), and high-contrast operational indicators (Emerald, Amber, Rose, Blue).
- **Light Mode**: Crisp corporate enterprise appearance (`#F6F8FC` canvas, deep navy `#17233C` navigation bar, `#FFFFFF` cards, `#E2E8F0` borders).
- **One-Click Switcher**: Top-bar **LIGHT / DARK** button with instant persistence in `localStorage`.
- **Universal Coverage**: All 14 views, navigation shells, command palette, charts, tables, and modal dialogs dynamically adapt their styling based on the active theme.

---

## 14. Persistence

Synchronized to `localStorage` on state transitions:

| Key | Contents |
|---|---|
| `scholario_apps` | Application records and failover states |
| `scholario_servers` | VPS server inventory and telemetry |
| `scholario_monitors` | Monitor probe configurations and history |
| `scholario_incidents` | Incident tickets, notes, and timelines |
| `scholario_cf` | Cloudflare zone configurations and DNS records |
| `scholario_audit` | Immutable audit log trail (last 100 entries) |
| `scholario_theme` | Active theme (`'dark'` or `'light'`) |

---

## 15. Completion Status — Feature-by-Feature

| Feature | Status | Notes |
|---|---|---|
| Typography System (Inter + JetBrains Mono) | ✅ Complete | Inter across whole app; JetBrains Mono for metrics |
| Dual Enterprise Theme (Dark / Light) | ✅ Complete | Universal coverage across all 14 views + modals |
| Shell Layout & Sidebar | ✅ Complete | Collapsible, live badges, watchdog indicator |
| Command Palette (Ctrl+K) | ✅ Complete | Full search across 8 categories with keyboard nav |
| Command Center Overview | ✅ Complete | Metrics bar, The 5 Answers panel, all charts |
| Applications View + Modal | ✅ Complete | 10-tab modal, live failover controls |
| Infrastructure View + Modal | ✅ Complete | 4-tab modal, live telemetry, area graphs |
| Monitors View | ✅ Complete | 55+ probes, ECG waveform, manual triggers |
| Incidents View + Modal | ✅ Complete | 7-tab modal, state machine, action buttons |
| Disaster Recovery Console | ✅ Complete | Readiness checklist, live failover toggle |
| Backups View | ✅ Complete | SHA-256 integrity, restore verification |
| Dependency Map | ✅ Complete | Visual topology dependency graph |
| Cloudflare View | ✅ Complete | Anycast, DNS, WAF, LB pool status |
| Hostinger View | ✅ Complete | Provider fleet specs and region breakdown |
| Deployments View | ✅ Complete | Pipeline stage tracking, rollback support |
| Runbooks View | ✅ Complete | Interactive standard operating procedures |
| Maintenance View | ✅ Complete | Scheduled windows, alert suppression |
| Communications View | ✅ Complete | Dispatch channels, escalation ladders |
| Daily Operations Report | ✅ Complete | Text briefing display, copy & download |
| Audit Logs View | ✅ Complete | Immutable operator action trail |
| ECG Heartbeat Waveform Chart | ✅ Complete | 1.0s interval, jitter, signal meter, countdown |
| Traffic Flow Architecture Chart | ✅ Complete | 5-stage topology, packet pulses, reroute toggle |
| Incident Recovery State Machine | ✅ Complete | 7-step sequence with consecutive check rules |
| Fleet Telemetry Area Graphs | ✅ Complete | Cubic Bézier curves, threshold lines, 4 metrics |
| Operations Simulator | ✅ Complete | 4 interactive scenarios |

---

## 16. Running the Project

```bash
# Install dependencies
npm install

# Start development server on port 3000 (0.0.0.0)
npm run dev

# Build for production
npm run build

# Type-check codebase
npm run lint
```

The application runs at `http://localhost:3000`.

---

*Updated: October 2026 · Scholario IT Operations Control Center*
