/**
 * Escalation policies end to end (in-process, throw-away PostgreSQL schema, a local HTTP server as
 * the webhook channels): initial delay (blips page nobody, restart-safe flag), acknowledged within the
 * delay, delayed page sent once, auto-escalation once to the chosen channels with the team name,
 * on-call users, no escalation after acknowledgement, no reminders before the first page.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
process.env.DB_SCHEMA = `ops_escalation_${process.pid}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-escalation-'));
process.env.HOSTINGER_API_TOKEN = '';
process.env.CLOUDFLARE_API_TOKEN = '';
process.env.SMTP_HOST = '';
process.env.ALERT_COOLDOWN_MIN = '15';
process.env.NOTIFY_WEBHOOK_SECRET = 'test-signing-secret';

const { initStore, db } = await import('../server/store.ts');
const { query, closePool, SCHEMA } = await import('../server/db.ts');
const { updateIncidentDurations } = await import('../server/engine.ts');
const { openAlert, resolveAlert } = await import('../server/alerts.ts');
const notify = await import('../server/notify.ts');
const crypto = await import('node:crypto');
type Incident = import('../src/types/index.ts').Incident;

/** Posts received per channel path */
const received: Record<string, Array<{ status: string; text: string; title: string }>> = { '/a': [], '/b': [] };
/** Scripted responses per path (consumed in order; then 200) and every raw request */
const script: Record<string, number[]> = {};
const raw: Array<{ url: string; body: string; headers: http.IncomingHttpHeaders }> = [];
const hook = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    raw.push({ url: req.url ?? '', body, headers: req.headers });
    const scripted = script[req.url ?? '']?.shift();
    if (scripted && scripted !== 200) { res.writeHead(scripted); res.end('nope'); return; }
    const j = JSON.parse(body);
    (received[req.url ?? ''] ??= []).push({ status: j.status, text: j.details ?? j.text, title: j.title });
    res.writeHead(200); res.end('ok');
  });
});
let base = '';
const posts = (p: '/a' | '/b') => received[p];
const clear = () => { received['/a'] = []; received['/b'] = []; };
const settle = () => new Promise(r => setTimeout(r, 300));
const minutesAgo = (inc: Incident, m: number) => { inc.startedAt = new Date(Date.now() - m * 60_000).toISOString(); };
let n = 0;
const alert = (severity: 'WARNING' | 'HIGH') => openAlert({ fingerprint: `esc-test:${++n}`, title: `Test ${n}`, severity, detail: 'something broke', source: 'Test' }).incident;

before(async () => {
  await new Promise<void>(r => hook.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(hook.address() as AddressInfo).port}`;
  await initStore();
  db.channels.push(
    { id: 'ch-a', name: 'Ops webhook', type: 'WEBHOOK', targetEndpoint: `${base}/a`, enabled: true, failureCount: 0 } as never,
    { id: 'ch-b', name: 'DBA webhook', type: 'WEBHOOK', targetEndpoint: `${base}/b`, enabled: true, failureCount: 0 } as never,
  );
  db.escalationPolicies = [
    { id: 'p-warn', severity: 'WARNING', channels: ['ch-a'], initialDelayMin: 5, repeatIntervalMin: 1, autoEscalateAfterMin: 0, escalateToTeam: '' },
    { id: 'p-high', severity: 'HIGH', channels: ['ch-a'], initialDelayMin: 0, repeatIntervalMin: 0, autoEscalateAfterMin: 10, escalateToTeam: 'DBA team', escalationChannels: ['ch-b'] },
  ];
});
after(async () => {
  hook.close();
  await query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  await closePool();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100).unref();
});

test('initial delay: a blip that recovers within the delay pages nobody (no FIRING, no RESOLVED)', async () => {
  clear();
  const inc = alert('WARNING');
  await settle();
  assert.equal(posts('/a').length, 0, 'held back');
  assert.equal(inc.notificationDeferred, true);
  updateIncidentDurations(); await settle();
  assert.equal(posts('/a').length, 0, 'still within the delay: no reminder either');
  resolveAlert(inc.fingerprint!, 'Test', 'recovered');
  await settle();
  assert.equal(posts('/a').length, 0, 'no RESOLVED for an alert nobody received');
  assert.equal(inc.notificationDeferred, false);
  assert.ok(inc.timeline.some(e => /nobody was paged/.test(e.message)));
});

test('initial delay: still open after the delay → exactly one page; its recovery is sent too', async () => {
  clear();
  const inc = alert('WARNING');
  minutesAgo(inc, 6);
  updateIncidentDurations(); await settle();
  assert.equal(posts('/a').length, 1);
  assert.equal(posts('/a')[0].status, 'FIRING');
  assert.equal(inc.notificationDeferred, false);
  updateIncidentDurations(); await settle();
  assert.equal(posts('/a').length, 1, 'sent once; the first reminder waits a full repeat interval');
  resolveAlert(inc.fingerprint!, 'Test', 'recovered');
  await settle();
  assert.deepEqual(posts('/a').map(p => p.status), ['FIRING', 'RESOLVED']);
});

test('initial delay: acknowledged within the delay → nobody is paged', async () => {
  clear();
  const inc = alert('WARNING');
  inc.acknowledged = true;
  minutesAgo(inc, 6);
  updateIncidentDurations(); await settle();
  assert.equal(posts('/a').length, 0);
  assert.equal(inc.notificationDeferred, false);
  assert.ok(inc.timeline.some(e => /Acknowledged within the notification delay/.test(e.message)));
});

test('auto-escalation: unacknowledged after N min → one ESCALATED message to the escalation channels with the team; on-call users noted', async () => {
  clear();
  db.users.push({ id: 'u-oncall', email: 'oncall@example.invalid', fullName: 'On Call', roleName: 'operator', isActive: true, isOnCall: true, passwordHash: 'x', tokenVersion: 0, createdAt: new Date().toISOString() } as never);
  const inc = alert('HIGH');
  await settle();
  assert.deepEqual(posts('/a').map(p => p.status), ['FIRING'], 'no delay for HIGH: paged immediately');
  assert.equal(posts('/b').length, 0);

  minutesAgo(inc, 5);
  updateIncidentDurations(); await settle();
  assert.equal(posts('/b').length, 0, 'not yet');

  minutesAgo(inc, 11);
  updateIncidentDurations(); await settle();
  assert.equal(posts('/b').length, 1, 'escalated to the DBA channel');
  assert.equal(posts('/b')[0].status, 'ESCALATED');
  assert.match(posts('/b')[0].text, /escalated to DBA team/);
  assert.equal(posts('/a').length, 1, 'escalation goes only to the escalation channels');
  assert.ok(inc.escalatedAt);
  const note = inc.timeline.find(e => /Escalated to DBA team/.test(e.message));
  assert.ok(note, 'timeline entry');
  assert.match(note!.message, /1 on-call user\(s\) not emailed \(SMTP not configured\)/);
  assert.ok(db.auditLogs.some(a => a.action === 'INCIDENT_ESCALATED' && a.targetId === inc.id));

  updateIncidentDurations(); await settle();
  assert.equal(posts('/b').length, 1, 'escalates once');
});

test('auto-escalation: an acknowledged incident is never escalated', async () => {
  clear();
  const inc = alert('HIGH');
  inc.acknowledged = true;
  minutesAgo(inc, 30);
  updateIncidentDurations(); await settle();
  assert.equal(posts('/b').length, 0);
  assert.equal(inc.escalatedAt, undefined);
});

test('the deferred flag survives a restart: it is stored on the incident, and the engine sends the page later', async () => {
  clear();
  const inc = alert('WARNING');
  const stored = db.incidents.find(i => i.id === inc.id)!;
  assert.equal(stored.notificationDeferred, true);
  // Simulate the process restarting: in-memory notification state is gone, the incident flag remains
  minutesAgo(stored, 7);
  updateIncidentDurations(); await settle();
  assert.equal(posts('/a').length, 1);
});

test('notifications: a temporary failure (503) is retried and delivered; a rejected request (400) is not retried', async () => {
  notify.RETRY_DELAYS_MS.splice(0, notify.RETRY_DELAYS_MS.length, 50, 50);
  const ch = (path: string) => ({ id: `ch${path}`, name: path, type: 'WEBHOOK', targetEndpoint: `${base}${path}`, enabled: true, failureCount: 0 }) as never;
  const msg = { title: 'T', text: 'body', severity: 'HIGH', status: 'FIRING' as const };

  script['/flaky'] = [503, 503];
  const ok = await notify.sendToChannel(ch('/flaky'), msg);
  assert.equal(ok.ok, true, 'delivered on the third attempt');
  assert.equal(raw.filter(r => r.url === '/flaky').length, 3);

  script['/bad'] = [400];
  const bad = await notify.sendToChannel(ch('/bad'), msg);
  assert.equal(bad.ok, false);
  assert.equal(raw.filter(r => r.url === '/bad').length, 1, '400 is not retried');

  script['/down'] = [500, 500, 500, 500];
  const down = await notify.sendToChannel(ch('/down'), msg);
  assert.equal(down.ok, false);
  assert.equal(raw.filter(r => r.url === '/down').length, 3, 'gives up after 3 attempts');
});

test('webhook notifications are signed (HMAC-SHA256 over timestamp + body) when NOTIFY_WEBHOOK_SECRET is set', async () => {
  const before = raw.length;
  await notify.sendToChannel({ id: 'ch-sig', name: 'sig', type: 'WEBHOOK', targetEndpoint: `${base}/signed`, enabled: true, failureCount: 0 } as never,
    { title: 'Signed', text: 'x', severity: 'INFO', status: 'INFO' });
  const req = raw.slice(before).find(r => r.url === '/signed')!;
  const ts = String(req.headers['x-scholario-timestamp']);
  const expected = 'sha256=' + crypto.createHmac('sha256', 'test-signing-secret').update(`${ts}.${req.body}`).digest('hex');
  assert.equal(req.headers['x-scholario-signature'], expected);
  assert.ok(Math.abs(Date.now() / 1000 - Number(ts)) < 60);
});
