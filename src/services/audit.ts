import { api, PaginatedApiResponse } from './api';

export interface AuditLogEntry {
  id: string; timestamp: string; operator_id: string | null; operator: string;
  action: string; category: string; target_id: string | null;
  target_type: string | null; details: string | null;
  ip_address: string | null; request_id: string | null;
}

export const AuditService = {
  async list(params?: { page?: number; pageSize?: number; category?: string; from?: string; to?: string }) {
    const qs = new URLSearchParams();
    if (params?.page)     qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize ?? 50));
    if (params?.category) qs.set('category', params.category);
    if (params?.from)     qs.set('from', params.from);
    if (params?.to)       qs.set('to', params.to);
    return api.get<PaginatedApiResponse<AuditLogEntry>>(`/api/audit?${qs}`);
  },
};
