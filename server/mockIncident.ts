/**
 * Development-only “Test Automatic Incident Alert”.
 *
 * Feeds a simulated HTTP 503 into the same applyOutcome → incident → notifyIncident path a real
 * check uses. The monitor is disabled and points at a name that is never probed, so no production
 * host is contacted and no real monitor’s health changes.
 *
 * SMTP acceptance is recorded from the delivery log. Inbox delivery is never claimed: this process
 * cannot see the recipient’s mailbox.
 */
import crypto from 'crypto';
import { Monitor } from '../src/types/index.ts';
import {
  MOCK_INCIDENT_FINGERPRINT, MOCK_INCIDENT_MONITOR_ID, MOCK_INCIDENT_MONITOR_ID_LEGACY, MOCK_INCIDENT_MONITOR_NAME,
  MockIncidentReport, MockIncidentStage, MockStageStatus, isMockIncident,
} from '../src/lib/mockIncident.ts';
import { config } from './config.ts';
import { db, persist } from './store.ts';
import { applyOutcome, closeMonitorIncident } from './engine.ts';
import { channelsForSeverity } from './notify.ts';
import { deliveriesForIncident } from './deliveries.ts';
import type { NotificationDelivery } from '../src/types/index.ts';

const SIMULATED_DETAIL = 'TEST simulated HTTP 503 Service Unavailable';
const WAIT_MS = 40_000;

/** Local development and the test runner. A production process (NODE_ENV=production, or neither --dev nor an explicit test flag) cannot run it. */
export function allowMockIncidentTest(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.ALLOW_MOCK_INCIDENT_TEST === '0') return false;
  return process.argv.includes('--dev')
    || process.env.NODE_ENV === 'development'
    || process.env.NODE_ENV === 'test'
    || process.env.ALLOW_MOCK_INCIDENT_TEST === '1';
}

const scrub = (s: string): string => {
  const pass = config.smtp.pass;
  return pass && pass.length >= 4 ? s.split(pass).join('••••') : s;
};

const stage = (id: string, label: string, status: MockStageStatus, detail: string, at?: string): MockIncidentStage =>
  ({ id, label, status, detail: scrub(detail), at });

function ensureMockMonitor(): Monitor {
  if (db.monitors.some(x => x.id === MOCK_INCIDENT_MONITOR_ID_LEGACY)) {
    db.monitors = db.monitors.filter(x => x.id !== MOCK_INCIDENT_MONITOR_ID_LEGACY);
  }
  let m = db.monitors.find(x => x.id === MOCK_INCIDENT_MONITOR_ID);
  if (!m) {
    m = {
      id: MOCK_INCIDENT_MONITOR_ID,
      name: MOCK_INCIDENT_MONITOR_NAME,
      type: 'HTTP',
      target: 'http://mock.test.invalid/health',
      applicationId: '',
      environment: 'PRD',
      intervalSec: 3600,
      timeoutSec: 5,
      retries: 1,
      warningThresholdMs: 0,
      criticalThresholdMs: 0,
      failureConfirmationThreshold: 1,
      recoveryConfirmationThreshold: 1,
      consecutiveFailures: 0,
      consecutiveRecoveries: 0,
      status: 'UNKNOWN',
      lastCheck: '',
      lastSuccess: '',
      responseTimeMs: 0,
      uptimePercent: 100,
      history: [],
      enabled: false,
      activeMaintenance: false,
    };
    db.monitors.push(m);
  }
  m.name = MOCK_INCIDENT_MONITOR_NAME;
  m.type = 'HTTP';
  m.target = 'http://mock.test.invalid/health';
  m.applicationId = '';
  m.serverId = undefined;
  m.environment = 'PRD';
  m.enabled = false;
  m.activeMaintenance = false;
  m.failureConfirmationThreshold = 1;
  return m;
}

const openMock = () => db.incidents.find(i => isMockIncident(i) && i.status !== 'RESOLVED' && i.status !== 'CLOSED');

function emailChannels() {
  return channelsForSeverity('CRITICAL').filter(c => c.type === 'EMAIL');
}

async function reportFor(incidentId: string, duplicate: boolean, opts: {
  failureGenerated: boolean;
  notified: boolean | null;
  held?: string;
  suppressed?: string;
  noEmail?: string;
  /** A second click while the TEST incident is still open. The earlier send is reported; nothing new is sent. */
  repeat?: boolean;
}): Promise<MockIncidentReport> {
  const incident = db.incidents.find(i => i.id === incidentId);
  const selected = emailChannels();
  const deliveries = incidentId ? await deliveriesForIncident(incidentId) : [];
  const emailRows = deliveries.filter(r => r.channelType === 'EMAIL');
  const latest = emailRows[emailRows.length - 1];
  const recipients = [...new Set(selected.flatMap(c => c.targetEndpoint.split(/[,;\s]+/).filter(Boolean)))];

  const stages: MockIncidentStage[] = [];
  stages.push(stage(
    'mock_failure', 'Mock failure generated', opts.failureGenerated || incident ? 'PASS' : 'FAIL',
    incident?.context?.responseCode === 503 || incident?.rootCause.includes('503')
      ? `Simulated HTTP 503 on ${MOCK_INCIDENT_MONITOR_NAME}. No real host was contacted.`
      : opts.failureGenerated ? SIMULATED_DETAIL : 'The simulated failure was not applied.',
    incident?.startedAt,
  ));
  stages.push(stage(
    'incident_created', 'Incident created', incident ? 'PASS' : 'FAIL',
    incident ? `${incident.id} “${incident.title}” is ${incident.status}.` : 'No TEST incident was opened.',
    incident?.startedAt,
  ));

  const ruleDetail = opts.repeat
    ? `This request did not send again. ${opts.suppressed ?? ''}`.trim()
    : opts.held
      ? opts.held
      : opts.suppressed
        ? opts.suppressed
        : selected.length
          ? `CRITICAL notifications include ${selected.length} enabled Email channel(s): ${selected.map(c => c.name).join(', ')}.`
          : 'No enabled Email channel is selected for CRITICAL. Other channel types are not part of this email test.';
  stages.push(stage(
    'rule_matched', 'Notification rule matched',
    !incident ? 'FAIL' : opts.repeat ? 'PASS' : opts.held || selected.length === 0 || opts.notified === false ? 'FAIL' : 'PASS',
    ruleDetail,
    incident?.startedAt,
  ));

  stages.push(stage(
    'email_queued', 'Email queued',
    !incident ? 'FAIL'
      : opts.repeat ? (emailRows.length ? 'PASS' : 'FAIL')
      : opts.noEmail || opts.held || opts.suppressed ? 'FAIL'
      : emailRows.length || opts.notified ? 'PASS' : 'FAIL',
    opts.repeat
      ? (emailRows.length
        ? `This click did not queue another email. The earlier message was queued for ${recipients.join(', ') || 'the Email channel'}.`
        : 'This click did not queue an email, and no earlier Email delivery is on record.')
      : opts.noEmail
        ? opts.noEmail
        : opts.held
          ? 'Not queued yet. ' + opts.held
          : opts.suppressed
            ? opts.suppressed
            : emailRows.length
              ? `Queued for ${recipients.join(', ') || 'the Email channel'}.`
              : 'The Email channel was not asked to send.',
    latest?.t,
  ));

  stages.push(smtpAttemptStage(latest, opts));
  stages.push(smtpResultStage(latest, opts));
  stages.push(stage(
    'inbox_confirmed', 'Inbox delivery confirmed', 'NOT_VERIFIED',
    'SMTP acceptance is not inbox delivery. This server cannot see the recipient mailbox, a bounce, or a read receipt.',
  ));
  stages.push(finalStage(latest, opts));

  return {
    duplicate,
    incidentId: incident?.id ?? null,
    monitorId: MOCK_INCIDENT_MONITOR_ID,
    monitorName: MOCK_INCIDENT_MONITOR_NAME,
    stages,
  };
}

function smtpAttemptStage(latest: NotificationDelivery | undefined, opts: { held?: string; suppressed?: string; noEmail?: string }): MockIncidentStage {
  if (!latest && (opts.noEmail || opts.held || opts.suppressed)) {
    return stage('smtp_attempted', 'SMTP send attempted', 'FAIL', opts.noEmail || opts.held || opts.suppressed || 'No send was attempted.');
  }
  if (!latest) return stage('smtp_attempted', 'SMTP send attempted', 'FAIL', 'No Email delivery was recorded. The send did not finish, or no Email channel was called.');
  return stage(
    'smtp_attempted', 'SMTP send attempted', 'PASS',
    `The Email channel “${latest.channelName}” attempted SMTP ${latest.attempts} time(s).`,
    latest.t,
  );
}

function smtpResultStage(latest: NotificationDelivery | undefined, opts: { held?: string; suppressed?: string; noEmail?: string }): MockIncidentStage {
  if (!latest && (opts.noEmail || opts.held || opts.suppressed)) {
    return stage('smtp_result', 'SMTP server accepted or rejected', 'FAIL', opts.noEmail || opts.held || opts.suppressed || 'No SMTP result was recorded.');
  }
  if (!latest) {
    return stage('smtp_result', 'SMTP server accepted or rejected', opts.noEmail || opts.held || opts.suppressed ? 'FAIL' : 'FAIL',
      'No SMTP result was recorded.');
  }
  if (latest.result === 'DELIVERED') {
    return stage('smtp_result', 'SMTP server accepted or rejected', 'PASS',
      `The mail server accepted the message after ${latest.attempts} attempt(s). This is not confirmation that it reached an inbox.`, latest.t);
  }
  return stage('smtp_result', 'SMTP server accepted or rejected', 'FAIL',
    `Rejected or failed after ${latest.attempts} attempt(s), using the existing retry policy. ${latest.error ?? 'No error text.'}`, latest.t);
}

function finalStage(latest: NotificationDelivery | undefined, opts: { held?: string; suppressed?: string; noEmail?: string }): MockIncidentStage {
  if (latest?.result === 'DELIVERED') {
    return stage('final_status', 'Final notification status', 'PASS',
      `Email channel result: DELIVERED (SMTP accepted). Inbox delivery: NOT VERIFIED.`, latest.t);
  }
  if (latest?.result === 'FAILED') {
    return stage('final_status', 'Final notification status', 'FAIL',
      `Email channel result: FAILED. ${latest.error ?? ''}`.trim(), latest.t);
  }
  if (opts.held || opts.suppressed || opts.noEmail) {
    return stage('final_status', 'Final notification status', 'FAIL', opts.held || opts.suppressed || opts.noEmail || 'Not sent.');
  }
  return stage('final_status', 'Final notification status', 'FAIL', 'No final Email result.');
}

async function waitForEmail(incidentId: string): Promise<NotificationDelivery | undefined> {
  const deadline = Date.now() + WAIT_MS;
  let latest: NotificationDelivery | undefined;
  while (Date.now() < deadline) {
    const rows = await deliveriesForIncident(incidentId);
    latest = rows.filter(r => r.channelType === 'EMAIL').at(-1);
    if (latest) return latest;
    await new Promise(r => setTimeout(r, 150));
  }
  return latest;
}

let inflight: Promise<MockIncidentReport> | null = null;

async function execute(operator: string): Promise<MockIncidentReport> {
  const m = ensureMockMonitor();
  const already = openMock();
  if (already) {
    return reportFor(already.id, true, {
      failureGenerated: false,
      notified: null,
      repeat: true,
      suppressed: `TEST incident ${already.id} is already open. No second failure was simulated and no second email was sent.`,
    });
  }

  m.status = 'UNKNOWN';
  m.consecutiveFailures = 0;
  m.consecutiveRecoveries = 0;
  m.history = [];
  applyOutcome(m, {
    ok: false, degraded: false, latencyMs: 5, statusCode: 503, probeStatus: 'DOWN', detail: SIMULATED_DETAIL,
  });
  persist();

  const incident = openMock();
  if (!incident) {
    return reportFor('', false, { failureGenerated: true, notified: false, noEmail: 'The simulated failure did not open an incident.' });
  }
  auditSafe(operator, incident.id);

  const selected = emailChannels();
  if (selected.length === 0) {
    return reportFor(incident.id, false, {
      failureGenerated: true, notified: false,
      noEmail: 'No enabled Email channel is on the CRITICAL notification rule, so nothing was sent.',
    });
  }
  if (incident.notificationDeferred) {
    const policy = db.escalationPolicies.find(p => p.severity === incident.severity);
    return reportFor(incident.id, false, {
      failureGenerated: true, notified: false,
      held: `The CRITICAL policy holds the first notification for ${policy?.initialDelayMin ?? 0} min. The email has not been sent yet. The existing rule was not bypassed.`,
    });
  }

  const row = await waitForEmail(incident.id);
  const suppressed = !row && !incident.timeline.some(e => e.message.startsWith('Notification held'));
  return reportFor(incident.id, false, {
    failureGenerated: true,
    notified: Boolean(row),
    suppressed: row ? undefined : suppressed
      ? `No Email delivery was recorded within ${WAIT_MS / 1000}s. If a notification was sent recently for this test, the ${config.alertCooldownMin} min cooldown suppresses another one.`
      : undefined,
  });
}

function auditSafe(operator: string, incidentId: string) {
  const inc = db.incidents.find(i => i.id === incidentId);
  if (!inc) return;
  inc.timeline.push({
    id: crypto.randomUUID(), timestamp: new Date().toISOString(), source: operator, level: 'INFO',
    message: 'TEST incident opened by Test Automatic Incident Alert. No production monitor was failed.',
  });
  persist();
}

/** Runs the simulated failure through incident detection and the normal notification pipeline. */
export function runMockIncidentAlert(operator: string): Promise<MockIncidentReport> {
  if (inflight) return inflight.then(r => ({ ...r, duplicate: true }));
  inflight = execute(operator).finally(() => { inflight = null; });
  return inflight;
}

/** Closes the open TEST incident and resets the mock monitor. Does not send a recovery email. */
export function closeMockIncident(operator: string): { closed: boolean; incidentId: string | null } {
  const m = db.monitors.find(x => x.id === MOCK_INCIDENT_MONITOR_ID);
  const open = openMock();
  if (m && open) closeMonitorIncident(m, operator, 'TEST incident closed from Test Automatic Incident Alert');
  if (m) {
    m.status = 'UNKNOWN';
    m.consecutiveFailures = 0;
    m.consecutiveRecoveries = 0;
    m.enabled = false;
    m.lastProbeStatus = undefined;
    m.lastStatusCode = null;
    m.responseTimeMs = 0;
  }
  if (open || m) persist();
  return { closed: Boolean(open), incidentId: open?.id ?? null };
}

export function mockIncidentStatus() {
  const open = openMock();
  return {
    available: allowMockIncidentTest(),
    monitorId: MOCK_INCIDENT_MONITOR_ID,
    monitorName: MOCK_INCIDENT_MONITOR_NAME,
    openIncidentId: open?.id ?? null,
    enabledEmailChannels: db.channels.filter(c => c.enabled && c.type === 'EMAIL').length,
    smtpConfigured: Boolean((config.smtp.host || config.smtp.service) && config.smtp.from),
  };
}
