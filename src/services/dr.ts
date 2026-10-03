import { api, ApiResponse } from './api';

export interface DrReadinessCheck {
  category: string;
  status: 'READY' | 'WARNING' | 'FAILED' | 'UNKNOWN';
  detail: string;
}

export interface DrReadiness {
  appId: string;
  appName: string;
  failoverState: string;
  checks: DrReadinessCheck[];
  overallReady: boolean;
}

export const DrService = {
  async getReadiness(appId: string) {
    return api.get<ApiResponse<DrReadiness>>(`/api/dr/${appId}/readiness`);
  },

  async triggerFailover(applicationId: string, target: 'DR' | 'PRIMARY') {
    return api.post<ApiResponse<{ success: boolean; message: string; newState: string }>>(
      '/api/dr/failover',
      { applicationId, target }
    );
  },
};
