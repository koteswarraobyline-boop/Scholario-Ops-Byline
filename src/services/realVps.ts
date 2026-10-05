import { api, ApiResponse } from './api';
import { RealVpsConfig, RealVpsProbeResult, RealVpsTcpProbeResult, SyntheticTransactionResult } from '../types';

export interface RealVpsConfigResponse {
  success: boolean;
  data: RealVpsConfig;
  isRealVpsOnlyMode: boolean;
  message?: string;
}

export interface RealVpsProbeResponse {
  success: boolean;
  probeResult: RealVpsProbeResult;
  autoFailoverTriggered: boolean;
  data: RealVpsConfig;
}

export interface RealVpsProbeBothResponse {
  success: boolean;
  mainResult: RealVpsProbeResult;
  drResult: RealVpsProbeResult;
  autoFailoverTriggered: boolean;
  data: RealVpsConfig;
}

export const RealVpsService = {
  async getConfig(): Promise<RealVpsConfigResponse> {
    return api.get<RealVpsConfigResponse>('/api/vps/config');
  },

  async updateConfig(payload: Partial<RealVpsConfig>): Promise<RealVpsConfigResponse> {
    return api.post<RealVpsConfigResponse>('/api/vps/config', payload);
  },

  async probe(targetVps: 'main' | 'dr', customUrl?: string): Promise<RealVpsProbeResponse> {
    return api.post<RealVpsProbeResponse>('/api/vps/probe', { targetVps, customUrl });
  },

  async probeBoth(): Promise<RealVpsProbeBothResponse> {
    return api.post<RealVpsProbeBothResponse>('/api/vps/probe-both', {});
  },

  async failover(target?: 'MAIN' | 'DR', reason?: string): Promise<RealVpsConfigResponse> {
    return api.post<RealVpsConfigResponse>('/api/vps/failover', { target, reason });
  },

  async purgeMockData(): Promise<{ success: boolean; isRealVpsOnlyMode: boolean; message: string }> {
    return api.post<{ success: boolean; isRealVpsOnlyMode: boolean; message: string }>('/api/vps/purge-mock-data', {});
  },

  async restoreMockData(): Promise<{ success: boolean; isRealVpsOnlyMode: boolean; message: string }> {
    return api.post<{ success: boolean; isRealVpsOnlyMode: boolean; message: string }>('/api/vps/restore-mock-data', {});
  },

  async tcpProbe(payload: { targetVps?: 'main' | 'dr'; host?: string; port: number }): Promise<{ success: boolean; result: RealVpsTcpProbeResult }> {
    return api.post<{ success: boolean; result: RealVpsTcpProbeResult }>('/api/vps/tcp-probe', payload);
  },

  async testSynthetic(payload: { url: string; method?: string; body?: string; expectedStatus?: number; matchText?: string }): Promise<{ success: boolean; result: SyntheticTransactionResult }> {
    return api.post<{ success: boolean; result: SyntheticTransactionResult }>('/api/vps/synthetic-test', payload);
  },

  async simulateOutage(targetVps: 'main' | 'dr', simulatedStatus: 'CRITICAL' | 'HEALTHY'): Promise<RealVpsConfigResponse> {
    return api.post<RealVpsConfigResponse>('/api/vps/simulate-outage', { targetVps, simulatedStatus });
  }
};
