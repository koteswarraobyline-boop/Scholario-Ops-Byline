import { api, ApiResponse, PaginatedApiResponse } from './api';

export interface MaintenanceWindow {
  id: string; title: string; application_id: string | null; environment: string;
  start_time: string; end_time: string; expected_impact: string | null;
  suppress_monitors: string[]; status: string; approved_by: string | null;
  reason: string | null; app_name?: string;
}

export const MaintenanceService = {
  async list(params?: { page?: number }) {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    return api.get<PaginatedApiResponse<MaintenanceWindow>>(`/api/maintenance?${qs}`);
  },

  async get(id: string) {
    return api.get<ApiResponse<MaintenanceWindow>>(`/api/maintenance/${id}`);
  },

  async create(data: Partial<MaintenanceWindow>) {
    return api.post<ApiResponse<MaintenanceWindow>>('/api/maintenance', data);
  },

  async complete(id: string) {
    return api.patch<ApiResponse<{ status: string }>>(`/api/maintenance/${id}/complete`);
  },
};
