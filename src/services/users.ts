import { api, ApiResponse, PaginatedApiResponse, SafeUser } from './api';

export const UsersService = {
  async list(params?: { page?: number; pageSize?: number }) {
    const qs = new URLSearchParams();
    if (params?.page)     qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize ?? 25));
    return api.get<PaginatedApiResponse<SafeUser>>(`/api/users?${qs}`);
  },

  async get(id: string) {
    return api.get<ApiResponse<SafeUser>>(`/api/users/${id}`);
  },

  async update(id: string, data: Partial<SafeUser & { isActive: boolean; isOnCall: boolean; roleName: string }>) {
    return api.patch<ApiResponse<SafeUser>>(`/api/users/${id}`, data);
  },

  async create(data: { email: string; password: string; fullName: string; displayName?: string; roleName: string }) {
    return api.post<ApiResponse<SafeUser>>('/api/users', data);
  },
};
