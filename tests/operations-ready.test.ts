/**
 * Operator checks, hourly SLA buckets, maintenance windows, runbooks, and CI backup reports.
 * Sample data on a throw-away schema. Nothing here deploys, fails over, or runs a backup.
 *   npm run test:local -- tests/operations-ready.test.ts
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { pinTestDatabaseUrl, assertConnectedToTestDatabase, dropVerifiedTestSchema } from './helpers/test-db-guard.ts';

const DATABASE_URL = pinTestDatabaseUrl();
const SCHEMA = `ops_ready_${process.pid}`;
const PORT = 4860 + (process.pid % 40);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'ready-admin@example.com', password: 'ReadyTestPassw0rd!' };
const VIEWER = { email: 'ready-viewer@example.com', password: 'ViewerPassw0rd!' };
const OPERATOR = { email: 'ready-operator@example.com', password: 'OperatorPassw0rd!' };
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-ready-'));

let server: ChildProcess | null = null;
let logs = '';
let token = '';
let viewerToken = '';
let operatorToken = '';
let sample: http.Server | null = null;
let sampleBase = '';
const pgc = new pg.Client({ connectionString: DATABASE_URL });

async function api(method: string, p: string, body?: unknown, bearer = token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null, raw };
}

const one = async (sql: string, params: unknown[] = []) => (await pgc.query(sql, params)).rows[0];

let ipSeq = 20;
const nextIp = () => `192.0.2.${ipSeq++}`;

async function appPair(codeName: string) {
  const prd = await api('POST', '/api/v1/servers', { hostname: `${codeName}-prd`, ip: nextIp(), environment: 'PRD' });
  const dr = await api('POST', '/api/v1/servers', { hostname: `${codeName}-dr`, ip: nextIp(), environment: 'DR' });
  assert.equal(prd.status, 201, prd.raw);
  assert.equal(dr.status, 201, dr.raw);
  const app = await api('POST', '/api/v1/applications', {
    name: codeName, codeName, tier: 'TIER_2', prdServerId: prd.body.data.id, drServerId: dr.body.data.id,
  });
  assert.equal(app.status, 201, app.raw);
  return { appId: app.body.data.id as string, prdId: prd.body.data.id as string };
}

function monitorBody(name: string, appId: string, target: string, environment: 'PRD' | 'DR', enabled: boolean) {
  return {
    name, type: 'HTTP', target, applicationId: appId, environment, intervalSec: 600, timeoutSec: 5, retries: 1,
    failureConfirmationThreshold: 1, recoveryConfirmationThreshold: 1, enabled,
  };
}

let verified = false;
before(async () => {
  await pgc.connect();
  await assertConnectedToTestDatabase(pgc);
  verified = true;
  sample = http.createServer((req, res) => {
    if (req.url === '/down') { res.statusCode = 500; res.end('down'); return; }
    res.statusCode = 200; res.end('ok-sample');
  });
  await new Promise<void>(resolve => sample!.listen(0, '127.0.0.1', () => resolve()));
  sampleBase = `http://127.0.0.1:${(sample.address() as { port: number }).port}`;
  server = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: {
      ...process.env, DATABASE_URL, PORT: String(PORT), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR,
      NODE_ENV: 'production', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password,
      JWT_SECRET: 'operations-ready-jwt-secret-0123456789',
      DEPLOY_REPORT_TOKEN: 'operations-ready-deploy-token',
      PUBLIC_URL: 'https://ops.test.invalid',
      WORKER_EVENTS_TOKEN: 'operations-ready-worker-token',
      CLOUDFLARE_API_TOKEN: '', HOSTINGER_API_TOKEN: '', DEADMAN_HEARTBEAT_URL: '',
      SMTP_SERVICE: '', SMTP_URL: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', d => { logs += d; });
  server.stderr?.on('data', d => { logs += d; });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ }
    if (i === 59) throw new Error(`server did not start:\n${logs.slice(-2000)}`);
    await new Promise(r => setTimeout(r, 500));
  }
  const login = await api('POST', '/api/auth/login', ADMIN, '');
  assert.equal(login.status, 200, login.raw);
  token = login.body.data.tokens.accessToken;
  for (const user of [
    { ...VIEWER, fullName: 'Viewer', roleName: 'viewer' },
    { ...OPERATOR, fullName: 'Operator', roleName: 'operator' },
  ]) {
    const created = await api('POST', '/api/v1/users', user);
    assert.equal(created.status, 201, created.raw);
  }
  viewerToken = (await api('POST', '/api/auth/login', VIEWER, '')).body.data.tokens.accessToken;
  operatorToken = (await api('POST', '/api/auth/login', OPERATOR, '')).body.data.tokens.accessToken;
});

after(async () => {
  sample?.close();
  if (server) {
    const child = server;
    server = null;
    await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGTERM'); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 8000); });
  }
  await dropVerifiedTestSchema(verified, () => pgc.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {}));
  await pgc.end().catch(() => {});
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

describe('operator checks, SLA buckets, maintenance, runbooks, and backup reports', { concurrency: 1 }, () => {
  test('operators can run HTTP, TCP, DNS and SSL checks; metadata addresses are refused; nothing is stored', async () => {
    assert.equal((await api('POST', '/api/v1/tools/http', { url: `${sampleBase}/diag` }, '')).status, 401);
    assert.equal((await api('POST', '/api/v1/tools/http', { url: `${sampleBase}/diag` }, viewerToken)).status, 403);

    const httpOk = await api('POST', '/api/v1/tools/http', { url: `${sampleBase}/diag`, expectedStatus: 200, matchText: 'ok-sample' });
    assert.equal(httpOk.status, 200, httpOk.raw);
    assert.equal(httpOk.body.data.reachable, true);
    assert.equal(httpOk.body.data.statusCode, 200);
    assert.equal(httpOk.body.data.probeStatus, 'UP');
    assert.equal(httpOk.body.data.expectedMatch, true);
    assert.equal(typeof httpOk.body.data.latencyMs, 'number');

    const tcp = await api('POST', '/api/v1/tools/tcp', { host: '127.0.0.1', port: new URL(sampleBase).port });
    assert.equal(tcp.status, 200, tcp.raw);
    assert.equal(tcp.body.data.open, true);
    assert.equal(tcp.body.data.port, Number(new URL(sampleBase).port));

    const dnsOk = await api('POST', '/api/v1/tools/dns', { host: 'localhost' });
    assert.equal(dnsOk.status, 200, dnsOk.raw);
    assert.equal(dnsOk.body.data.ok, true);
    assert.match(dnsOk.body.data.detail, /Resolved localhost/);

    for (const call of [
      api('POST', '/api/v1/tools/http', { url: 'http://169.254.169.254/latest/meta-data' }),
      api('POST', '/api/v1/tools/tcp', { host: '169.254.169.254', port: 80 }),
      api('POST', '/api/v1/tools/ssl', { host: '169.254.169.254' }),
      api('POST', '/api/v1/tools/dns', { host: 'metadata.google.internal' }),
    ]) {
      const refused = await call;
      assert.equal(refused.status, 400, refused.raw);
      assert.match(refused.body.message, /metadata/);
    }
    assert.equal((await api('POST', '/api/v1/tools/tcp', { host: 'not a host', port: 80 })).status, 400);
    assert.equal((await api('POST', '/api/v1/tools/tcp', { host: '127.0.0.1' })).status, 400);

    const stored = await one(`select count(*)::int n from ${SCHEMA}.check_results where target like $1`, ['%/diag%']);
    assert.equal(stored.n, 0, 'an operator check is not written as monitor history');

    let openssl = 'openssl';
    try { execFileSync(openssl, ['version'], { stdio: 'ignore' }); } catch {
      const gitOpenssl = 'C:/Program Files/Git/usr/bin/openssl.exe';
      if (!fs.existsSync(gitOpenssl)) {
        const plain = await api('POST', '/api/v1/tools/ssl', { host: `127.0.0.1:${new URL(sampleBase).port}` });
        assert.equal(plain.status, 200, plain.raw);
        assert.equal(plain.body.data.ok, false);
        assert.equal(typeof plain.body.data.detail, 'string');
        return;
      }
      openssl = gitOpenssl;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-ssl-'));
    const tlsServer = https.createServer({
      key: (() => {
        execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=localhost'], { stdio: 'ignore' });
        return fs.readFileSync(path.join(dir, 'k.pem'));
      })(),
      cert: fs.readFileSync(path.join(dir, 'c.pem')),
    }, (_q, r) => r.end('tls'));
    await new Promise<void>(resolve => tlsServer.listen(0, '127.0.0.1', () => resolve()));
    try {
      const port = (tlsServer.address() as { port: number }).port;
      const ssl = await api('POST', '/api/v1/tools/ssl', { host: `127.0.0.1:${port}` });
      assert.equal(ssl.status, 200, ssl.raw);
      assert.equal(ssl.body.data.ok, false);
      assert.match(ssl.body.data.detail, /NOT trusted/);
      assert.equal(typeof ssl.body.data.daysLeft, 'number');
      assert.ok(ssl.body.data.daysLeft <= 2);
    } finally {
      tlsServer.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('each monitor keeps an hourly uptime and latency bucket, and the application uptime uses it', async () => {
    const { appId } = await appPair('sla-sample');
    const up = await api('POST', '/api/v1/monitors', monitorBody('SLA up', appId, `${sampleBase}/ok`, 'PRD', true));
    assert.equal(up.status, 201, up.raw);
    const upId = up.body.data.id as string;
    const probed = await api('POST', `/api/v1/monitors/${upId}/probe`);
    assert.equal(probed.status, 200, probed.raw);
    assert.equal(probed.body.data.lastProbeStatus, 'UP');
    const bucket = await one(`select total, ok, lat_sum from ${SCHEMA}.monitor_buckets where monitor_id = $1`, [upId]);
    assert.ok(bucket, 'the hour bucket was saved');
    assert.equal(bucket.ok, bucket.total);
    assert.ok(bucket.total >= 1);
    assert.equal(Number(bucket.lat_sum) >= 0, true);

    const down = await api('POST', '/api/v1/monitors', monitorBody('SLA down', appId, `${sampleBase}/down`, 'DR', true));
    const downId = down.body.data.id as string;
    const failed = await api('POST', `/api/v1/monitors/${downId}/probe`);
    assert.equal(failed.body.data.lastProbeStatus, 'DOWN');
    const failedBucket = await one(`select total, ok, lat_sum from ${SCHEMA}.monitor_buckets where monitor_id = $1`, [downId]);
    assert.equal(failedBucket.ok, 0);
    assert.ok(failedBucket.total >= 1);
    assert.equal(Number(failedBucket.lat_sum), 0);

    const app = await api('GET', `/api/v1/applications/${appId}`);
    assert.equal(app.body.data.uptime24h, 100, 'DR failures are not the serving environment');
    const availability = await api('GET', `/api/v1/applications/${appId}/availability?range=24h`);
    assert.equal(availability.status, 200, availability.raw);
    const prd = availability.body.data.environments.find((e: { environment: string }) => e.environment === 'PRD');
    const dr = availability.body.data.environments.find((e: { environment: string }) => e.environment === 'DR');
    assert.equal(prd.monitoring.availabilityPercent, 100);
    assert.equal(typeof prd.monitoring.avgLatencyMs, 'number');
    assert.equal(dr.monitoring.availabilityPercent, 0);
  });

  test('a maintenance window can be created, completed and deleted, and alerts stay paused only for its scope', async () => {
    const { appId } = await appPair('maint-sample');
    const inside = await api('POST', '/api/v1/monitors', monitorBody('Inside window', appId, `${sampleBase}/down`, 'PRD', false));
    const outside = await api('POST', '/api/v1/monitors', monitorBody('Outside window', appId, `${sampleBase}/down`, 'PRD', false));
    assert.equal(inside.status, 201, inside.raw);
    const insideId = inside.body.data.id as string;
    const outsideId = outside.body.data.id as string;
    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date(Date.now() + 3600_000).toISOString();
    assert.equal((await api('POST', '/api/v1/maintenance', { title: 'nope', applicationId: appId, environment: 'PRD', startTime: start, endTime: end }, viewerToken)).status, 403);
    const created = await api('POST', '/api/v1/maintenance', {
      title: 'Patch window', applicationId: appId, environment: 'PRD', startTime: start, endTime: end, reason: 'sample patch', suppressMonitors: [insideId],
    }, operatorToken);
    assert.equal(created.status, 201, created.raw);
    assert.equal(created.body.data.status, 'IN_PROGRESS');
    const windowId = created.body.data.id as string;

    assert.equal((await api('POST', `/api/v1/monitors/${insideId}/toggle`)).status, 200);
    assert.equal((await api('POST', `/api/v1/monitors/${outsideId}/toggle`)).status, 200);
    const paused = await api('POST', `/api/v1/monitors/${insideId}/probe`);
    const paging = await api('POST', `/api/v1/monitors/${outsideId}/probe`);
    assert.equal(paused.body.data.status, 'MAINTENANCE', paused.raw);
    assert.equal(paused.body.data.activeMaintenance, true);
    assert.equal(paging.body.data.status, 'CRITICAL', paging.raw);
    const incidents = async (id: string) => (await api('GET', '/api/v1/incidents')).body.data.filter((i: { fingerprint: string }) => i.fingerprint === `monitor:${id}`);
    assert.equal((await incidents(insideId)).length, 0, 'the monitor inside the window is not paged');
    assert.equal((await incidents(outsideId)).length, 1, 'a monitor outside the window is still paged');
    assert.equal((await one(`select count(*)::int n from ${SCHEMA}.monitor_buckets where monitor_id = $1`, [insideId])).n, 0, 'maintenance does not count against the SLA');
    assert.ok((await one(`select total from ${SCHEMA}.monitor_buckets where monitor_id = $1`, [outsideId])).total >= 1);

    assert.equal((await api('DELETE', `/api/v1/maintenance/${windowId}`, undefined, operatorToken)).status, 403);
    const completed = await api('POST', `/api/v1/maintenance/${windowId}/complete`, {}, operatorToken);
    assert.equal(completed.status, 200, completed.raw);
    assert.equal(completed.body.data.status, 'COMPLETED');
    const resumed = await api('POST', `/api/v1/monitors/${insideId}/probe`);
    assert.equal(resumed.body.data.status, 'CRITICAL');
    assert.equal((await incidents(insideId)).length, 1, 'alerts resume when the window is completed');

    const future = await api('POST', '/api/v1/maintenance', {
      title: 'Later window', applicationId: appId, environment: 'PRD',
      startTime: new Date(Date.now() + 3600_000).toISOString(), endTime: new Date(Date.now() + 7200_000).toISOString(),
      suppressMonitors: [outsideId],
    });
    assert.equal(future.body.data.status, 'SCHEDULED');
    const removed = await api('DELETE', `/api/v1/maintenance/${future.body.data.id}`);
    assert.equal(removed.status, 200, removed.raw);
    const listed = await api('GET', '/api/v1/maintenance');
    assert.equal(listed.body.data.some((w: { id: string }) => w.id === future.body.data.id), false);
    assert.equal(listed.body.data.some((w: { id: string }) => w.id === windowId), true, 'a completed window stays on record until it is deleted');

    const wideApp = await appPair('maint-wide');
    const widePrd = await api('POST', '/api/v1/monitors', monitorBody('Whole PRD', wideApp.appId, `${sampleBase}/down`, 'PRD', false));
    const wideDr = await api('POST', '/api/v1/monitors', monitorBody('DR stays live', wideApp.appId, `${sampleBase}/down`, 'DR', false));
    const wide = await api('POST', '/api/v1/maintenance', {
      title: 'Application window', applicationId: wideApp.appId, environment: 'PRD',
      startTime: start, endTime: end, suppressMonitors: [],
    });
    assert.equal(wide.status, 201, wide.raw);
    assert.equal((await api('POST', `/api/v1/monitors/${widePrd.body.data.id}/toggle`)).status, 200);
    assert.equal((await api('POST', `/api/v1/monitors/${wideDr.body.data.id}/toggle`)).status, 200);
    const held = await api('POST', `/api/v1/monitors/${widePrd.body.data.id}/probe`);
    const otherEnv = await api('POST', `/api/v1/monitors/${wideDr.body.data.id}/probe`);
    assert.equal(held.body.data.status, 'MAINTENANCE', held.raw);
    assert.equal(otherEnv.body.data.status, 'CRITICAL', otherEnv.raw);
    assert.equal((await incidents(widePrd.body.data.id)).length, 0, 'an empty monitor list pauses the whole application environment');
    assert.equal((await incidents(wideDr.body.data.id)).length, 1, 'the other environment is outside that scope');
  });

  test('an operator can acknowledge, assign, change severity and status, add a note, and resolve, and the timeline records each step', async () => {
    const { appId } = await appPair('incident-sample');
    const mon = await api('POST', '/api/v1/monitors', monitorBody('Sample outage', appId, `${sampleBase}/down`, 'PRD', true));
    assert.equal(mon.status, 201, mon.raw);
    const probed = await api('POST', `/api/v1/monitors/${mon.body.data.id}/probe`);
    assert.equal(probed.body.data.status, 'CRITICAL', probed.raw);
    const opened = (await api('GET', '/api/v1/incidents')).body.data.find((i: { fingerprint: string }) => i.fingerprint === `monitor:${mon.body.data.id}`);
    assert.ok(opened, 'the failing sample opens an incident');
    assert.equal(opened.acknowledged, false);
    assert.equal(opened.status, 'OPEN');
    const id = opened.id as string;
    const messages = (row: { timeline: Array<{ message: string }> }) => row.timeline.map(e => e.message);

    assert.equal((await api('POST', `/api/v1/incidents/${id}/acknowledge`, {}, viewerToken)).status, 403);
    const acked = await api('POST', `/api/v1/incidents/${id}/acknowledge`, {}, operatorToken);
    assert.equal(acked.status, 200, acked.raw);
    assert.equal(acked.body.data.acknowledged, true);
    assert.equal(acked.body.data.status, 'ACKNOWLEDGED');
    assert.match(messages(acked.body.data).at(-1) ?? '', /^Acknowledged by /);

    const assigned = await api('PATCH', `/api/v1/incidents/${id}/assign`, { owner: 'Sample Owner' }, operatorToken);
    assert.equal(assigned.status, 200, assigned.raw);
    assert.equal(assigned.body.data.owner, 'Sample Owner');
    assert.equal(messages(assigned.body.data).at(-1), 'Assigned to Sample Owner');

    const severity = await api('PATCH', `/api/v1/incidents/${id}/severity`, { severity: 'CRITICAL' }, operatorToken);
    assert.equal(severity.status, 200, severity.raw);
    assert.equal(severity.body.data.severity, 'CRITICAL');
    assert.match(messages(severity.body.data).at(-1) ?? '', /^Severity changed .+ → CRITICAL$/);

    const status = await api('PATCH', `/api/v1/incidents/${id}/status`, { status: 'INVESTIGATING' }, operatorToken);
    assert.equal(status.status, 200, status.raw);
    assert.equal(status.body.data.status, 'INVESTIGATING');
    assert.equal(messages(status.body.data).at(-1), 'Status changed to INVESTIGATING');

    const noted = await api('POST', `/api/v1/incidents/${id}/notes`, { content: 'Sample note: database was restarted' }, operatorToken);
    assert.equal(noted.status, 200, noted.raw);
    assert.equal(noted.body.data.notes.at(-1).content, 'Sample note: database was restarted');
    assert.equal(messages(noted.body.data).at(-1), 'Note added: Sample note: database was restarted');
    const longNote = `Full timeline note ${'x'.repeat(100)}`;
    const long = await api('POST', `/api/v1/incidents/${id}/notes`, { content: longNote }, operatorToken);
    assert.equal(long.status, 200, long.raw);
    assert.equal(messages(long.body.data).at(-1), `Note added: ${longNote}`);

    const resolved = await api('POST', `/api/v1/incidents/${id}/resolve`, { resolution: 'Sample service answered again' }, operatorToken);
    assert.equal(resolved.status, 200, resolved.raw);
    assert.equal(resolved.body.data.status, 'RESOLVED');
    assert.equal(resolved.body.data.recoveryStatus, 'Sample service answered again');
    assert.equal(messages(resolved.body.data).at(-1), 'Resolved: Sample service answered again');

    const saved = await api('GET', `/api/v1/incidents/${id}`);
    assert.equal(saved.status, 200, saved.raw);
    const line = messages(saved.body.data).join('\n');
    assert.match(line, /Acknowledged by /);
    assert.match(line, /Assigned to Sample Owner/);
    assert.match(line, /Severity changed .+ → CRITICAL/);
    assert.match(line, /Status changed to INVESTIGATING/);
    assert.match(line, /Note added: Sample note: database was restarted/);
    assert.match(line, /Resolved: Sample service answered again/);
    const order = ['Acknowledged by', 'Assigned to', 'Severity changed', 'Status changed', 'Note added', 'Resolved:'].map(start => line.indexOf(start));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'the timeline is in the order the operator acted');
  });

  test('a runbook can be created, edited, ticked and reset', async () => {
    const draft = { title: 'Restore the database', description: 'Sample checklist', category: 'DATABASE', estimatedDurationMin: 20, steps: [{ title: 'Stop writes', instruction: 'Set the app read-only' }, { title: 'Restore the dump', instruction: 'Load the latest copy' }] };
    assert.equal((await api('POST', '/api/v1/runbooks', draft, viewerToken)).status, 403);
    const created = await api('POST', '/api/v1/runbooks', draft);
    assert.equal(created.status, 201, created.raw);
    const id = created.body.data.id as string;
    assert.equal(created.body.data.steps.length, 2);
    assert.equal(created.body.data.steps.every((s: { completed: boolean }) => s.completed === false), true);

    const edited = await api('PATCH', `/api/v1/runbooks/${id}`, {
      title: 'Restore the database (revised)', description: 'Use the verified copy',
      steps: [{ title: 'Stop writes', instruction: 'Set the app read-only' }, { title: 'Restore the verified dump', instruction: 'Load the copy that passed the restore test' }],
    });
    assert.equal(edited.status, 200, edited.raw);
    assert.equal(edited.body.data.title, 'Restore the database (revised)');
    assert.equal(edited.body.data.steps[1].title, 'Restore the verified dump');

    assert.equal((await api('POST', `/api/v1/runbooks/${id}/steps/1/toggle`, {}, viewerToken)).status, 403);
    const ticked = await api('POST', `/api/v1/runbooks/${id}/steps/1/toggle`, {}, operatorToken);
    assert.equal(ticked.status, 200, ticked.raw);
    assert.equal(ticked.body.data.steps[0].completed, true);
    assert.equal(ticked.body.data.steps[1].completed, false);
    assert.ok(ticked.body.data.steps[0].completedBy);

    const reset = await api('POST', `/api/v1/runbooks/${id}/reset`, {}, operatorToken);
    assert.equal(reset.status, 200, reset.raw);
    assert.equal(reset.body.data.steps.every((s: { completed: boolean }) => s.completed === false), true);
    const saved = await one(`select data->>'title' as title from ${SCHEMA}.runbooks where id = $1`, [id]);
    assert.equal(saved.title, 'Restore the database (revised)');
  });

  test('a backup report is stored and nothing is backed up or deployed', async () => {
    const { appId, prdId } = await appPair('backup-sample');
    const code = 'backup-sample';
    const agentToken = (await one(`select agent_token from ${SCHEMA}.servers where id = $1`, [prdId])).agent_token as string;
    const beforeSeen = await one(`select state->>'lastSeen' as last_seen from ${SCHEMA}.servers where id = $1`, [prdId]);
    const report = { application: code, type: 'MYSQL_DUMP', status: 'SUCCESS', sizeGb: 1.25, destination: 's3://sample-bucket/backup-sample', encrypted: true, retentionDays: 14 };
    const post = (bearer: string) => fetch(`${BASE}/api/v1/backups/report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: bearer }, body: JSON.stringify(report),
    });
    assert.equal((await post('')).status, 401);
    assert.equal((await post('Bearer wrong-token')).status, 401);
    assert.equal((await post('Bearer operations-ready-deploy-token')).status, 401, 'a deployment token cannot file a backup or start one');
    const accepted = await post(`Bearer ${agentToken}`);
    const raw = await accepted.text();
    assert.equal(accepted.status, 201, raw);
    assert.equal(raw.includes(agentToken), false, 'the agent token is not echoed');
    const saved = JSON.parse(raw).data as { status: string; type: string; applicationId: string; destination: string };
    assert.deepEqual([saved.status, saved.type, saved.applicationId, saved.destination], ['SUCCESS', 'MYSQL_DUMP', appId, report.destination]);
    const row = await one(`select data->>'status' as status, data->>'type' as type from ${SCHEMA}.backups where data->>'serverId' = $1`, [prdId]);
    assert.equal(row.status, 'SUCCESS');
    assert.equal(row.type, 'MYSQL_DUMP');
    const afterSeen = await one(`select state->>'lastSeen' as last_seen from ${SCHEMA}.servers where id = $1`, [prdId]);
    assert.equal(afterSeen.last_seen, beforeSeen.last_seen, 'filing the report does not look like the agent ran');
    const deployments = await one(`select count(*)::int n from ${SCHEMA}.deployments where data->>'applicationId' = $1`, [appId]);
    assert.equal(deployments.n, 0, 'a backup report does not deploy');
    const listed = await api('GET', '/api/v1/backups');
    assert.equal(listed.body.data.some((b: { destination: string; status: string }) => b.destination === report.destination && b.status === 'SUCCESS'), true);
  });

  test('an application with no DR is not failed for lacking DR, and a HARD dependency with a real check changes status', async () => {
    const prd = await api('POST', '/api/v1/servers', { hostname: 'solo-prd', ip: nextIp(), environment: 'PRD' });
    assert.equal(prd.status, 201, prd.raw);
    const solo = await api('POST', '/api/v1/applications', { name: 'Solo', codeName: 'solo-app', tier: 'TIER_3', prdServerId: prd.body.data.id, drServerId: '' });
    assert.equal(solo.status, 201, solo.raw);
    assert.equal(solo.body.data.drServerId, '');
    assert.equal(solo.body.data.autoFailover, false, 'auto-failover stays off without DR');
    const ready = await api('GET', `/api/v1/applications/${solo.body.data.id}/dr-readiness`);
    assert.equal(ready.status, 200, ready.raw);
    assert.notEqual(ready.body.data.overall, 'NOT_READY');
    const drUrl = ready.body.data.checks.find((c: { key: string }) => c.key === 'dr_url');
    assert.equal(drUrl.status, 'UNKNOWN');
    assert.match(drUrl.detail, /not configured/);
    const avail = await api('GET', `/api/v1/applications/${solo.body.data.id}/availability?range=24h`);
    assert.equal(avail.status, 200, avail.raw);
    const drEnv = avail.body.data.environments.find((e: { environment: string }) => e.environment === 'DR');
    assert.ok(!drEnv || drEnv.monitoring.availabilityPercent === null || drEnv.monitoring.total === 0,
      'PRD-only apps must not show DR as down');

    const { appId: upId } = await appPair('dep-up');
    const { appId: downId } = await appPair('dep-down');
    const upMon = await api('POST', '/api/v1/monitors', monitorBody('Dep up', upId, `${sampleBase}/ok`, 'PRD', true));
    const downMon = await api('POST', '/api/v1/monitors', monitorBody('Dep down', downId, `${sampleBase}/down`, 'PRD', true));
    assert.equal((await api('POST', `/api/v1/monitors/${upMon.body.data.id}/probe`)).body.data.status === 'CRITICAL', false);
    const failed = await api('POST', `/api/v1/monitors/${downMon.body.data.id}/probe`);
    assert.equal(failed.body.data.status, 'CRITICAL');
    const upComp = await api('POST', '/api/v1/registry', { kind: 'APPLICATION', name: 'Dep up app', owner: 'Ops', tier: 'TIER_2', applicationId: upId });
    const downComp = await api('POST', '/api/v1/registry', { kind: 'APPLICATION', name: 'Dep down app', owner: 'Ops', tier: 'TIER_2', applicationId: downId });
    assert.equal(upComp.status, 201, upComp.raw);
    const hard = await api('POST', '/api/v1/dependency-links', { fromId: upComp.body.data.id, toId: downComp.body.data.id, type: 'HARD' });
    assert.equal(hard.status, 201, hard.raw);
    const raised = await api('GET', `/api/v1/applications/${upId}`);
    assert.equal(raised.body.data.status, 'CRITICAL');
    assert.equal(raised.body.data.dependencies.some((d: { name: string }) => d.name.includes('HARD')), true);
    await api('PATCH', `/api/v1/dependency-links/${hard.body.data.id}`, { type: 'SOFT' });
    const softened = await api('GET', `/api/v1/applications/${upId}`);
    assert.equal(softened.body.data.status, 'WARNING');
    assert.notEqual(softened.body.data.status, 'CRITICAL');
  });

  test('two applications can share one PRD server; each keeps its own status', async () => {
    const shared = await api('POST', '/api/v1/servers', { hostname: 'shared-prd', ip: nextIp(), environment: 'PRD' });
    assert.equal(shared.status, 201, shared.raw);
    const sid = shared.body.data.id as string;
    const a = await api('POST', '/api/v1/applications', { name: 'Shared A', codeName: 'share-a', tier: 'TIER_2', prdServerId: sid, drServerId: '' });
    const b = await api('POST', '/api/v1/applications', { name: 'Shared B', codeName: 'share-b', tier: 'TIER_3', prdServerId: sid, drServerId: '' });
    assert.equal(a.status, 201, a.raw);
    assert.equal(b.status, 201, b.raw);
    assert.equal(a.body.data.prdServerId, sid);
    assert.equal(b.body.data.prdServerId, sid);
    const monA = await api('POST', '/api/v1/monitors', monitorBody('Share A up', a.body.data.id, `${sampleBase}/ok`, 'PRD', true));
    const monB = await api('POST', '/api/v1/monitors', monitorBody('Share B down', b.body.data.id, `${sampleBase}/down`, 'PRD', true));
    assert.equal((await api('POST', `/api/v1/monitors/${monA.body.data.id}/probe`)).body.data.status === 'CRITICAL', false);
    assert.equal((await api('POST', `/api/v1/monitors/${monB.body.data.id}/probe`)).body.data.status, 'CRITICAL');
    const gotA = await api('GET', `/api/v1/applications/${a.body.data.id}`);
    const gotB = await api('GET', `/api/v1/applications/${b.body.data.id}`);
    assert.notEqual(gotA.body.data.status, 'CRITICAL');
    assert.equal(gotB.body.data.status, 'CRITICAL');
    const srv = await api('GET', `/api/v1/servers/${sid}`);
    assert.equal(srv.status, 200, srv.raw);
    const used = srv.body.data.usedBy as Array<{ id: string }>;
    assert.equal(used.length, 2);
    assert.deepEqual(used.map(u => u.id).sort(), [a.body.data.id, b.body.data.id].sort());
  });

  test('a maintenance window can be edited, and an added Hostinger connection can be deleted', async () => {
    const { appId } = await appPair('edit-maint');
    const mon = await api('POST', '/api/v1/monitors', monitorBody('Edit scope', appId, `${sampleBase}/ok`, 'PRD', false));
    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date(Date.now() + 3600_000).toISOString();
    const created = await api('POST', '/api/v1/maintenance', {
      title: 'Original window', applicationId: appId, environment: 'PRD', startTime: start, endTime: end, suppressMonitors: [],
    });
    assert.equal(created.status, 201, created.raw);
    const edited = await api('PATCH', `/api/v1/maintenance/${created.body.data.id}`, {
      title: 'Revised window', suppressMonitors: [mon.body.data.id], reason: 'narrower scope',
    });
    assert.equal(edited.status, 200, edited.raw);
    assert.equal(edited.body.data.title, 'Revised window');
    assert.deepEqual(edited.body.data.suppressMonitors, [mon.body.data.id]);
    await api('POST', `/api/v1/maintenance/${created.body.data.id}/complete`);
    assert.equal((await api('PATCH', `/api/v1/maintenance/${created.body.data.id}`, { title: 'Too late' })).status, 400);

    const conn = await api('POST', '/api/v1/providers/connections', { name: 'Spare Hostinger', provider: 'hostinger', tokenEnv: 'HOSTINGER_SPARE_API_TOKEN' });
    assert.equal(conn.status, 201, conn.raw);
    assert.equal((await api('DELETE', `/api/v1/providers/connections/${conn.body.data.id}`, undefined, viewerToken)).status, 403);
    const removed = await api('DELETE', `/api/v1/providers/connections/${conn.body.data.id}`);
    assert.equal(removed.status, 200, removed.raw);
    const left = await api('GET', '/api/v1/providers/connections');
    assert.equal(left.body.data.some((c: { id: string }) => c.id === conn.body.data.id), false);
  });

  test('a Worker event can report request and error counts, and the agent update keeps the installed config', async () => {
    const { appId } = await appPair('worker-counts');
    await api('PATCH', `/api/v1/applications/${appId}`, {
      trafficRouting: { method: 'cloudflare_worker', worker: { name: 'edge', accountId: 'a'.repeat(32), route: 'example.com/*', prdOriginHostname: '', drOriginHostname: '', failback: 'manual' } },
    });
    const posted = await fetch(`${BASE}/api/v1/worker-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer operations-ready-worker-token' },
      body: JSON.stringify({ application: 'worker-counts', kind: 'health', requests: 40, errors: 2, detail: 'sample counts' }),
    });
    const raw = await posted.text();
    assert.equal(posted.status, 200, raw);
    const state = await api('GET', '/api/v1/bootstrap');
    const row = (state.body.data.workerMonitor.apps as Array<{ applicationId: string; requests: number | null; errors: number | null; analytics: string }>).find(a => a.applicationId === appId);
    assert.equal(row?.requests, 40);
    assert.equal(row?.errors, 2);
    assert.equal(row?.analytics, 'EVENTS');

    const prd = await api('POST', '/api/v1/servers', { hostname: 'agent-upd', ip: nextIp(), environment: 'PRD' });
    const id = prd.body.data.id as string;
    const agentToken = (await one(`select agent_token from ${SCHEMA}.servers where id = $1`, [id])).agent_token as string;
    const scriptRes = await fetch(`${BASE}/api/v1/agent/update/${id}?key=${encodeURIComponent(agentToken)}`);
    const script = await scriptRes.text();
    assert.equal(scriptRes.status, 200);
    assert.match(script, /agent\.py\.bak/);
    assert.match(script, /scholario-agent\.conf/);
    assert.equal(script.includes('AGENT_TOKEN='), false, 'the update does not rewrite the token');
    assert.equal(script.includes(agentToken), false);
  });
});
