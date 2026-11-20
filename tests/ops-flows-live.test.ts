/**
 * The three flows against a real server and sample data:
 * expired API key → one incident; probe every 30s, confirm, Cloudflare, DR, notify, resolve;
 * impact (apps, features, users), suggested severity, owners on the notification.
 *
 *   npm run test:local -- tests/ops-flows-live.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { pinTestDatabaseUrl, assertConnectedToTestDatabase, dropVerifiedTestSchema } from './helpers/test-db-guard.ts';

const DATABASE_URL = pinTestDatabaseUrl();
const SCHEMA = `ops_flow_${process.pid}`;
const PORT = 5100 + (process.pid % 70);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'flow-admin@example.com', password: 'FlowTestPassw0rd!' };
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-flow-'));

let server: ChildProcess | null = null;
let token = '';
let serverLog = '';
let apiMode: 'auth' | 'ok' = 'auth';
let apiServer: http.Server | null = null;
let apiOrigin = '';
const pgc = new pg.Client({ connectionString: DATABASE_URL });

async function startApi() {
  apiServer = http.createServer((_req, res) => {
    if (apiMode === 'auth') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'invalid_api_key', message: 'Incorrect API key provided' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise<void>(resolve => apiServer!.listen(0, '127.0.0.1', resolve));
  const addr = apiServer.address();
  if (!addr || typeof addr === 'string') throw new Error('api test server has no port');
  apiOrigin = `http://127.0.0.1:${addr.port}`;
}

async function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: {
      ...process.env, DATABASE_URL, PORT: String(PORT), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR,
      NODE_ENV: 'production', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password,
      CLOUDFLARE_API_TOKEN: '', HOSTINGER_API_TOKEN: '', DEADMAN_HEARTBEAT_URL: '',
      SMTP_HOST: '', SMTP_URL: '', SMTP_SERVICE: '', ALERT_COOLDOWN_MIN: '0',
      CREDENTIAL_EXPIRY_WARN_DAYS: '14',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverLog = '';
  server.stdout?.on('data', d => { serverLog += d; });
  server.stderr?.on('data', d => { serverLog += d; });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`server did not start:\n${serverLog}`);
}

async function stopServer() {
  if (apiServer) await new Promise(resolve => apiServer!.close(() => resolve(null)));
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>(resolve => { s.once('exit', () => resolve()); s.kill('SIGTERM'); setTimeout(() => { s.kill('SIGKILL'); resolve(); }, 8000); });
}

async function api(method: string, p: string, body?: unknown, bearer = token) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null, raw };
}

async function waitFor<T>(label: string, read: () => Promise<T | null>, attempts = 40): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    const value = await read();
    if (value) return value;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${label}\n${serverLog.slice(-2000)}`);
}

let verified = false;
const ids: Record<string, string> = {};

before(async () => {
  await pgc.connect();
  await assertConnectedToTestDatabase(pgc);
  verified = true;
  await startApi();
  await startServer();
  const login = await api('POST', '/api/auth/login', ADMIN, '');
  assert.equal(login.status, 200, login.raw);
  token = login.body.data.tokens.accessToken;

  const srv = await api('POST', '/api/v1/servers', { hostname: 'flow-prd', ip: '192.0.2.90', environment: 'PRD' });
  assert.equal(srv.status, 201, srv.raw);
  ids.srv = srv.body.data.id;
  const app = await api('POST', '/api/v1/applications', { name: 'Flow App', codeName: 'flow', tier: 'TIER_1', prdServerId: ids.srv });
  assert.equal(app.status, 201, app.raw);
  ids.app = app.body.data.id;

  const reg = await api('POST', '/api/v1/registry', {
    kind: 'APPLICATION', name: 'Flow App', owner: 'ai-owner@example.com', tier: 'TIER_1',
    applicationId: ids.app, userCount: 500, served: ['Students'],
  });
  assert.equal(reg.status, 201, reg.raw);
  ids.reg = reg.body.data.id;
  const feat = await api('POST', '/api/v1/registry', {
    kind: 'BUSINESS_FEATURE', name: 'Marking', owner: 'product@example.com', tier: 'TIER_1',
    applicationId: ids.app, userCount: 200, served: ['Teachers'],
  });
  assert.equal(feat.status, 201, feat.raw);
  ids.feat = feat.body.data.id;
  assert.equal((await api('POST', '/api/v1/dependency-links', { fromId: ids.feat, toId: ids.reg, type: 'HARD' })).status, 201);

  const channel = await api('POST', '/api/v1/channels', {
    name: 'Ops mail', type: 'EMAIL', targetEndpoint: 'ops-alerts@example.com', enabled: true,
  });
  assert.equal(channel.status, 201, channel.raw);
  ids.channel = channel.body.data.id;
  const policy = await api('PUT', '/api/v1/escalation-policies', {
    policies: [{
      id: 'pol-critical', severity: 'CRITICAL', channels: [ids.channel], initialDelayMin: 0, repeatIntervalMin: 0,
      steps: [{ afterMin: 1, channels: [ids.channel], notifyOnCall: false, label: 'Application owners' }],
    }],
  });
  assert.equal(policy.status, 200, policy.raw);
});

after(async () => {
  await stopServer();
  await dropVerifiedTestSchema(verified, () => pgc.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {}));
  await pgc.end().catch(() => {});
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('expired API key opens one incident; a secret is refused; renewing resolves it', async () => {
  const refused = await api('POST', '/api/v1/credentials', {
    name: 'OpenAI', kind: 'API_KEY', provider: 'OpenAI', owner: 'ai-owner@example.com',
    expiresAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), environment: 'PRD',
    applicationId: ids.app, token: 'sk-live-secret',
  });
  assert.equal(refused.status, 400, refused.raw);
  assert.match(refused.body.message, /secret/i);

  const created = await api('POST', '/api/v1/credentials', {
    name: 'OpenAI production key', kind: 'API_KEY', provider: 'OpenAI', owner: 'ai-owner@example.com',
    expiresAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), environment: 'PRD', applicationId: ids.app,
    notes: 'Secret stays in the provider vault',
  });
  assert.equal(created.status, 201, created.raw);
  assert.equal(created.body.data.state, 'EXPIRED');
  assert.equal(created.body.data.evaluated.opened, 1);
  ids.cred = created.body.data.id;

  const again = await api('POST', '/api/v1/credentials/evaluate');
  assert.equal(again.status, 200, again.raw);
  assert.equal(again.body.data.opened, 0);

  const list = await api('GET', '/api/v1/incidents?pageSize=100');
  const matches = (list.body.data as Array<{ fingerprint: string; status: string }>).filter(i => i.fingerprint === `credential-expired:${ids.cred}` && i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  assert.equal(matches.length, 1, JSON.stringify(list.body.data));
  const inc = matches[0] as {
    rootCauseCategory: string; severity: string; suggestedSeverity: string; severityReason: string;
    notifiedOwners: string[]; impactAnalysis: { usersStopped: number; features: Array<{ name: string }>; applications: Array<{ name: string }> };
    timeline: Array<{ message: string }>;
  };
  assert.equal(inc.rootCauseCategory, 'EXPIRED_CREDENTIAL');
  assert.equal(inc.severity, 'CRITICAL');
  assert.equal(inc.suggestedSeverity, 'CRITICAL');
  assert.match(inc.severityReason, /TIER 1/);
  assert.equal(inc.impactAnalysis.usersStopped, 500);
  assert.ok(inc.impactAnalysis.applications.some(a => a.name === 'Flow App'));
  assert.ok(inc.impactAnalysis.features.some(f => f.name === 'Marking'));
  assert.ok(inc.notifiedOwners.includes('ai-owner@example.com'));
  assert.ok(inc.notifiedOwners.includes('product@example.com'));
  assert.ok(inc.timeline.some(e => /ai-owner@example.com/.test(e.message)));

  const renewed = await api('PATCH', `/api/v1/credentials/${ids.cred}`, { expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString() });
  assert.equal(renewed.status, 200, renewed.raw);
  assert.equal(renewed.body.data.state, 'OK');
  const after = await api('GET', '/api/v1/incidents?pageSize=100');
  const stillOpen = (after.body.data as Array<{ fingerprint: string; status: string }>).filter(i => i.fingerprint === `credential-expired:${ids.cred}` && i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  assert.equal(stillOpen.length, 0);
});

test('probe every 30s, confirm the credential failure, record Cloudflare and DR, notify, then auto-resolve', async () => {
  const created = await api('POST', '/api/v1/monitors', {
    name: 'AI API', type: 'HTTP', target: `${apiOrigin}/v1/models`, applicationId: ids.app, environment: 'PRD',
    intervalSec: 30, timeoutSec: 5, failureConfirmationThreshold: 2, recoveryConfirmationThreshold: 2, retries: 1,
  });
  assert.equal(created.status, 201, created.raw);
  assert.equal(created.body.data.intervalSec, 30);
  ids.mon = created.body.data.id;

  const first = await waitFor('first failed check', async () => {
    const row = await api('GET', `/api/v1/monitors/${ids.mon}`);
    const m = row.body.data;
    return m.consecutiveFailures >= 1 ? m : null;
  });
  assert.equal(first.lastProbeStatus, 'AUTH_ERROR');
  const early = await api('GET', '/api/v1/incidents?pageSize=100');
  const earlyHits = (early.body.data as Array<{ fingerprint: string; status: string }>).filter(i => i.fingerprint === `monitor:${ids.mon}` && i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  assert.equal(earlyHits.length, 0, 'one failure is not an outage');

  await api('POST', `/api/v1/monitors/${ids.mon}/probe`);
  const incident = await waitFor('confirmed incident', async () => {
    const list = await api('GET', '/api/v1/incidents?pageSize=100');
    const hits = (list.body.data as Array<{ fingerprint: string; status: string }>).filter(i => i.fingerprint === `monitor:${ids.mon}` && i.status !== 'RESOLVED' && i.status !== 'CLOSED');
    return hits.length === 1 ? hits[0] : null;
  });
  const inc = incident as {
    title: string; rootCauseCategory: string; severity: string; suggestedSeverity: string;
    impactAnalysis: { usersStopped: number; features: Array<{ name: string }> };
    notifiedOwners: string[];
    outage: { probeIntervalSec: number; confirmedFailures: number; cloudflareOrigin: string; drReadiness: string; drDetail: string; notified: boolean; escalationReady: boolean };
    timeline: Array<{ message: string }>;
  };
  assert.match(inc.title, /credential rejected/);
  assert.equal(inc.rootCauseCategory, 'EXPIRED_CREDENTIAL');
  assert.equal(inc.severity, 'CRITICAL');
  assert.equal(inc.suggestedSeverity, 'CRITICAL');
  assert.equal(inc.impactAnalysis.usersStopped, 500);
  assert.ok(inc.impactAnalysis.features.some(f => f.name === 'Marking'));
  assert.ok(inc.notifiedOwners.includes('ai-owner@example.com'));
  assert.equal(inc.outage.probeIntervalSec, 30);
  assert.ok(inc.outage.confirmedFailures >= 2);
  assert.equal(inc.outage.cloudflareOrigin, 'NOT_CHECKED');
  assert.ok(['READY', 'DEGRADED', 'NOT_READY', 'UNKNOWN'].includes(inc.outage.drReadiness));
  assert.ok(inc.outage.drDetail.length > 0);
  assert.equal(inc.outage.notified, true);
  assert.equal(inc.outage.escalationReady, true);
  assert.ok(inc.timeline.some(e => /DR readiness|NOT READY|UNKNOWN|DEGRADED|READY/i.test(e.message)));
  assert.ok(inc.timeline.some(e => /Owners|ai-owner@example.com/.test(e.message)));

  await api('POST', `/api/v1/monitors/${ids.mon}/probe`);
  const still = await api('GET', '/api/v1/incidents?pageSize=100');
  const open = (still.body.data as Array<{ fingerprint: string; status: string }>).filter(i => i.fingerprint === `monitor:${ids.mon}` && i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  assert.equal(open.length, 1, 'a continued failure stays one incident');

  apiMode = 'ok';
  await api('POST', `/api/v1/monitors/${ids.mon}/probe`);
  await api('POST', `/api/v1/monitors/${ids.mon}/probe`);
  const resolved = await waitFor('auto-resolve', async () => {
    const list = await api('GET', '/api/v1/incidents?pageSize=100');
    const row = (list.body.data as Array<{ fingerprint: string; status: string; recoveryStatus?: string }>).find(i => i.fingerprint === `monitor:${ids.mon}`);
    return row && row.status === 'RESOLVED' ? row : null;
  });
  assert.match(String((resolved as { recoveryStatus?: string }).recoveryStatus), /Recovered automatically/);
});
