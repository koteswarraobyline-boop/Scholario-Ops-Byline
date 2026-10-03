import { api, ApiResponse, PaginatedApiResponse } from './api';

export interface Channel {
  id: string; name: string; type: string; enabled: boolean;
  target_endpoint: string; last_delivery_at: string | null;
  last_delivery_status: string | null; failure_count: number;
}

export const NotificationsService = {
  async listChannels() {
    return api.get<ApiResponse<Channel[]>>('/api/notifications/channels');
  },

  async testChannel(id: string) {
    return api.post<ApiResponse<{ success: boolean }>>(`/api/notifications/channels/${id}/test`);
  },

  async listDeliveries(params?: { channelId?: string; incidentId?: string; page?: number; pageSize?: number }) {
    const qs = new URLSearchParams();
    if (params?.channelId)  qs.set('channelId', params.channelId);
    if (params?.incidentId) qs.set('incidentId', params.incidentId);
    if (params?.page)       qs.set('page', String(params.page));
    if (params?.pageSize)   qs.set('pageSize', String(params.pageSize ?? 25));
    return api.get<PaginatedApiResponse<unknown>>(`/api/notifications/deliveries?${qs}`);
  },
};
