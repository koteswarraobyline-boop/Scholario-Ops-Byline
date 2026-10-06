import { 
  Application, 
  VpsServer, 
  Monitor, 
  Incident, 
  CloudflareZone, 
  AuditLog, 
  DeadManControlPlane,
  MonitorType,
  Environment
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

export interface SyntheticProbeResult {
  success: boolean;
  statusCode: number;
  latencyMs: number;
  resolvedIp: string;
  tlsInfo?: string;
  responseSnippet: string;
  testedAt: string;
}

export interface SafeUser {
  id: string;
  email: string;
  fullName: string;
  displayName?: string;
  roleName: 'viewer' | 'operator' | 'it_administrator' | 'super_admin' | string;
  isActive: boolean;
  isOnCall: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
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
    try {
      return localStorage.getItem('scholario_access_token');
    } catch {
      return null;
    }
  },
  getRefresh(): string | null {
    try {
      return localStorage.getItem('scholario_refresh_token');
    } catch {
      return null;
    }
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
    } catch {}
  },
  clear() {
    try {
      localStorage.removeItem('scholario_access_token');
      localStorage.removeItem('scholario_refresh_token');
      localStorage.removeItem('scholario_user');
    } catch {}
  }
};

const API_BASE = '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = tokenStore.getAccess();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errBody: any = null;
    try {
      errBody = await res.json();
    } catch {
      const text = await res.text().catch(() => '');
      throw new ApiError(text || `HTTP ${res.status}`, res.status);
    }
    const message = errBody?.message || errBody?.error || `HTTP ${res.status}`;
    if (res.status === 401) {
      logoutHandler?.();
    }
    throw new ApiError(message, res.status, errBody?.code);
  }

  return res.json() as Promise<T>;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API Error ${res.status} ${res.statusText}: ${text || 'Unknown error'}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // ── Generic REST Client Methods ─────────────────────────────────────────────
  get<T>(path: string, options?: RequestInit): Promise<T> {
    return request<T>(path, { ...options, method: 'GET' });
  },

  post<T>(path: string, body?: unknown, options?: RequestInit): Promise<T> {
    return request<T>(path, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  },

  patch<T>(path: string, body?: unknown, options?: RequestInit): Promise<T> {
    return request<T>(path, {
      ...options,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  },

  delete<T>(path: string, options?: RequestInit): Promise<T> {
    return request<T>(path, { ...options, method: 'DELETE' });
  },
  // ── Health Check (no auth required) ─────────────────────────────────────────
  async checkHealth(): Promise<HealthCheckResponse> {
    const res = await fetch(`${API_BASE}/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });
    return handleResponse<HealthCheckResponse>(res);
  },

  // ── System Summary ──────────────────────────────────────────────────────────
  async getSystemSummary() {
    const res = await fetch(`${API_BASE}/api/v1/system/summary`);
    return handleResponse<{ success: boolean; data: any }>(res);
  },

  // ── Applications ────────────────────────────────────────────────────────────
  async getApplications(): Promise<Application[]> {
    const res = await fetch(`${API_BASE}/api/v1/applications`);
    const data = await handleResponse<{ success: boolean; data: Application[] }>(res);
    return data.data;
  },

  async triggerFailover(appId: string, targetOrigin: 'DR' | 'PRIMARY'): Promise<Application> {
    const res = await fetch(`${API_BASE}/api/v1/applications/${encodeURIComponent(appId)}/failover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetOrigin })
    });
    const data = await handleResponse<{ success: boolean; data: Application }>(res);
    return data.data;
  },

  // ── VPS Servers ─────────────────────────────────────────────────────────────
  async getServers(): Promise<VpsServer[]> {
    const res = await fetch(`${API_BASE}/api/v1/servers`);
    const data = await handleResponse<{ success: boolean; data: VpsServer[] }>(res);
    return data.data;
  },

  async ingestTelemetry(payload: { serverId: string; cpuPercent: number; ramPercent: number; diskPercent?: number }) {
    const res = await fetch(`${API_BASE}/api/v1/servers/telemetry/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return handleResponse<{ success: boolean; message: string }>(res);
  },

  // ── Monitors ────────────────────────────────────────────────────────────────
  async getMonitors(): Promise<Monitor[]> {
    const res = await fetch(`${API_BASE}/api/v1/monitors`);
    const data = await handleResponse<{ success: boolean; data: Monitor[] }>(res);
    return data.data;
  },

  async createMonitor(payload: Partial<Monitor>): Promise<Monitor> {
    const res = await fetch(`${API_BASE}/api/v1/monitors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await handleResponse<{ success: boolean; data: Monitor }>(res);
    return data.data;
  },

  async probeMonitor(monitorId: string): Promise<{ monitor: Monitor; probeResult: any }> {
    const res = await fetch(`${API_BASE}/api/v1/monitors/${encodeURIComponent(monitorId)}/probe`, {
      method: 'POST'
    });
    const data = await handleResponse<{ success: boolean; data: Monitor; probeResult: any }>(res);
    return { monitor: data.data, probeResult: data.probeResult };
  },

  async probeAllMonitors(): Promise<Monitor[]> {
    const res = await fetch(`${API_BASE}/api/v1/monitors/probe-all`, {
      method: 'POST'
    });
    const data = await handleResponse<{ success: boolean; data: Monitor[] }>(res);
    return data.data;
  },

  async toggleMonitor(monitorId: string): Promise<Monitor> {
    const res = await fetch(`${API_BASE}/api/v1/monitors/${encodeURIComponent(monitorId)}/toggle`, {
      method: 'PATCH'
    });
    const data = await handleResponse<{ success: boolean; data: Monitor }>(res);
    return data.data;
  },

  async deleteMonitor(monitorId: string): Promise<boolean> {
    const res = await fetch(`${API_BASE}/api/v1/monitors/${encodeURIComponent(monitorId)}`, {
      method: 'DELETE'
    });
    await handleResponse<{ success: boolean }>(res);
    return true;
  },

  async testSyntheticProbe(payload: { target: string; type?: MonitorType; timeoutSec?: number }): Promise<SyntheticProbeResult> {
    const res = await fetch(`${API_BASE}/api/v1/monitors/test-synthetic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return handleResponse<SyntheticProbeResult>(res);
  },

  // ── Incidents ───────────────────────────────────────────────────────────────
  async getIncidents(): Promise<Incident[]> {
    const res = await fetch(`${API_BASE}/api/v1/incidents`);
    const data = await handleResponse<{ success: boolean; data: Incident[] }>(res);
    return data.data;
  },

  async acknowledgeIncident(incidentId: string, operatorName?: string): Promise<Incident> {
    const res = await fetch(`${API_BASE}/api/v1/incidents/${encodeURIComponent(incidentId)}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorName })
    });
    const data = await handleResponse<{ success: boolean; data: Incident }>(res);
    return data.data;
  },

  async updateIncidentStatus(incidentId: string, status: string): Promise<Incident> {
    const res = await fetch(`${API_BASE}/api/v1/incidents/${encodeURIComponent(incidentId)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const data = await handleResponse<{ success: boolean; data: Incident }>(res);
    return data.data;
  },

  async addIncidentNote(incidentId: string, content: string, author?: string) {
    const res = await fetch(`${API_BASE}/api/v1/incidents/${encodeURIComponent(incidentId)}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, author })
    });
    return handleResponse<{ success: boolean; data: Incident; note: any }>(res);
  },

  // ── Dead-Man Watchdog ───────────────────────────────────────────────────────
  async getDeadManStatus(): Promise<DeadManControlPlane> {
    const res = await fetch(`${API_BASE}/api/v1/deadman/status`);
    const data = await handleResponse<{ success: boolean; data: DeadManControlPlane }>(res);
    return data.data;
  },

  async toggleDeadManSilence(): Promise<DeadManControlPlane> {
    const res = await fetch(`${API_BASE}/api/v1/deadman/toggle-silence`, {
      method: 'POST'
    });
    const data = await handleResponse<{ success: boolean; data: DeadManControlPlane }>(res);
    return data.data;
  },

  // ── Cloudflare & Audit ──────────────────────────────────────────────────────
  async getCloudflareZones(): Promise<CloudflareZone[]> {
    const res = await fetch(`${API_BASE}/api/v1/cloudflare/zones`);
    const data = await handleResponse<{ success: boolean; data: CloudflareZone[] }>(res);
    return data.data;
  },

  async getAuditLogs(): Promise<AuditLog[]> {
    const res = await fetch(`${API_BASE}/api/v1/audit`);
    const data = await handleResponse<{ success: boolean; data: AuditLog[] }>(res);
    return data.data;
  },

  async sendTestNotification(channelId: string, customMessage?: string) {
    const res = await fetch(`${API_BASE}/api/v1/notifications/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, customMessage })
    });
    return handleResponse<{ success: boolean; deliveredAt: string }>(res);
  },

  // ── Realtime SSE Connection ─────────────────────────────────────────────────
  connectRealtimeStream(onEvent: (event: string, data: any) => void): () => void {
    if (typeof window === 'undefined' || !window.EventSource) {
      return () => {};
    }

    let source: EventSource | null = null;
    let reconnectTimeout: any = null;

    function connect() {
      try {
        source = new EventSource('/api/v1/realtime/stream');

        source.addEventListener('connected', (e) => {
          try {
            onEvent('connected', JSON.parse(e.data));
          } catch {}
        });

        source.addEventListener('telemetry_tick', (e) => {
          try {
            onEvent('telemetry_tick', JSON.parse(e.data));
          } catch {}
        });

        source.addEventListener('monitor_created', (e) => {
          try {
            onEvent('monitor_created', JSON.parse(e.data));
          } catch {}
        });

        source.addEventListener('monitor_probed', (e) => {
          try {
            onEvent('monitor_probed', JSON.parse(e.data));
          } catch {}
        });

        source.addEventListener('monitor_deleted', (e) => {
          try {
            onEvent('monitor_deleted', JSON.parse(e.data));
          } catch {}
        });

        source.addEventListener('incident_update', (e) => {
          try {
            onEvent('incident_update', JSON.parse(e.data));
          } catch {}
        });

        source.addEventListener('application_update', (e) => {
          try {
            onEvent('application_update', JSON.parse(e.data));
          } catch {}
        });

        source.addEventListener('real_vps_update', (e) => {
          try {
            onEvent('real_vps_update', JSON.parse(e.data));
          } catch {}
        });

        source.addEventListener('real_vps_probed', (e) => {
          try {
            onEvent('real_vps_probed', JSON.parse(e.data));
          } catch {}
        });

        source.addEventListener('real_vps_failover', (e) => {
          try {
            onEvent('real_vps_failover', JSON.parse(e.data));
          } catch {}
        });

        source.addEventListener('mock_data_purged', (e) => {
          try {
            onEvent('mock_data_purged', JSON.parse(e.data));
          } catch {}
        });

        source.addEventListener('mock_data_restored', (e) => {
          try {
            onEvent('mock_data_restored', JSON.parse(e.data));
          } catch {}
        });

        source.addEventListener('audit', (e) => {
          try {
            onEvent('audit', JSON.parse(e.data));
          } catch {}
        });

        source.onerror = () => {
          source?.close();
          reconnectTimeout = setTimeout(connect, 3000);
        };
      } catch {
        reconnectTimeout = setTimeout(connect, 5000);
      }
    }

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      source?.close();
    };
  }
};
