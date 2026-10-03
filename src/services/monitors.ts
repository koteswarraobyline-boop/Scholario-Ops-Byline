import { api, ApiResponse, PaginatedApiResponse } from './api';

export interface MonitorSummary {
  id: string; name: string; type: string; target: string;
  application_id: string | null; environment: string; interval_sec: number;
  timeout_sec: number; retries: number; warning_threshold_ms: number;
  critical_threshold_ms: number; failure_confirmation_threshold: number;
  recovery_confirmation_threshold: number; consecutive_failures: number;
  consecutive_recoveries: number; status: string; last_check: string | null;
  last_success: string | null; last_failure: string | null;
  response_time_ms: number | null; uptime_percent: number | null;
  enabled: boolean; active_maintenance: boolean; app_name?: string;
}

export interface MonitorDetail extends MonitorSummary {
  recent_results?: Array<{
    id: string; status: string; response_time_ms: number | null;
    status_code: number | null; detail: string | null; checked_at: string;
  }>;
}

export const MonitorsService = {
  async list(params?: { page?: number; pageSize?: number; applicationId?: string; status?: string; type?: string; environment?: string; enabled?: boolean }) {
    const qs = new URLSearchParams();
    if (params?.page)          qs.set('page', String(params.page));
    if (params?.pageSize)      qs.set('pageSize', String(params.pageSize ?? 50));
    if (params?.applicationId) qs.set('applicationId', params.applicationId);
    if (params?.status)        qs.set('status', params.status);
    if (params?.type)          qs.set('type', params.type);
    if (params?.environment)   qs.set('environment', params.environment);
    if (params?.enabled !== undefined) qs.set('enabled', String(params.enabled));
    return api.get<PaginatedApiResponse<MonitorSummary>>(`/api/monitors?${qs}`);
  },

  async get(id: string) {
    return api.get<ApiResponse<MonitorDetail>>(`/api/monitors/${id}`);
  },

  async probe(id: string) {
    return api.post<ApiResponse<{ status: string; responseTimeMs: number; detail: string }>>(`/api/monitors/${id}/probe`);
  },

  async create(data: Partial<MonitorSummary>) {
    return api.post<ApiResponse<MonitorSummary>>('/api/monitors', data);
  },

  async update(id: string, data: Partial<MonitorSummary>) {
    return api.patch<ApiResponse<MonitorSummary>>(`/api/monitors/${id}`, data);
  },

  async delete(id: string) {
    return api.delete<void>(`/api/monitors/${id}`);
  },
};
