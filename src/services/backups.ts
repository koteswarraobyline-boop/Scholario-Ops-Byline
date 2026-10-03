import { api, ApiResponse, PaginatedApiResponse } from './api';

export interface BackupRecord {
  id: string; application_id: string; server_id: string | null;
  type: string; size_gb: number | null; destination: string | null;
  retention_days: number; encrypted: boolean; integrity_verified: boolean;
  integrity_hash: string | null; restore_tested_at: string | null;
  restore_duration_min: number | null; restore_status: string;
  status: string; completed_at: string | null; app_name?: string;
}

export const BackupsService = {
  async list(params?: { page?: number; pageSize?: number; applicationId?: string; status?: string }) {
    const qs = new URLSearchParams();
    if (params?.page)          qs.set('page', String(params.page));
    if (params?.pageSize)      qs.set('pageSize', String(params.pageSize ?? 25));
    if (params?.applicationId) qs.set('applicationId', params.applicationId);
    if (params?.status)        qs.set('status', params.status);
    return api.get<PaginatedApiResponse<BackupRecord>>(`/api/backups?${qs}`);
  },

  async get(id: string) {
    return api.get<ApiResponse<BackupRecord>>(`/api/backups/${id}`);
  },
};
