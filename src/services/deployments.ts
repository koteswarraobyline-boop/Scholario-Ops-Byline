import { api, ApiResponse, PaginatedApiResponse } from './api';

export interface Deployment {
  id: string; application_id: string; version: string; commit_hash: string | null;
  commit_message: string | null; environment: string; author: string | null;
  started_at: string; completed_at: string | null; duration_sec: number | null;
  status: string; rollback_available: boolean; app_name?: string;
  events?: Array<{ id: string; stage: string; status: string; message: string | null; occurred_at: string }>;
}

export const DeploymentsService = {
  async list(params?: { page?: number; pageSize?: number; applicationId?: string; status?: string }) {
    const qs = new URLSearchParams();
    if (params?.page)          qs.set('page', String(params.page));
    if (params?.pageSize)      qs.set('pageSize', String(params.pageSize ?? 25));
    if (params?.applicationId) qs.set('applicationId', params.applicationId);
    if (params?.status)        qs.set('status', params.status);
    return api.get<PaginatedApiResponse<Deployment>>(`/api/deployments?${qs}`);
  },

  async get(id: string) {
    return api.get<ApiResponse<Deployment>>(`/api/deployments/${id}`);
  },
};
