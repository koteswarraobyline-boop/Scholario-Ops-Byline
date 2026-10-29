/** Identity of the development-only automatic-alert test. Shared by the server and the UI. */
/** Fixed UUID: monitors.id is a uuid column, so a word like "mock-incident-alert" is rejected and blocks every later save. */
export const MOCK_INCIDENT_MONITOR_ID = 'c0ffee00-0000-4000-8000-000000000001';
/** Earlier builds used this id. It must not be written again. */
export const MOCK_INCIDENT_MONITOR_ID_LEGACY = 'mock-incident-alert';
export const MOCK_INCIDENT_FINGERPRINT = `monitor:${MOCK_INCIDENT_MONITOR_ID}`;
export const MOCK_INCIDENT_MONITOR_NAME = 'TEST — Automatic incident alert';

export const isMockIncident = (i: { fingerprint?: string | null }): boolean =>
  i.fingerprint === MOCK_INCIDENT_FINGERPRINT;

export type MockStageStatus = 'PASS' | 'FAIL' | 'NOT_VERIFIED';

export interface MockIncidentStage {
  id: string;
  label: string;
  status: MockStageStatus;
  detail: string;
  at?: string;
}

/** What one run of “Test Automatic Incident Alert” observed. Inbox delivery is never claimed from SMTP acceptance. */
export interface MockIncidentReport {
  duplicate: boolean;
  incidentId: string | null;
  monitorId: string;
  monitorName: string;
  stages: MockIncidentStage[];
}

export interface MockIncidentStatus {
  available: boolean;
  monitorId: string;
  monitorName: string;
  openIncidentId: string | null;
  enabledEmailChannels: number;
  smtpConfigured: boolean;
}
