import { api, ApiResponse, PaginatedApiResponse } from './api';

export interface AppSummary {
  id: string; name: string; code_name: string; description: string; tier: string;
  status: string; uptime_30d: number | null; uptime_7d: number | null; uptime_24h: number | null;
  rto_target_min: number; rpo_target_min: number; prd_server_id: string | null;
  dr_server_id: string | null; failover_state: string; p50_ms: number | null;
  p95_ms: number | null; p99_ms: number | null; error_rate_percent: number | null;
  cloudflare_zone: string | null; recent_deployment_version: string | null;
  current_replication_lag_sec: number | null; last_checked: string | null;
  prd_hostname?: string; prd_ip?: string; prd_status?: string;
  dr_hostname?: string; dr_ip?: string; dr_status?: string;
  app_name?: string;
}

export interface AppDetail extends AppSummary {
  dependencies?: Array<{
    id: string; name: string; type: string; status: string;
    latency_ms: number | null; target: string | null;
  }>;
  active_incident_count?: number;
  open_monitor_failures?: number;
}

export const ApplicationsService = {
  async list(params?: { page?: number; pageSize?: number; status?: string; tier?: string; search?: string }) {
    const qs = new URLSearchParams();
    if (params?.page)     qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.status)   qs.set('status', params.status);
    if (params?.tier)     qs.set('tier', params.tier);
    if (params?.search)   qs.set('search', params.search);
    return api.get<PaginatedApiResponse<AppSummary>>(`/api/applications?${qs}`);
  },

  async get(id: string) {
    return api.get<ApiResponse<AppDetail>>(`/api/applications/${id}`);
  },

  async update(id: string, data: Partial<AppSummary>) {
    return api.patch<ApiResponse<AppDetail>>(`/api/applications/${id}`, data);
  },
};
