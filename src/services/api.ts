import {
  Application, VpsServer, Monitor, Incident, CloudflareZone, AuditLog, DeadManControlPlane,
  CommunicationChannel, EscalationPolicy, MaintenanceWindow, Runbook, Deployment, BackupRecord,
  IntegrationStatus, HttpProbeResult, TcpProbeResult, ServerMetricPoint, DrReadinessItem, OpsUser,
  LoadBalancerState, FailoverPreflight, DrOverall, CheckRecord, BackupStatus, DatabaseHealth, DatabaseReport, HostingerInfo,
} from '../types';

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'critical';
  service: string;
  version: string;
  timestamp: string;
  uptimeSeconds: number;
  environment: string;
  cluster: string;
  healthCheckEndpoint: string;
  reachable: boolean;
  checks: {
    api_gateway: string;
    edge_ingress: string;
    deadman_watchdog: string;
    cloudflare_sync: string;
    cloudflare_load_balancing?: string;
    vps_telemetry_stream: string;
    continuous_probes: string;
  };
  counts: {
    applications: number;
    servers: number;
    monitors: number;
    openIncidents: number;
    criticalIncidents: number;
  };
}

export type SafeUser = OpsUser;

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface SystemSummary {
  totalApps: number; healthyApps: number;
  totalServers: number; healthyServers: number;
  totalMonitors: number; healthyMonitors: number;
  openIncidents: number; criticalIncidents: number;
  drReadinessCount: number; backupsCurrentCount: number;
  cloudflareStatus: 'HEALTHY' | 'DEGRADED' | 'NOT_CONFIGURED' | 'UNKNOWN';
  deadManStatus: string; deadManLastHeartbeat: string | null;
  overallHealth: 'OPERATIONAL' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';
  /** Data sources not reporting — overall health is based on partial data when non-empty */
  visibilityGaps?: string[];
  generatedAt: string;
}

export interface BootstrapData {
  applications: Application[];
  servers: VpsServer[];
  monitors: Monitor[];
  incidents: Incident[];
  channels: CommunicationChannel[];
  escalationPolicies: EscalationPolicy[];
  maintenanceWindows: MaintenanceWindow[];
  runbooks: Runbook[];
  deployments: Deployment[];
  backups: BackupRecord[];
  auditLogs: AuditLog[];
  cloudflareZones: CloudflareZone[];
  loadBalancer: LoadBalancerState;
  deadMan: DeadManControlPlane;
  integrations: IntegrationStatus;
  summary: SystemSummary;
}

export interface DrReadiness {
  appId: string;
  appName: string;
  failoverState: string;
  checks: DrReadinessItem[];
  overall: DrOverall;
  overallReady: boolean;
  /** PASS count of the 13 core checks */
  passed: number;
  total: number;
  evaluatedAt: string;
}

export interface DatabaseHealthRow {
  applicationId: string; applicationName: string; environment: 'PRD' | 'DR';
  status: DatabaseHealth; detail: string; report: DatabaseReport | null; observedAt: string | null;
}

export interface AgentHealthRow {
  serverId: string; hostname: string; ip: string; environment: 'PRD' | 'DR';
  state: 'ONLINE' | 'STALE' | 'OFFLINE' | 'NOT_CONNECTED'; version: string | null; lastSeen: string | null;
  startedAt: string | null; restartCount: number; errors: string[];
  /** Added with agent 3.3 telemetry */
  expectedVersion?: string; outdated?: boolean | null; clockSkewMs?: number | null; transportDelayMs?: number | null;
  ntpSynchronized?: boolean | null; clockIssue?: boolean; failedServices?: number; pm2Issues?: number; dbIssues?: number;
  warnings?: number; critical?: number;
}

/** Fleet-wide agent / server health (GET /api/v1/health/agents → summary) */
export interface AgentFleetSummary {
  expectedVersion: string;
  total: number; connected: number; stale: number; disconnected: number; neverConnected: number;
  outdated: number; clockIssues: number; withErrors: number;
  failedServices: number; pm2Issues: number; dbIssues: number;
}

/** GET /api/v1/health/databases → summary */
export interface DatabaseHealthSummary { total: number; healthy: number; warning: number; critical: number; unavailable: number; notConfigured: number }

export interface AvailabilityStats {
  total: number; ok: number; availabilityPercent: number | null;
  avgLatencyMs: number | null; p95LatencyMs: number | null;
  firstCheckAt: string | null; lastCheckAt: string | null; lastSuccessAt: string | null; lastFailureAt: string | null;
  byStatus: Record<string, number>;
}

export interface ApplicationAvailability {
  range: string;
  since: string;
  environments: Array<{
    environment: 'PRD' | 'DR';
    application: AvailabilityStats & { monitors: string[] };
    monitoring: AvailabilityStats;
    cloudflareOrigin: AvailabilityStats | null;
  }>;
}

export interface CloudflarePoolOption {
  id: string; name: string; description: string; enabled: boolean | null; healthy: boolean | null;
  origins: Array<{ name: string; address: string; enabled: boolean | null; weight: number | null }>;
}

export type HistoryPoint = CheckRecord & { samples?: number; okSamples?: number };

export interface AgentInstallInfo {
  installCommand: string;
  uninstallCommand: string;
  ingestUrl: string;
  agentVersion: string;
  publicUrlConfigured: boolean;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let logoutHandler: (() => void) | null = null;
export function setLogoutHandler(handler: () => void) {
  logoutHandler = handler;
}

export const tokenStore = {
  getAccess(): string | null {
    try { return localStorage.getItem('scholario_access_token'); } catch { return null; }
  },
  getRefresh(): string | null {
    try { return localStorage.getItem('scholario_refresh_token'); } catch { return null; }
  },
  getUser(): SafeUser | null {
    try {
      const raw = localStorage.getItem('scholario_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  setTokens(access: string, refresh: string, user: SafeUser) {
    try {
      localStorage.setItem('scholario_access_token', access);
      localStorage.setItem('scholario_refresh_token', refresh);
      localStorage.setItem('scholario_user', JSON.stringify(user));
    } catch { /* storage unavailable */ }
  },
  clear() {
    try {
      localStorage.removeItem('scholario_access_token');
      localStorage.removeItem('scholario_refresh_token');
      localStorage.removeItem('scholario_user');
    } catch { /* storage unavailable */ }
  },
};

// Single in-flight refresh shared by all requests that hit 401 at the same time
let refreshing: Promise<boolean> | null = null;
async function refreshSession(): Promise<boolean> {
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const body = await res.json() as ApiResponse<{ user: SafeUser; tokens: { accessToken: string; refreshToken: string } }>;
      tokenStore.setTokens(body.data.tokens.accessToken, body.data.tokens.refreshToken, body.data.user);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

async function request<T>(path: string, options: RequestInit = {}, retried = false): Promise<T> {
  const headers = new Headers(options.headers || {});
  const token = tokenStore.getAccess();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(path, { ...options, headers });
  } catch {
    throw new ApiError('Cannot reach the Scholario Ops server. Check your connection.', 0, 'NETWORK');
  }

  if (res.status === 401 && !retried && !path.startsWith('/api/auth/login')) {
    if (await refreshSession()) return request<T>(path, options, true);
    tokenStore.clear();
    logoutHandler?.();
  }

  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }

  if (!res.ok) {
    const b = parsed as { message?: string; error?: string; code?: string } | null;
    throw new ApiError(b?.message || b?.error || text.slice(0, 200) || `HTTP ${res.status}`, res.status, b?.code);
  }
  return parsed as T;
}

const json = (body: unknown) => (body === undefined ? undefined : JSON.stringify(body));
const unwrap = <T>(p: Promise<ApiResponse<T>>) => p.then(r => r.data);

export const api = {
  get<T>(path: string): Promise<T> { return request<T>(path); },
  post<T>(path: string, body?: unknown): Promise<T> { return request<T>(path, { method: 'POST', body: json(body ?? {}) }); },
  patch<T>(path: string, body?: unknown): Promise<T> { return request<T>(path, { method: 'PATCH', body: json(body ?? {}) }); },
  put<T>(path: string, body?: unknown): Promise<T> { return request<T>(path, { method: 'PUT', body: json(body ?? {}) }); },
  delete<T>(path: string): Promise<T> { return request<T>(path, { method: 'DELETE' }); },

  // ── Health (public) ─────────────────────────────────────────────────────────
  async checkHealth(): Promise<HealthCheckResponse> {
    const res = await fetch('/api/health', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) throw new ApiError(`Health check failed: HTTP ${res.status}`, res.status);
    return res.json() as Promise<HealthCheckResponse>;
  },

  bootstrap: () => unwrap(api.get<ApiResponse<BootstrapData>>('/api/v1/bootstrap')),
  integrations: () => unwrap(api.get<ApiResponse<IntegrationStatus>>('/api/v1/integrations')),

  // ── Servers ─────────────────────────────────────────────────────────────────
  getServers: () => unwrap(api.get<ApiResponse<VpsServer[]>>('/api/v1/servers')),
  createServer: (data: Partial<VpsServer>) => unwrap(api.post<ApiResponse<VpsServer>>('/api/v1/servers', data)),
  updateServer: (id: string, data: Partial<VpsServer>) => unwrap(api.patch<ApiResponse<VpsServer>>(`/api/v1/servers/${encodeURIComponent(id)}`, data)),
  deleteServer: (id: string) => unwrap(api.delete<ApiResponse<{ deleted: boolean; removedMonitors: number }>>(`/api/v1/servers/${encodeURIComponent(id)}`)),
  getAgentInstall: (id: string) => unwrap(api.get<ApiResponse<AgentInstallInfo>>(`/api/v1/servers/${encodeURIComponent(id)}/agent`)),
  rotateAgentToken: (id: string) => unwrap(api.post<ApiResponse<{ rotated: boolean }>>(`/api/v1/servers/${encodeURIComponent(id)}/rotate-token`)),
  getServerMetrics: (id: string, range: '1h' | '6h' | '24h' | '48h' = '1h') =>
    unwrap(api.get<ApiResponse<ServerMetricPoint[]>>(`/api/v1/servers/${encodeURIComponent(id)}/metrics?range=${range}`)),

  // ── Applications ────────────────────────────────────────────────────────────
  getApplications: () => unwrap(api.get<ApiResponse<Application[]>>('/api/v1/applications')),
  createApplication: (data: Partial<Application>) => unwrap(api.post<ApiResponse<Application>>('/api/v1/applications', data)),
  updateApplication: (id: string, data: Partial<Application>) => unwrap(api.patch<ApiResponse<Application>>(`/api/v1/applications/${encodeURIComponent(id)}`, data)),
  deleteApplication: (id: string) => unwrap(api.delete<ApiResponse<{ deleted: boolean; removedMonitors: number }>>(`/api/v1/applications/${encodeURIComponent(id)}`)),
  triggerFailover: (id: string, target: 'DR' | 'PRIMARY', reason?: string) =>
    unwrap(api.post<ApiResponse<{ app: Application; changed: Array<{ from: string; to: string }> }>>(`/api/v1/applications/${encodeURIComponent(id)}/failover`, { target, reason })),
  getDrReadiness: (id: string) => unwrap(api.get<ApiResponse<DrReadiness>>(`/api/v1/applications/${encodeURIComponent(id)}/dr-readiness`)),
  getAvailability: (id: string, range: '24h' | '7d' | '30d' | '90d' = '24h') =>
    unwrap(api.get<ApiResponse<ApplicationAvailability>>(`/api/v1/applications/${encodeURIComponent(id)}/availability?range=${range}`)),
  getFailoverPreflight: (id: string, target: 'DR' | 'PRIMARY') =>
    unwrap(api.get<ApiResponse<FailoverPreflight>>(`/api/v1/applications/${encodeURIComponent(id)}/failover/preflight?target=${target}`)),
  recordFailoverDecision: (id: string, target: 'DR' | 'PRIMARY', decision: 'APPROVED' | 'REJECTED', reason: string) =>
    unwrap(api.post<ApiResponse<{ recorded: boolean }>>(`/api/v1/applications/${encodeURIComponent(id)}/failover/decision`, { target, decision, reason })),

  // ── Monitors ────────────────────────────────────────────────────────────────
  getMonitors: () => unwrap(api.get<ApiResponse<Monitor[]>>('/api/v1/monitors')),
  createMonitor: (data: Partial<Monitor>) => unwrap(api.post<ApiResponse<Monitor>>('/api/v1/monitors', data)),
  updateMonitor: (id: string, data: Partial<Monitor>) => unwrap(api.patch<ApiResponse<Monitor>>(`/api/v1/monitors/${encodeURIComponent(id)}`, data)),
  deleteMonitor: (id: string) => unwrap(api.delete<ApiResponse<{ deleted: boolean }>>(`/api/v1/monitors/${encodeURIComponent(id)}`)),
  toggleMonitor: (id: string) => unwrap(api.post<ApiResponse<Monitor>>(`/api/v1/monitors/${encodeURIComponent(id)}/toggle`)),
  probeMonitor: (id: string) => unwrap(api.post<ApiResponse<Monitor>>(`/api/v1/monitors/${encodeURIComponent(id)}/probe`)),
  probeAllMonitors: () => unwrap(api.post<ApiResponse<Monitor[]>>('/api/v1/monitors/probe-all')),
  getMonitorHistory: (id: string, range: '1h' | '6h' | '24h' | '7d' | '30d' = '24h') =>
    unwrap(api.get<ApiResponse<{ range: string; bucketSec: number; points: HistoryPoint[] }>>(`/api/v1/monitors/${encodeURIComponent(id)}/history?range=${range}`)),

  // ── Live diagnostic tools ───────────────────────────────────────────────────
  httpTest: (payload: { url: string; method?: string; body?: string; expectedStatus?: number; matchText?: string; timeoutSec?: number }) =>
    unwrap(api.post<ApiResponse<HttpProbeResult & { expectedMatch: boolean }>>('/api/v1/tools/http', payload)),
  tcpTest: (host: string, port: number) => unwrap(api.post<ApiResponse<TcpProbeResult>>('/api/v1/tools/tcp', { host, port })),
  dnsTest: (host: string) => unwrap(api.post<ApiResponse<{ ok: boolean; latencyMs: number; detail: string }>>('/api/v1/tools/dns', { host })),
  sslTest: (host: string) => unwrap(api.post<ApiResponse<{ ok: boolean; latencyMs: number; daysLeft: number | null; validTo: string | null; issuer: string | null; protocol: string | null; detail: string }>>('/api/v1/tools/ssl', { host })),

  // ── Incidents ───────────────────────────────────────────────────────────────
  getIncidents: () => api.get<PaginatedApiResponse<Incident>>('/api/v1/incidents?pageSize=500').then(r => r.data),
  createIncident: (data: { title: string; severity: string; applicationId?: string; environment?: string; description?: string }) =>
    unwrap(api.post<ApiResponse<Incident>>('/api/v1/incidents', data)),
  acknowledgeIncident: (id: string) => unwrap(api.post<ApiResponse<Incident>>(`/api/v1/incidents/${encodeURIComponent(id)}/acknowledge`)),
  updateIncidentStatus: (id: string, status: string) => unwrap(api.patch<ApiResponse<Incident>>(`/api/v1/incidents/${encodeURIComponent(id)}/status`, { status })),
  updateIncidentSeverity: (id: string, severity: string) => unwrap(api.patch<ApiResponse<Incident>>(`/api/v1/incidents/${encodeURIComponent(id)}/severity`, { severity })),
  assignIncident: (id: string, owner: string) => unwrap(api.patch<ApiResponse<Incident>>(`/api/v1/incidents/${encodeURIComponent(id)}/assign`, { owner })),
  addIncidentNote: (id: string, content: string) => unwrap(api.post<ApiResponse<Incident>>(`/api/v1/incidents/${encodeURIComponent(id)}/notes`, { content })),
  resolveIncident: (id: string, resolution?: string) => unwrap(api.post<ApiResponse<Incident>>(`/api/v1/incidents/${encodeURIComponent(id)}/resolve`, { resolution })),

  // ── Notifications ───────────────────────────────────────────────────────────
  getChannels: () => unwrap(api.get<ApiResponse<CommunicationChannel[]>>('/api/v1/channels')),
  createChannel: (data: Partial<CommunicationChannel>) => unwrap(api.post<ApiResponse<CommunicationChannel>>('/api/v1/channels', data)),
  updateChannel: (id: string, data: Partial<CommunicationChannel>) => unwrap(api.patch<ApiResponse<CommunicationChannel>>(`/api/v1/channels/${encodeURIComponent(id)}`, data)),
  deleteChannel: (id: string) => unwrap(api.delete<ApiResponse<{ deleted: boolean }>>(`/api/v1/channels/${encodeURIComponent(id)}`)),
  testChannel: (id: string) => unwrap(api.post<ApiResponse<CommunicationChannel>>(`/api/v1/channels/${encodeURIComponent(id)}/test`)),
  getEscalationPolicies: () => unwrap(api.get<ApiResponse<EscalationPolicy[]>>('/api/v1/escalation-policies')),
  saveEscalationPolicies: (policies: Partial<EscalationPolicy>[]) => unwrap(api.put<ApiResponse<EscalationPolicy[]>>('/api/v1/escalation-policies', { policies })),

  // ── Maintenance / runbooks / deployments / backups ──────────────────────────
  getMaintenance: () => unwrap(api.get<ApiResponse<MaintenanceWindow[]>>('/api/v1/maintenance')),
  createMaintenance: (data: Partial<MaintenanceWindow>) => unwrap(api.post<ApiResponse<MaintenanceWindow>>('/api/v1/maintenance', data)),
  completeMaintenance: (id: string) => unwrap(api.post<ApiResponse<MaintenanceWindow>>(`/api/v1/maintenance/${encodeURIComponent(id)}/complete`)),
  deleteMaintenance: (id: string) => unwrap(api.delete<ApiResponse<{ deleted: boolean }>>(`/api/v1/maintenance/${encodeURIComponent(id)}`)),
  getRunbooks: () => unwrap(api.get<ApiResponse<Runbook[]>>('/api/v1/runbooks')),
  createRunbook: (data: Partial<Runbook>) => unwrap(api.post<ApiResponse<Runbook>>('/api/v1/runbooks', data)),
  updateRunbook: (id: string, data: Partial<Runbook>) => unwrap(api.patch<ApiResponse<Runbook>>(`/api/v1/runbooks/${encodeURIComponent(id)}`, data)),
  deleteRunbook: (id: string) => unwrap(api.delete<ApiResponse<{ deleted: boolean }>>(`/api/v1/runbooks/${encodeURIComponent(id)}`)),
  toggleRunbookStep: (id: string, stepId: number) => unwrap(api.post<ApiResponse<Runbook>>(`/api/v1/runbooks/${encodeURIComponent(id)}/steps/${stepId}/toggle`)),
  resetRunbook: (id: string) => unwrap(api.post<ApiResponse<Runbook>>(`/api/v1/runbooks/${encodeURIComponent(id)}/reset`)),
  getDeployments: () => api.get<PaginatedApiResponse<Deployment>>('/api/v1/deployments?pageSize=200').then(r => r.data),
  getBackups: () => api.get<PaginatedApiResponse<BackupRecord>>('/api/v1/backups?pageSize=200').then(r => r.data),
  getBackupStatus: () => unwrap(api.get<ApiResponse<BackupStatus[]>>('/api/v1/backups/status')),
  getDatabaseHealth: () => unwrap(api.get<ApiResponse<DatabaseHealthRow[]>>('/api/v1/health/databases')),
  getAgentHealth: () => unwrap(api.get<ApiResponse<AgentHealthRow[]>>('/api/v1/health/agents')),
  /** Rows plus the fleet summary (same endpoint as getAgentHealth) */
  getAgentFleet: () => api.get<ApiResponse<AgentHealthRow[]> & { summary: AgentFleetSummary }>('/api/v1/health/agents').then(r => ({ rows: r.data, summary: r.summary })),
  getDatabaseFleet: () => api.get<ApiResponse<DatabaseHealthRow[]> & { summary: DatabaseHealthSummary }>('/api/v1/health/databases').then(r => ({ rows: r.data, summary: r.summary })),
  /** Agent events (connected, source-IP mismatch, token rotated) of one server, newest first */
  getAgentEvents: (serverId: string) => api.get<PaginatedApiResponse<AuditLog>>(`/api/v1/audit?category=INFRASTRUCTURE&q=${encodeURIComponent(serverId)}&pageSize=50`)
    .then(r => r.data.filter(l => l.action.startsWith('AGENT_')).slice(0, 10)),

  // ── Providers ───────────────────────────────────────────────────────────────
  getCloudflareZones: () => api.get<{ success: boolean; configured: boolean; lastSyncAt: string | null; lastError: string | null; data: CloudflareZone[] }>('/api/v1/cloudflare/zones'),
  syncCloudflare: () => unwrap(api.post<ApiResponse<CloudflareZone[]>>('/api/v1/cloudflare/sync')),
  getHostingerVms: () => api.get<{ success: boolean; configured: boolean; status: string; lastSyncAt: string | null; lastSuccessAt: string | null; lastError: string | null; data: HostingerInfo[] }>('/api/v1/hostinger/vms'),
  syncHostinger: () => unwrap(api.post<ApiResponse<Array<Record<string, unknown>>>>('/api/v1/hostinger/sync')),
  getLoadBalancers: () => unwrap(api.get<ApiResponse<LoadBalancerState>>('/api/v1/loadbalancers')),
  /** Cloudflare lookups for the configuration forms — the API token stays on the server */
  getCloudflareAccounts: () => unwrap(api.get<ApiResponse<Array<{ id: string; name: string }>>>('/api/v1/cloudflare/accounts')),
  getCloudflarePools: (accountId: string) => unwrap(api.get<ApiResponse<CloudflarePoolOption[]>>(`/api/v1/cloudflare/lb-pools?accountId=${encodeURIComponent(accountId)}`)),
  syncLoadBalancers: () => unwrap(api.post<ApiResponse<LoadBalancerState>>('/api/v1/loadbalancers/sync')),

  // ── Audit / reports ─────────────────────────────────────────────────────────
  getAuditLogs: (params: { page?: number; pageSize?: number; category?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params.category) qs.set('category', params.category);
    if (params.q) qs.set('q', params.q);
    return api.get<PaginatedApiResponse<AuditLog>>(`/api/v1/audit?${qs}`);
  },
  getSummary: () => unwrap(api.get<ApiResponse<SystemSummary>>('/api/v1/reports/summary')),
  getDailyReport: () => unwrap(api.get<ApiResponse<{ report: string; generatedAt: string }>>('/api/v1/reports/daily')),

  // ── Realtime (Server-Sent Events) ───────────────────────────────────────────
  connectRealtimeStream(onEvent: (event: string, data: unknown) => void, onStatus?: (connected: boolean) => void): () => void {
    if (typeof window === 'undefined' || !window.EventSource) return () => {};
    const EVENTS = [
      'connected', 'telemetry_tick', 'server_update', 'servers_changed', 'applications_changed', 'application_update',
      'monitor_update', 'monitor_deleted', 'monitors_changed', 'incident_created', 'incident_update', 'audit',
      'channel_update', 'channels_changed', 'maintenance_update', 'maintenance_deleted', 'runbooks_changed',
      'deployments_changed', 'backups_changed', 'cloudflare_update', 'deadman_update', 'loadbalancer_update',
    ];
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let attempt = 0;

    const connect = async () => {
      if (closed) return;
      if (!tokenStore.getAccess()) return;
      // One-time ticket (60 s) instead of the access token in the URL; request() refreshes an expired session
      let ticket: string;
      try {
        ticket = (await request<ApiResponse<{ ticket: string }>>('/api/v1/realtime/ticket', { method: 'POST', body: '{}' })).data.ticket;
      } catch {
        onStatus?.(false);
        attempt += 1;
        retryTimer = setTimeout(() => { void connect(); }, Math.min(30_000, 2000 * attempt));
        return;
      }
      if (closed) return;
      source = new EventSource(`/api/v1/realtime/stream?ticket=${encodeURIComponent(ticket)}`);
      for (const name of EVENTS) {
        source.addEventListener(name, (e) => {
          try { onEvent(name, JSON.parse((e as MessageEvent).data)); } catch { /* ignore malformed event */ }
        });
      }
      source.onopen = () => { attempt = 0; onStatus?.(true); };
      source.onerror = async () => {
        source?.close();
        onStatus?.(false);
        if (closed) return;
        // Each reconnect fetches a new ticket (refreshing the session if needed)
        attempt += 1;
        retryTimer = setTimeout(() => { void connect(); }, Math.min(30_000, 2000 * attempt));
      };
    };
    void connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  },
};
