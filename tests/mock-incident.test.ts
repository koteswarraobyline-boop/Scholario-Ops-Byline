/**
 * Test Automatic Incident Alert: a simulated HTTP 503 goes through incident detection and the
 * normal email pipeline. SMTP is a local fake server. Nothing here contacts a real mail host.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import dotenv from 'dotenv';
import { pinTestDatabaseUrl, assertConnectedToTestDatabase, dropVerifiedTestSchema } from './helpers/test-db-guard.ts';
import { MOCK_INCIDENT_FINGERPRINT, MOCK_INCIDENT_MONITOR_ID } from '../src/lib/mockIncident.ts';
import type { Monitor } from '../src/types/index.ts';

pinTestDatabaseUrl();
dotenv.config({ quiet: true });

const mails: Array<{ to: string[]; data: string }> = [];
const smtp = net.createServer(sock => {
  let state: 'cmd' | 'data' | 'auth-user' | 'auth-pass' = 'cmd';
  let buf = '';
  let cur = { to: [] as string[], data: '' };
  const say = (s: string) => sock.write(`${s}\r\n`);
  say('220 fake.smtp.test ESMTP');
  sock.on('data', chunk => {
    buf += chunk.toString('utf8');
    let i: number;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (state === 'data') {
        if (line === '.') { mails.push(cur); cur = { to: [], data: '' }; state = 'cmd'; say('250 2.0.0 queued'); }
        else cur.data += `${line}\n`;
        continue;
      }
      if (state === 'auth-user') { state = 'auth-pass'; say('334 UGFzc3dvcmQ6'); continue; }
      if (state === 'auth-pass') { state = 'cmd'; say('235 2.7.0 Authentication successful'); continue; }
      const cmd = line.toUpperCase();
      if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) sock.write('250-fake.smtp.test\r\n250-AUTH LOGIN\r\n250 8BITMIME\r\n');
      else if (cmd.startsWith('AUTH LOGIN')) { state = 'auth-user'; say('334 VXNlcm5hbWU6'); }
      else if (cmd.startsWith('MAIL FROM')) say('250 2.1.0 ok');
      else if (cmd.startsWith('RCPT TO')) { cur.to.push(line.slice(8).replace(/[<>]/g, '').split(' ')[0]); say('250 2.1.5 ok'); }
      else if (cmd === 'DATA') { state = 'data'; say('354 go ahead'); }
      else if (cmd === 'QUIT') { say('221 bye'); sock.end(); }
      else say('250 ok');
    }
  });
  sock.on('error', () => {});
});
await new Promise<void>(r => smtp.listen(0, '127.0.0.1', () => r()));
const port = (smtp.address() as AddressInfo).port;

process.env.DB_SCHEMA = `ops_mockinc_${process.pid}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-mockinc-'));
process.env.ALLOW_MOCK_INCIDENT_TEST = '1';
process.env.HOSTINGER_API_TOKEN = '';
process.env.CLOUDFLARE_API_TOKEN = '';
process.env.SMTP_SERVICE = '';
process.env.SMTP_URL = `smtp://alerts%40example.test:right-pass@127.0.0.1:${port}`;
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.SMTP_FROM = '';
process.env.SMTP_REQUIRE_TLS = 'false';
process.env.NOTIFY_ALLOWED_PRIVATE_TARGETS = '127.0.0.1';

const { initStore, db, flush } = await import('../server/store.ts');
const { query, closePool, SCHEMA } = await import('../server/db.ts');
const { config } = await import('../server/config.ts');
const notify = await import('../server/notify.ts');
const { allowMockIncidentTest, runMockIncidentAlert, closeMockIncident } = await import('../server/mockIncident.ts');
notify.RETRY_DELAYS_MS.splice(0, notify.RETRY_DELAYS_MS.length, 30, 30);

const stage = (id: string, report: { stages: Array<{ id: string; status: string; detail: string }> }) => {
  const s = report.stages.find(x => x.id === id);
  assert.ok(s, id);
  return s!;
};

const realMonitor = (): Monitor => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', name: 'Production API', type: 'HTTP', target: 'https://app.example/health', applicationId: '',
  environment: 'PRD', intervalSec: 60, timeoutSec: 5, retries: 1, warningThresholdMs: 0, criticalThresholdMs: 0,
  failureConfirmationThreshold: 3, recoveryConfirmationThreshold: 1, consecutiveFailures: 0, consecutiveRecoveries: 0,
  status: 'HEALTHY', lastCheck: new Date().toISOString(), lastSuccess: new Date().toISOString(), responseTimeMs: 20,
  uptimePercent: 100, history: [], enabled: true, activeMaintenance: false, lastProbeStatus: 'UP', lastStatusCode: 200,
});

let verified = false;
before(async () => {
  await assertConnectedToTestDatabase({ query: sql => query(sql) });
  verified = true;
  await initStore();
  db.channels.push({
    id: 'ch-test-mail', name: 'Ops mail', type: 'EMAIL', targetEndpoint: 'oncall@example.test',
    enabled: true, failureCount: 0, lastDeliveryAt: '', lastDeliveryStatus: 'PENDING',
  });
  db.monitors.push(realMonitor());
});
after(async () => {
  smtp.close();
  await dropVerifiedTestSchema(verified, () => query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {}));
  await closePool();
});

test('the test is refused when NODE_ENV is production', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { assert.equal(allowMockIncidentTest(), false); }
  finally { if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev; }
  assert.equal(allowMockIncidentTest(), true);
});

test('a simulated 503 opens a TEST incident and the Email channel records SMTP acceptance', async () => {
  mails.length = 0;
  const real = db.monitors.find(m => m.id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')!;
  const report = await runMockIncidentAlert('tester');
  assert.equal(report.duplicate, false);
  assert.match(report.incidentId ?? '', /^INC-/);
  assert.equal(JSON.stringify(report).includes('right-pass'), false, 'the SMTP password is not in the report');

  const inc = db.incidents.find(i => i.id === report.incidentId)!;
  assert.equal(inc.fingerprint, MOCK_INCIDENT_FINGERPRINT);
  assert.match(inc.title, /TEST/);
  assert.match(inc.rootCause, /503/);
  assert.equal(inc.context?.responseCode, 503);
  assert.equal(inc.status, 'OPEN');

  assert.equal(stage('mock_failure', report).status, 'PASS');
  assert.equal(stage('incident_created', report).status, 'PASS');
  assert.equal(stage('rule_matched', report).status, 'PASS');
  assert.equal(stage('email_queued', report).status, 'PASS');
  assert.equal(stage('smtp_attempted', report).status, 'PASS');
  assert.equal(stage('smtp_result', report).status, 'PASS');
  assert.match(stage('smtp_result', report).detail, /not confirmation that it reached an inbox/);
  assert.equal(stage('inbox_confirmed', report).status, 'NOT_VERIFIED');
  assert.equal(stage('final_status', report).status, 'PASS');

  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to, ['oncall@example.test']);
  assert.match(mails[0].data, /\[FIRING\]/);
  assert.match(mails[0].data, /503/);
  assert.match(mails[0].data, new RegExp(report.incidentId!));

  const mock = db.monitors.find(m => m.id === MOCK_INCIDENT_MONITOR_ID)!;
  assert.equal(mock.enabled, false);
  assert.equal(mock.target, 'http://mock.test.invalid/health');
  assert.equal(real.status, 'HEALTHY');
  assert.equal(real.lastProbeStatus, 'UP');
  assert.equal(real.lastStatusCode, 200);
  assert.equal(real.consecutiveFailures, 0);
  assert.equal(await flush(), true, 'the TEST monitor must save; a rejected row blocks every later save');
});

test('a second request while the TEST incident is open does not send another email', async () => {
  const before = mails.length;
  const first = db.incidents.find(i => i.fingerprint === MOCK_INCIDENT_FINGERPRINT && i.status === 'OPEN')!;
  const again = await runMockIncidentAlert('tester');
  assert.equal(again.duplicate, true);
  assert.equal(again.incidentId, first.id);
  assert.equal(mails.length, before);
  assert.match(stage('email_queued', again).detail, /did not queue another email/);
  assert.equal(stage('inbox_confirmed', again).status, 'NOT_VERIFIED');
});

test('a disabled Email channel does not send', async () => {
  closeMockIncident('tester');
  notify.forgetNotificationMemoryForTests();
  const ch = db.channels.find(c => c.id === 'ch-test-mail')!;
  ch.enabled = false;
  const before = mails.length;
  const report = await runMockIncidentAlert('tester');
  assert.equal(mails.length, before);
  assert.equal(stage('incident_created', report).status, 'PASS');
  assert.equal(stage('email_queued', report).status, 'FAIL');
  assert.match(stage('email_queued', report).detail, /No enabled Email channel/);
  ch.enabled = true;
});

test('an SMTP failure is recorded and retried by the existing policy', async () => {
  closeMockIncident('tester');
  notify.forgetNotificationMemoryForTests();
  const saved = config.smtp.port;
  config.smtp.port = 1;
  mails.length = 0;
  try {
    const report = await runMockIncidentAlert('tester');
    assert.equal(mails.length, 0);
    assert.equal(stage('incident_created', report).status, 'PASS');
    assert.equal(stage('smtp_attempted', report).status, 'PASS');
    assert.equal(stage('smtp_result', report).status, 'FAIL');
    assert.match(stage('smtp_result', report).detail, /3 attempt/);
    assert.equal(stage('inbox_confirmed', report).status, 'NOT_VERIFIED');
    assert.equal(stage('final_status', report).status, 'FAIL');
    assert.equal(JSON.stringify(report).includes('right-pass'), false);
  } finally {
    config.smtp.port = saved;
  }
});
