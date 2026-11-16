/**
 * Load-balancer failover pre-flight and the approve / reject audit.
 * Sample data on a throw-away schema. The decision does not change Cloudflare.
 *   npm run test:local -- tests/failover-preflight.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { pinTestDatabaseUrl, assertConnectedToTestDatabase, dropVerifiedTestSchema } from './helpers/test-db-guard.ts';

const DATABASE_URL = pinTestDatabaseUrl();
const SCHEMA = `ops_failpre_${process.pid}`;
const PORT = 5480 + (process.pid % 30);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'fail-admin@example.com', password: 'FailTestPassw0rd!' };
const OPERATOR = { email: 'fail-operator@example.com', password: 'OperatorPassw0rd!' };
const VIEWER = { email: 'fail-viewer@example.com', password: 'ViewerPassw0rd!' };
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-failpre-'));

let server: ChildProcess | null = null;
let serverLog = '';
let admin = '';
let operator = '';
let viewer = '';
let appId = '';
const pgc = new pg.Client({ connectionString: DATABASE_URL });

async function api(method: string, p: string, body?: unknown, bearer = admin) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null, raw };
}

let verified = false;
before(async () => {
  await pgc.connect();
  await assertConnectedToTestDatabase(pgc);
  verified = true;
  server = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: {
      ...process.env, DATABASE_URL, PORT: String(PORT), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR,
      NODE_ENV: 'production', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password,
      CLOUDFLARE_API_TOKEN: '', HOSTINGER_API_TOKEN: '', DEADMAN_HEARTBEAT_URL: '',
      SMTP_SERVICE: '', SMTP_URL: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverLog = '';
  server.stdout?.on('data', d => { serverLog += d; });
  server.stderr?.on('data', d => { serverLog += d; });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ }
    if (i === 59) throw new Error(`server did not start:\n${serverLog.slice(-2000)}`);
    await new Promise(r => setTimeout(r, 500));
  }
  const login = await api('POST', '/api/auth/login', ADMIN, '');
  assert.equal(login.status, 200, login.raw);
  admin = login.body.data.tokens.accessToken;
  for (const user of [
    { ...OPERATOR, fullName: 'Operator', roleName: 'operator' },
    { ...VIEWER, fullName: 'Viewer', roleName: 'viewer' },
  ]) {
    assert.equal((await api('POST', '/api/v1/users', user)).status, 201);
  }
  operator = (await api('POST', '/api/auth/login', OPERATOR, '')).body.data.tokens.accessToken;
  viewer = (await api('POST', '/api/auth/login', VIEWER, '')).body.data.tokens.accessToken;

  const srv = await api('POST', '/api/v1/servers', { hostname: 'fail-prd', ip: '192.0.2.90', environment: 'PRD' });
  assert.equal(srv.status, 201, srv.raw);
  const app = await api('POST', '/api/v1/applications', {
    name: 'Failover App', codeName: 'failapp', tier: 'TIER_1', prdServerId: srv.body.data.id,
    loadBalancer: {
      accountId: 'a'.repeat(32),
      hostname: 'failapp.example.com',
      prdPoolId: 'b'.repeat(32),
      drPoolId: 'c'.repeat(32),
    },
  });
  assert.equal(app.status, 201, app.raw);
  appId = app.body.data.id;
});

after(async () => {
  if (server) {
    const child = server;
    server = null;
    await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGTERM'); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 8000); });
  }
  await dropVerifiedTestSchema(verified, () => pgc.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {}));
  await pgc.end().catch(() => {});
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('pre-flight lists the checks and the manual Cloudflare steps', async () => {
  assert.equal((await api('GET', `/api/v1/applications/${appId}/failover/preflight?target=DR`, undefined, viewer)).status, 403);
  const pf = await api('GET', `/api/v1/applications/${appId}/failover/preflight?target=DR`, undefined, operator);
  assert.equal(pf.status, 200, pf.raw);
  const data = pf.body.data;
  assert.equal(data.appId, appId);
  assert.equal(data.target, 'DR');
  assert.equal(data.mode, 'LOAD_BALANCER_MANUAL');
  assert.equal(typeof data.preflightPassed, 'boolean');
  assert.ok(Array.isArray(data.checks) && data.checks.length >= 8);
  assert.ok(data.checks.some((c: { key: string }) => c.key === 'target_reachable'));
  assert.ok(data.checks.some((c: { key: string }) => c.key === 'cloudflare_state'));
  assert.ok(data.checks.some((c: { key: string }) => c.key === 'routing'));
  assert.ok(data.plan.some((step: string) => step.includes('does NOT change Cloudflare')));
  assert.ok(data.plan.some((step: string) => step.includes('failapp.example.com')));
  assert.ok(data.plan.some((step: string) => /pool/i.test(step)));
  assert.ok(data.plan.some((step: string) => /audit log/i.test(step)));
  assert.equal(Array.isArray(data.impactPreview.features), true);
});

test('only a super admin can approve or reject, and the decision is audited without moving traffic', async () => {
  const body = { target: 'DR', decision: 'APPROVED', reason: 'PRD origin is down' };
  assert.equal((await api('POST', `/api/v1/applications/${appId}/failover/decision`, body, viewer)).status, 403);
  assert.equal((await api('POST', `/api/v1/applications/${appId}/failover/decision`, body, operator)).status, 403);
  assert.equal((await api('POST', `/api/v1/applications/${appId}/failover/decision`, { target: 'DR', decision: 'APPROVED', reason: ' ' })).status, 400);

  const approved = await api('POST', `/api/v1/applications/${appId}/failover/decision`, body);
  assert.equal(approved.status, 200, approved.raw);
  assert.equal(approved.body.data.recorded, true);
  assert.equal(approved.body.data.decision, 'APPROVED');

  const rejected = await api('POST', `/api/v1/applications/${appId}/failover/decision`, {
    target: 'PRIMARY', decision: 'REJECTED', reason: 'DR is not ready',
  });
  assert.equal(rejected.status, 200, rejected.raw);

  const app = await api('GET', `/api/v1/applications/${appId}`);
  assert.equal(app.body.data.failoverState, 'PRIMARY_ACTIVE');

  const audits = (await api('GET', `/api/v1/audit?q=${appId}&pageSize=50`)).body.data as Array<{ action: string; details: string; category: string }>;
  const approvedRow = audits.find(a => a.action === 'FAILOVER_APPROVED');
  const rejectedRow = audits.find(a => a.action === 'FAILOVER_REJECTED');
  assert.ok(approvedRow, 'approve is in the audit log');
  assert.equal(approvedRow.category, 'FAILOVER');
  assert.match(approvedRow.details, /PRD origin is down/);
  assert.match(approvedRow.details, /LOAD_BALANCER_MANUAL/);
  assert.ok(rejectedRow, 'reject is in the audit log');
  assert.match(rejectedRow.details, /DR is not ready/);
  assert.match(rejectedRow.details, /PRIMARY/);

  const again = await api('GET', `/api/v1/applications/${appId}/failover/preflight?target=DR`, undefined, operator);
  assert.equal(again.status, 200, again.raw);
  assert.equal(again.body.data.lastDecision.decision, 'APPROVED');
  assert.equal(again.body.data.lastDecision.target, 'DR');
  assert.equal(again.body.data.lastDecision.reason, 'PRD origin is down');
  const failback = await api('GET', `/api/v1/applications/${appId}/failover/preflight?target=PRIMARY`, undefined, operator);
  assert.equal(failback.body.data.lastDecision.decision, 'REJECTED');
  assert.equal(failback.body.data.lastDecision.reason, 'DR is not ready');
});
