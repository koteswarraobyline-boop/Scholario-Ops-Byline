import { api, ApiResponse, PaginatedApiResponse } from './api';

export interface RunbookStep {
  id: string; runbook_id: string; step_order: number;
  title: string; instruction: string; command: string | null;
}

export interface Runbook {
  id: string; title: string; description: string | null; category: string;
  estimated_duration_min: number; version: number; step_count?: number;
  steps?: RunbookStep[];
}

export interface RunbookExecution {
  id: string; runbook_id: string; incident_id: string | null;
  executed_by: string; started_at: string; completed_at: string | null;
  steps_done: number; total_steps: number; notes: string | null;
}

export const RunbooksService = {
  async list(params?: { page?: number; category?: string }) {
    const qs = new URLSearchParams();
    if (params?.page)     qs.set('page', String(params.page));
    if (params?.category) qs.set('category', params.category);
    return api.get<PaginatedApiResponse<Runbook>>(`/api/runbooks?${qs}`);
  },

  async get(id: string) {
    return api.get<ApiResponse<Runbook>>(`/api/runbooks/${id}`);
  },

  async startExecution(id: string, incidentId?: string) {
    return api.post<ApiResponse<RunbookExecution>>(`/api/runbooks/${id}/execute`, { incidentId });
  },

  async completeStep(executionId: string, stepId: string, completed: boolean) {
    return api.patch<ApiResponse<{ completed: boolean }>>(
      `/api/runbooks/executions/${executionId}/steps/${stepId}`,
      { completed }
    );
  },
};
