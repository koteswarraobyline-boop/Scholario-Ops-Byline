import { api, ApiResponse, PaginatedApiResponse } from './api';

export interface IncidentSummary {
  id: string; ticket_number: string; title: string; severity: string;
  status: string; application_id: string | null; environment: string;
  fingerprint: string; root_cause: string | null; started_at: string;
  resolved_at: string | null; duration_minutes: number | null;
  owner_name: string | null; acknowledged: boolean; acknowledged_at: string | null;
  acknowledged_by_name: string | null; affected_services: string[];
  affected_monitors: string[]; recovery_status: string | null;
  runbook_id: string | null; app_name?: string; app_code?: string;
}

export interface IncidentDetail extends IncidentSummary {
  timeline?: Array<{ id: string; source: string; level: string; message: string; occurred_at: string }>;
  notes?: Array<{ id: string; author_name: string; author_role: string | null; content: string; created_at: string }>;
}

export const IncidentsService = {
  async list(params?: { page?: number; pageSize?: number; status?: string; severity?: string; applicationId?: string; open?: boolean }) {
    const qs = new URLSearchParams();
    if (params?.page)          qs.set('page', String(params.page));
    if (params?.pageSize)      qs.set('pageSize', String(params.pageSize ?? 25));
    if (params?.status)        qs.set('status', params.status);
    if (params?.severity)      qs.set('severity', params.severity);
    if (params?.applicationId) qs.set('applicationId', params.applicationId);
    if (params?.open)          qs.set('open', 'true');
    return api.get<PaginatedApiResponse<IncidentSummary>>(`/api/incidents?${qs}`);
  },

  async get(id: string) {
    return api.get<ApiResponse<IncidentDetail>>(`/api/incidents/${id}`);
  },

  async acknowledge(id: string) {
    return api.post<ApiResponse<IncidentSummary>>(`/api/incidents/${id}/acknowledge`);
  },

  async changeStatus(id: string, status: string) {
    return api.patch<ApiResponse<IncidentSummary>>(`/api/incidents/${id}/status`, { status });
  },

  async changeSeverity(id: string, severity: string) {
    return api.patch<ApiResponse<IncidentSummary>>(`/api/incidents/${id}/severity`, { severity });
  },

  async assign(id: string, ownerName: string, ownerId: string) {
    return api.patch<ApiResponse<IncidentSummary>>(`/api/incidents/${id}/assign`, { ownerName, ownerId });
  },

  async addNote(id: string, content: string) {
    return api.post<ApiResponse<{ message: string }>>(`/api/incidents/${id}/notes`, { content });
  },

  async resolve(id: string, resolution: string) {
    return api.post<ApiResponse<IncidentSummary>>(`/api/incidents/${id}/resolve`, { resolution });
  },
};
