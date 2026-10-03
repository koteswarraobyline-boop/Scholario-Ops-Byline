import { api, ApiResponse } from './api';

export interface SystemSummary {
  totalApps: number; healthyApps: number;
  totalServers: number; healthyServers: number;
  totalMonitors: number; healthyMonitors: number;
  openIncidents: number; criticalIncidents: number;
  drReadinessCount: number; backupsCurrentCount: number;
  cloudflareStatus: 'HEALTHY' | 'DEGRADED';
  deadManStatus: string; deadManLastHeartbeat: string | null;
  overallHealth: 'OPERATIONAL' | 'WARNING' | 'CRITICAL';
  generatedAt: string;
}

export const ReportsService = {
  async getSummary() {
    return api.get<ApiResponse<SystemSummary>>('/api/reports/summary');
  },

  async getDaily() {
    return api.get<ApiResponse<{ report: string; generatedAt: string }>>('/api/reports/daily');
  },

  async getUptime() {
    return api.get<ApiResponse<unknown[]>>('/api/reports/uptime');
  },
};
