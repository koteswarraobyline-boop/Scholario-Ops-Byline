import { api, ApiResponse, PaginatedApiResponse } from './api';

export interface ServerSummary {
  id: string; hostname: string; ip: string; application_id: string | null;
  environment: string; provider: string; region: string; plan: string | null;
  cpu_cores: number | null; ram_gb: number | null; disk_gb: number | null;
  os: string | null; status: string; agent_version: string | null;
  agent_status: string; uptime_days: number | null; last_seen: string | null;
  app_name?: string; app_code?: string;
}

export interface ServerDetail extends ServerSummary {
  telemetry?: {
    cpu_percent: number; ram_percent: number; disk_percent: number;
    load_avg_1m: number; load_avg_5m: number; load_avg_15m: number;
    network_in_kbps: number; network_out_kbps: number;
    observed_at: string; received_at: string;
  } | null;
  services?: Array<{ name: string; status: string; version: string | null; pid: number | null; memory_mb: number | null; cpu_percent: number | null; last_restart: string | null }>;
  processes?: Array<{ pid: number; name: string; user: string | null; cpu_percent: number | null; mem_mb: number | null; status: string | null }>;
  logs?: Array<{ id: string; level: string; service: string | null; message: string; logged_at: string }>;
}

export interface ServerMetric {
  id: string; server_id: string; cpu_percent: number; ram_percent: number;
  disk_percent: number; load_avg_1m: number; load_avg_5m: number; load_avg_15m: number;
  network_in_kbps: number; network_out_kbps: number; observed_at: string;
}

export const ServersService = {
  async list(params?: { page?: number; pageSize?: number; applicationId?: string; environment?: string; region?: string; status?: string }) {
    const qs = new URLSearchParams();
    if (params?.page)          qs.set('page', String(params.page));
    if (params?.pageSize)      qs.set('pageSize', String(params.pageSize ?? 50));
    if (params?.applicationId) qs.set('applicationId', params.applicationId);
    if (params?.environment)   qs.set('environment', params.environment);
    if (params?.region)        qs.set('region', params.region);
    if (params?.status)        qs.set('status', params.status);
    return api.get<PaginatedApiResponse<ServerSummary>>(`/api/servers?${qs}`);
  },

  async get(id: string) {
    return api.get<ApiResponse<ServerDetail>>(`/api/servers/${id}`);
  },

  async getMetrics(id: string, hours = 1) {
    return api.get<ApiResponse<ServerMetric[]>>(`/api/servers/${id}/metrics?hours=${hours}`);
  },
};
