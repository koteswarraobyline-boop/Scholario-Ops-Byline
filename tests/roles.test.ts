/**
 * Four nested roles on sample data. A higher role includes the rights below it.
 *   npm run test:local -- tests/roles.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { pinTestDatabaseUrl, assertConnectedToTestDatabase, dropVerifiedTestSchema } from './helpers/test-db-guard.ts';
import pg from 'pg';
import { canPerform, hasMinRole, ROLE_LEVEL } from '../src/lib/roles.ts';

const DATABASE_URL = pinTestDatabaseUrl();
dotenv.config({ quiet: true });
const SCHEMA = `ops_roles_${process.pid}`;
const PORT = 5200 + (process.pid % 40);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-roles-'));
const ADMIN = { email: 'roles-admin@example.com', password: 'RolesAdminPassw0rd!' };

let server: ChildProcess | null = null;
const pgc = new pg.Client({ connectionString: DATABASE_URL });

async function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: {
      ...process.env, DATABASE_URL, PORT: String(PORT), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR, NODE_ENV: 'production',
      ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, HOSTINGER_API_TOKEN: '', CLOUDFLARE_API_TOKEN: '', DEADMAN_HEARTBEAT_URL: '',
      SMTP_SERVICE: '', SMTP_URL: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout?.on('data', d => { log += d; });
  server.stderr?.on('data', d => { log += d; });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`server did not start:\n${log}`);
}

async function api(method: string, p: string, body: unknown, bearer: string) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null, raw };
}

test('dashboard role ladder matches the server and includes the roles below', async () => {
  const { ROLE_LEVEL: serverLevel } = await import('../server/auth.ts');
  assert.deepEqual(ROLE_LEVEL, serverLevel);
  assert.deepEqual(ROLE_LEVEL, { viewer: 1, operator: 2, it_administrator: 3, super_admin: 4 });
  const roles = ['viewer', 'operator', 'it_administrator', 'super_admin'] as const;
  for (const role of roles) {
    assert.equal(hasMinRole(role, 'viewer'), true);
    assert.equal(canPerform(role, 'read'), true);
    assert.equal(canPerform(role, 'not_a_real_action'), false);
  }
  assert.equal(canPerform('viewer', 'run_probe'), false);
  assert.equal(canPerform('viewer', 'create_server'), false);
  assert.equal(canPerform('viewer', 'trigger_failover'), false);
  assert.equal(canPerform('operator', 'run_probe'), true);
  assert.equal(canPerform('operator', 'create_maintenance'), true);
  assert.equal(canPerform('operator', 'create_server'), false);
  assert.equal(canPerform('operator', 'delete_user'), false);
  assert.equal(canPerform('it_administrator', 'run_probe'), true);
  assert.equal(canPerform('it_administrator', 'create_server'), true);
  assert.equal(canPerform('it_administrator', 'manage_users'), true);
  assert.equal(canPerform('it_administrator', 'trigger_failover'), false);
  assert.equal(canPerform('it_administrator', 'delete_user'), false);
  assert.equal(canPerform('super_admin', 'run_probe'), true);
  assert.equal(canPerform('super_admin', 'create_server'), true);
  assert.equal(canPerform('super_admin', 'trigger_failover'), true);
  assert.equal(canPerform('super_admin', 'delete_user'), true);
  assert.equal(hasMinRole(null, 'viewer'), false);
});

let tokens: Record<string, string> = {};
let verified = false;

before(async () => {
  await pgc.connect();
  await assertConnectedToTestDatabase(pgc);
  verified = true;
  await startServer();
  const login = await api('POST', '/api/auth/login', ADMIN, '');
  assert.equal(login.status, 200, login.raw);
  tokens.super_admin = login.body.data.tokens.accessToken;
  for (const roleName of ['viewer', 'operator', 'it_administrator'] as const) {
    const created = await api('POST', '/api/v1/users', {
      email: `${roleName}@roles.test`, password: 'RolesUserPassw0rd!', fullName: roleName, roleName,
    }, tokens.super_admin);
    assert.equal(created.status, 201, created.raw);
    const signed = await api('POST', '/api/auth/login', { email: `${roleName}@roles.test`, password: 'RolesUserPassw0rd!' }, '');
    assert.equal(signed.status, 200, signed.raw);
    assert.equal(signed.body.data.user.roleName, roleName);
    tokens[roleName] = signed.body.data.tokens.accessToken;
  }
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

test('every role can read, and a change requires the minimum role with the roles above included', async () => {
  for (const role of ['viewer', 'operator', 'it_administrator', 'super_admin']) {
    assert.equal((await api('GET', '/api/v1/servers', undefined, tokens[role])).status, 200, role);
  }
  assert.equal((await api('GET', '/api/v1/servers', undefined, '')).status, 401);

  const serverBody = { hostname: 'roles-prd', ip: '192.0.2.40', environment: 'PRD' };
  assert.equal((await api('POST', '/api/v1/servers', serverBody, tokens.viewer)).status, 403);
  assert.equal((await api('POST', '/api/v1/servers', serverBody, tokens.operator)).status, 403);
  const byAdmin = await api('POST', '/api/v1/servers', serverBody, tokens.it_administrator);
  assert.equal(byAdmin.status, 201, byAdmin.raw);
  const bySuper = await api('POST', '/api/v1/servers', { hostname: 'roles-dr', ip: '192.0.2.41', environment: 'DR' }, tokens.super_admin);
  assert.equal(bySuper.status, 201, bySuper.raw);

  assert.equal((await api('POST', '/api/v1/incidents', {}, tokens.viewer)).status, 403);
  assert.equal((await api('POST', '/api/v1/incidents', {}, tokens.operator)).status, 400);
  assert.equal((await api('POST', '/api/v1/incidents', {}, tokens.it_administrator)).status, 400);
  assert.equal((await api('POST', '/api/v1/incidents', {}, tokens.super_admin)).status, 400);

  assert.equal((await api('POST', '/api/v1/users', { email: 'nope-op@roles.test', password: 'RolesUserPassw0rd!', fullName: 'Nope', roleName: 'viewer' }, tokens.operator)).status, 403);
  const made = await api('POST', '/api/v1/users', { email: 'extra-viewer@roles.test', password: 'RolesUserPassw0rd!', fullName: 'Extra', roleName: 'viewer' }, tokens.it_administrator);
  assert.equal(made.status, 201, made.raw);
  assert.equal((await api('POST', '/api/v1/users', { email: 'sneaky@roles.test', password: 'RolesUserPassw0rd!', fullName: 'Sneaky', roleName: 'super_admin' }, tokens.it_administrator)).status, 403);
  assert.equal((await api('DELETE', `/api/v1/users/${made.body.data.id}`, undefined, tokens.it_administrator)).status, 403);
  assert.equal((await api('DELETE', `/api/v1/users/${made.body.data.id}`, undefined, tokens.operator)).status, 403);
  const removed = await api('DELETE', `/api/v1/users/${made.body.data.id}`, undefined, tokens.super_admin);
  assert.equal(removed.status, 200, removed.raw);

  const missing = '00000000-0000-4000-8000-000000000001';
  for (const role of ['viewer', 'operator', 'it_administrator']) {
    assert.equal((await api('POST', `/api/v1/applications/${missing}/failover`, { target: 'DR', reason: 'test' }, tokens[role])).status, 403, role);
  }
  const failover = await api('POST', `/api/v1/applications/${missing}/failover`, { target: 'DR', reason: 'test' }, tokens.super_admin);
  assert.notEqual(failover.status, 403);
  assert.equal(failover.status, 404);
});
