/**
 * Incident root-cause category, Impact Analysis, fix steps, impact preview and registry paths.
 *   npm run test:local -- tests/incident-impact.test.ts
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
const SCHEMA = `ops_imp_${process.pid}`;
const PORT = 4700 + (process.pid % 80);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'imp-admin@example.com', password: 'ImpTestPassw0rd!' };
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-imp-'));

let server: ChildProcess | null = null;
let token = '';
let serverLog = '';
const pgc = new pg.Client({ connectionString: DATABASE_URL });

async function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: {
      ...process.env, DATABASE_URL, PORT: String(PORT), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR,
      NODE_ENV: 'production', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password,
      CLOUDFLARE_API_TOKEN: '', HOSTINGER_API_TOKEN: '', DEADMAN_HEARTBEAT_URL: '',
      DEPLOY_REPORT_TOKEN: 'impact-deploy-token',
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

let verified = false;
const ids: Record<string, string> = {};

before(async () => {
  await pgc.connect();
  await assertConnectedToTestDatabase(pgc);
  verified = true;
  await startServer();
  const login = await api('POST', '/api/auth/login', ADMIN, '');
  assert.equal(login.status, 200, login.raw);
  token = login.body.data.tokens.accessToken;

  const srv = await api('POST', '/api/v1/servers', { hostname: 'imp-prd', ip: '192.0.2.80', environment: 'PRD' });
  assert.equal(srv.status, 201, srv.raw);
  ids.srv = srv.body.data.id;
  const app = await api('POST', '/api/v1/applications', { name: 'Impact App', codeName: 'imp', tier: 'TIER_1', prdServerId: ids.srv });
  assert.equal(app.status, 201, app.raw);
  ids.app = app.body.data.id;

  const regApp = await api('POST', '/api/v1/registry', {
    kind: 'APPLICATION', name: 'Impact App', owner: 'Ops', tier: 'TIER_1',
    applicationId: ids.app, userCount: 500, served: ['Students'],
  });
  assert.equal(regApp.status, 201, regApp.raw);
  ids.regApp = regApp.body.data.id;

  const feat = await api('POST', '/api/v1/registry', {
    kind: 'BUSINESS_FEATURE', name: 'Enrolment', owner: 'Ops', tier: 'TIER_1',
    applicationId: ids.app, userCount: 200, served: ['Students'],
  });
  assert.equal(feat.status, 201, feat.raw);
  ids.feat = feat.body.data.id;

  const dbComp = await api('POST', '/api/v1/registry', { kind: 'DATABASE', name: 'Impact DB', owner: 'DBA', tier: 'TIER_1' });
  assert.equal(dbComp.status, 201, dbComp.raw);
  ids.db = dbComp.body.data.id;

  assert.equal((await api('POST', '/api/v1/dependency-links', { fromId: ids.regApp, toId: ids.db, type: 'HARD' })).status, 201);
  assert.equal((await api('POST', '/api/v1/dependency-links', { fromId: ids.feat, toId: ids.db, type: 'HARD' })).status, 201);
});

after(async () => {
  await stopServer();
  await dropVerifiedTestSchema(verified, () => pgc.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {}));
  await pgc.end().catch(() => {});
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('manual incident captures category and Impact Analysis from the register', async () => {
  const created = await api('POST', '/api/v1/incidents', {
    title: 'DB outage',
    severity: 'CRITICAL',
    applicationId: ids.app,
    environment: 'PRD',
    description: 'Postgres connection refused',
    rootCauseCategory: 'INFRASTRUCTURE',
  });
  assert.equal(created.status, 201, created.raw);
  const inc = created.body.data;
  ids.inc = inc.id;
  assert.equal(inc.rootCauseCategory, 'INFRASTRUCTURE');
  assert.equal(inc.rootCause, 'Postgres connection refused');
  assert.ok(inc.impactAnalysis, 'impactAnalysis attached');
  assert.equal(inc.impactAnalysis.componentId, ids.regApp);
  assert.ok(inc.impactAnalysis.features.some((f: { id: string }) => f.id === ids.feat)
    || inc.impactAnalysis.applications.some((a: { id: string }) => a.id === ids.regApp));
  assert.equal(inc.impactAnalysis.usersStopped, 500);
  const enrolment = inc.impactAnalysis.features.find((f: { id: string }) => f.id === ids.feat);
  assert.ok(enrolment, 'Enrolment is an affected feature');
  assert.equal(enrolment.via, 'HARD');
  assert.match(enrolment.action, /Stopped/);
  assert.match(enrolment.action, /Impact App/);
  assert.match(enrolment.action, /cannot run without it/);
  assert.deepEqual(inc.fixSteps, []);
});

test('root-cause category can be updated; fix steps track to completion; resolve blocked until done', async () => {
  const cat = await api('PATCH', `/api/v1/incidents/${ids.inc}/root-cause`, {
    rootCauseCategory: 'CAPACITY',
    description: 'Disk full on PRD — confirmed by agent metrics',
  });
  assert.equal(cat.status, 200, cat.raw);
  assert.equal(cat.body.data.rootCauseCategory, 'CAPACITY');
  assert.match(cat.body.data.rootCause, /Disk full/);

  const steps = await api('PUT', `/api/v1/incidents/${ids.inc}/fix-steps`, {
    steps: ['Free disk space', 'Verify monitors green'],
  });
  assert.equal(steps.status, 200, steps.raw);
  assert.equal(steps.body.data.fixSteps.length, 2);
  const stepId = steps.body.data.fixSteps[0].id as string;

  const blocked = await api('POST', `/api/v1/incidents/${ids.inc}/resolve`, { resolution: 'too soon' });
  assert.equal(blocked.status, 400, blocked.raw);
  assert.match(blocked.body.message, /fix step/);

  const toggled = await api('POST', `/api/v1/incidents/${ids.inc}/fix-steps/${stepId}/toggle`);
  assert.equal(toggled.status, 200, toggled.raw);
  assert.equal(toggled.body.data.fixSteps[0].completed, true);

  const stillBlocked = await api('POST', `/api/v1/incidents/${ids.inc}/resolve`, { resolution: 'one left' });
  assert.equal(stillBlocked.status, 400);

  const forced = await api('POST', `/api/v1/incidents/${ids.inc}/resolve`, { resolution: 'Forced close', force: true });
  assert.equal(forced.status, 200, forced.raw);
  assert.equal(forced.body.data.status, 'RESOLVED');
});

test('impact preview and registry paths expose upstream / downstream with live status', async () => {
  const preview = await api('GET', `/api/v1/impact/preview?applicationId=${ids.app}&environment=PRD`);
  assert.equal(preview.status, 200, preview.raw);
  assert.equal(preview.body.data.componentId, ids.regApp);
  assert.match(preview.body.data.summary, /Impact App|goes down/i);

  // Preview from the database: app + feature should hard-stop
  const dbPreview = await api('GET', `/api/v1/impact/preview?registryId=${ids.db}`);
  assert.equal(dbPreview.status, 200, dbPreview.raw);
  assert.ok(dbPreview.body.data.hardStops.some((h: { id: string }) => h.id === ids.regApp));
  assert.ok(dbPreview.body.data.hardStops.some((h: { id: string }) => h.id === ids.feat));
  const enrolment = dbPreview.body.data.features.find((f: { id: string }) => f.id === ids.feat);
  assert.ok(enrolment, 'the database preview lists the feature');
  assert.equal(enrolment.via, 'HARD');
  assert.match(enrolment.action, /Stopped/);
  assert.match(enrolment.action, /Impact DB/);
  assert.equal(dbPreview.body.data.usersStopped, 500);

  const paths = await api('GET', `/api/v1/registry/${ids.regApp}/paths`);
  assert.equal(paths.status, 200, paths.raw);
  assert.ok(paths.body.data.upstream.some((u: { id: string; via: string }) => u.id === ids.db && u.via === 'HARD'));
  assert.ok(['HEALTHY', 'WARNING', 'CRITICAL', 'UNKNOWN', 'MAINTENANCE'].includes(paths.body.data.status));
  assert.ok(paths.body.data.upstream.every((u: { status: string }) => typeof u.status === 'string'));

  assert.equal((await api('GET', '/api/v1/impact/preview')).status, 400);
  assert.equal((await api('GET', '/api/v1/registry/nope/paths')).status, 404);
});

test('refresh-impact re-pulls apps and features onto an open incident', async () => {
  const created = await api('POST', '/api/v1/incidents', {
    title: 'Refresh me', severity: 'HIGH', applicationId: ids.app, description: 'HTTP 503',
  });
  assert.equal(created.status, 201, created.raw);
  // Inferred from HTTP 503 → APPLICATION_BUG
  assert.equal(created.body.data.rootCauseCategory, 'APPLICATION_BUG');
  const refreshed = await api('POST', `/api/v1/incidents/${created.body.data.id}/refresh-impact`);
  assert.equal(refreshed.status, 200, refreshed.raw);
  assert.equal(refreshed.body.data.impactAnalysis.componentId, ids.regApp);
});

test('runbook can be linked on an incident', async () => {
  const rb = await api('POST', '/api/v1/runbooks', {
    title: 'Disk full runbook', description: 'Free space', category: 'PERFORMANCE', estimatedDurationMin: 15,
    steps: [{ title: 'Check df -h', instruction: 'Identify fullest mount' }],
  });
  assert.equal(rb.status, 201, rb.raw);
  const open = await api('POST', '/api/v1/incidents', {
    title: 'Link runbook', severity: 'WARNING', applicationId: ids.app, description: 'near capacity',
  });
  assert.equal(open.status, 201, open.raw);
  assert.equal(open.body.data.rootCauseCategory, 'CAPACITY');
  const linked = await api('PATCH', `/api/v1/incidents/${open.body.data.id}/runbook`, { runbookId: rb.body.data.id });
  assert.equal(linked.status, 200, linked.raw);
  assert.equal(linked.body.data.runbookId, rb.body.data.id);
});

test('likely cause prefers a recent failed deployment and still lists an expired credential', async () => {
  const expired = new Date(Date.now() - 86_400_000).toISOString();
  const cred = await api('POST', '/api/v1/credentials', {
    name: 'OpenAI key', kind: 'API_KEY', provider: 'OpenAI', owner: 'Ops',
    applicationId: ids.app, environment: 'PRD', expiresAt: expired,
  });
  assert.equal(cred.status, 201, cred.raw);
  const dep = await api('POST', '/api/v1/deployments/report', {
    application: 'imp', version: '1.4.2', status: 'FAILED', environment: 'PRD', author: 'ci',
  }, 'impact-deploy-token');
  assert.equal(dep.status, 201, dep.raw);
  const created = await api('POST', '/api/v1/incidents', {
    title: 'Impact App down', severity: 'HIGH', applicationId: ids.app, environment: 'PRD', description: 'HTTP 503',
  });
  assert.equal(created.status, 201, created.raw);
  assert.equal(created.body.data.rootCauseCategory, 'DEPLOYMENT');
  assert.equal(created.body.data.likelyCause.category, 'DEPLOYMENT');
  assert.equal(created.body.data.likelyCause.confidence, 'HIGH');
  assert.match(created.body.data.likelyCause.summary, /deployment 1\.4\.2 FAILED on PRD/);
  assert.match(created.body.data.likelyCause.summary, /OpenAI key expired/);
  assert.ok(created.body.data.likelyCause.evidence.some((e: { source: string }) => e.source === 'DEPLOYMENT'));
  assert.ok(created.body.data.likelyCause.evidence.some((e: { source: string }) => e.source === 'EXPIRY'));
  const chosen = await api('POST', '/api/v1/incidents', {
    title: 'Operator already knows', severity: 'HIGH', applicationId: ids.app, environment: 'PRD',
    description: 'HTTP 503', rootCauseCategory: 'NETWORK',
  });
  assert.equal(chosen.status, 201, chosen.raw);
  assert.equal(chosen.body.data.rootCauseCategory, 'NETWORK');
  assert.equal(chosen.body.data.likelyCause.category, 'DEPLOYMENT');
});
