/** The automatic incident email explains the application, the layer, and the reason. No mail is sent. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { incidentNotification, groupedNotification } from '../server/incidentMail.ts';
import { mailSubject, safeMailLink } from '../src/lib/incidentMail.ts';
import type { Incident } from '../src/types/index.ts';

const base = (over: Partial<Incident> = {}): Incident => ({
  id: 'INC-9', title: 'API <down>', severity: 'CRITICAL', status: 'OPEN', applicationId: 'app',
  environment: 'PRD', fingerprint: 'monitor:m1', rootCause: 'HTTP 503 Service Unavailable',
  startedAt: '2026-10-17T06:00:00.000Z', durationMinutes: 0, owner: 'Unassigned', acknowledged: false,
  affectedServices: ['Scholario API'], affectedMonitors: [], dependentFailures: [], timeline: [],
  recoveryStatus: '', notes: [],
  context: {
    application: 'Scholario API', environment: 'PRD', vps: 'prd-1', ip: '203.0.113.10',
    monitor: 'API health', target: 'https://app.example/health', firstDetectedAt: '2026-10-17T06:00:00.000Z',
    latestDetectedAt: '2026-10-17T06:00:00.000Z', failureReason: 'HTTP 503 Service Unavailable',
    probeStatus: 'DOWN', responseCode: 503, latencyMs: 40, cloudflare: null,
  },
  ...over,
});

test('a failure email names the application, the server, and why it failed', () => {
  const msg = incidentNotification(base(), 'FIRING', {}, undefined, 'https://ops.example/incidents?id=INC-9');
  assert.match(msg.html ?? '', /Application/);
  assert.match(msg.html ?? '', /Scholario API/);
  assert.match(msg.html ?? '', /prd-1 \(203\.0\.113\.10\)/);
  assert.match(msg.html ?? '', /HTTP 503/);
  assert.match(msg.html ?? '', /DOWN/);
  assert.match(msg.html ?? '', /What we saw/);
  assert.match(msg.text, /What happened/);
  assert.match(msg.html ?? '', /Why this matters/);
  assert.ok(msg.html?.includes('API &lt;down&gt;'), 'the title is escaped');
  assert.match(msg.html ?? '', /17 Oct 2026, 06:00 UTC/);
  assert.match(msg.text, /Layer: Application/);
  assert.match(msg.text, /https:\/\/ops\.example\/incidents\?id=INC-9/);
  assert.equal(mailSubject(msg), '[CRITICAL] INC-9 API <down>');
});

test('a database warning says it is a warning on the database', () => {
  const msg = incidentNotification(base({
    title: 'Scholario API PRD database unavailable', severity: 'WARNING', fingerprint: 'db-down:app:PRD',
    rootCause: 'mysql unavailable: connection refused', context: undefined, affectedServices: ['Scholario API'],
  }), 'FIRING', { application: 'Scholario API', server: 'db-1', ip: '203.0.113.20', database: 'mysql scholario port 3306' });
  assert.match(msg.html ?? '', /WARNING/);
  assert.match(msg.html ?? '', /Database/);
  assert.match(msg.html ?? '', /mysql scholario port 3306/);
  assert.match(msg.html ?? '', /db-1 \(203\.0\.113\.20\)/);
  assert.match(msg.text, /connection refused/);
  assert.match(msg.text, /warning, not a confirmed outage/);
  assert.equal(mailSubject(msg), '[WARNING] INC-9 Scholario API PRD database unavailable');
});

test('a recovered email says no action is required', () => {
  const msg = incidentNotification(base({ status: 'RESOLVED', resolvedAt: '2026-10-17T06:10:00.000Z' }), 'RESOLVED');
  assert.match(msg.html ?? '', /RECOVERED/);
  assert.match(msg.text, /No action is required/);
  assert.equal(mailSubject(msg), '[RECOVERED] INC-9 API <down>');
});

test('several warnings for one application are one HTML page and stay identifiable after a restart', () => {
  const a = base({ id: 'INC-1', title: 'Slow health', severity: 'WARNING', fingerprint: 'monitor-warn:m1' });
  const b = base({ id: 'INC-2', title: 'Backup is stale', severity: 'WARNING', fingerprint: 'backup:app', context: undefined, rootCause: 'last copy is 3 days old' });
  const msg = groupedNotification([a, b], 60, () => ({ application: 'Scholario API', server: 'prd-1', ip: '203.0.113.10' }));
  assert.match(msg.html ?? '', /Also in this email/);
  assert.match(msg.html ?? '', /Backup is stale/);
  assert.match(msg.text, /• INC-2 \[WARNING\]/);
  assert.match(msg.text, /Scholario API/);
});

test('a link that is not http or https is not placed in the email', () => {
  assert.equal(safeMailLink('javascript:alert(1)'), undefined);
  const msg = incidentNotification(base(), 'FIRING', {}, undefined, 'javascript:alert(1)');
  assert.equal(msg.html?.includes('javascript:'), false);
});

test('a short message without a page keeps the status word in the subject', () => {
  assert.equal(mailSubject({ title: 'INC-77 API <down>', status: 'FIRING', severity: 'CRITICAL' }), '[FIRING] INC-77 API <down>');
});
