/**
 * Password and session contract on sample data.
 * A weak first-admin password is replaced, sessions use scrypt, 8-hour access tokens,
 * rotating 7-day refresh tokens, and a token version that signs every session out.
 *   npm run test:local -- tests/auth-session.test.ts
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
const SCHEMA = `ops_auth_${process.pid}`;
const PORT = 4720 + (process.pid % 60);
const BASE = `http://127.0.0.1:${PORT}`;
const EMAIL = 'session-admin@example.com';
const WEAK = 'weak';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-auth-'));
const ACCESS_TTL = 8 * 3600;
const REFRESH_TTL = 7 * 24 * 3600;

let server: ChildProcess | null = null;
let logs = '';
const pgc = new pg.Client({ connectionString: DATABASE_URL });

function claims(token: string): { sub: string; typ: string; ver: number; exp: number; iat: number; jti?: string } {
  const part = token.split('.')[1];
  assert.ok(part, 'token has a payload');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

async function api(method: string, p: string, body?: unknown, bearer = '') {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  return { status: res.status, body: raw ? JSON.parse(raw) : null, raw };
}

let verified = false;
let password = '';

async function userRow(): Promise<{ password_hash: string; token_version: number } | undefined> {
  const stored = await pgc.query(`select password_hash, token_version from ${SCHEMA}.users where email = $1`, [EMAIL]);
  return stored.rows[0];
}

/** Login writes the user through a short save delay. Wait until PostgreSQL has the row. */
async function savedUser() {
  for (let i = 0; i < 20; i++) {
    const row = await userRow();
    if (row) return row;
    await new Promise(r => setTimeout(r, 250));
  }
  assert.fail('the first administrator was not saved');
}

before(async () => {
  await pgc.connect();
  await assertConnectedToTestDatabase(pgc);
  verified = true;
  server = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: {
      ...process.env, DATABASE_URL, PORT: String(PORT), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR,
      NODE_ENV: 'production', ADMIN_EMAIL: EMAIL, ADMIN_PASSWORD: WEAK,
      ACCESS_TOKEN_TTL_SEC: String(ACCESS_TTL), REFRESH_TOKEN_TTL_SEC: String(REFRESH_TTL),
      JWT_SECRET: 'auth-session-test-jwt-secret-0123456789',
      CLOUDFLARE_API_TOKEN: '', HOSTINGER_API_TOKEN: '', DEADMAN_HEARTBEAT_URL: '',
      SMTP_SERVICE: '', SMTP_URL: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', d => { logs += d; });
  server.stderr?.on('data', d => { logs += d; });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`server did not start:\n${logs.slice(-2000)}`);
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

test('first administrator, sessions, and revocation work on sample data', async () => {
  const file = path.join(DATA_DIR, 'initial-admin-password.txt');
  assert.equal(fs.existsSync(file), true, 'a weak ADMIN_PASSWORD is replaced and saved for the operator');
  const [fileEmail, filePassword] = fs.readFileSync(file, 'utf8').split('\n');
  assert.equal(fileEmail, EMAIL);
  assert.ok(filePassword && filePassword.length >= 10);
  assert.equal(logs.includes(filePassword), false, 'the generated password is not written to the log');
  password = filePassword;
  assert.equal((await api('POST', '/api/auth/login', { email: EMAIL, password: WEAK })).status, 401);

  const login = await api('POST', '/api/auth/login', { email: EMAIL, password });
  assert.equal(login.status, 200, login.raw);
  const first = login.body.data.tokens as { accessToken: string; refreshToken: string; expiresIn: string };
  assert.equal(first.expiresIn, `${ACCESS_TTL}s`);
  assert.equal(login.body.data.user.email, EMAIL);
  assert.equal(login.body.data.user.roleName, 'super_admin');
  assert.equal('passwordHash' in login.body.data.user, false);
  assert.equal('tokenVersion' in login.body.data.user, false);

  const access = claims(first.accessToken);
  const refresh = claims(first.refreshToken);
  assert.equal(access.typ, 'access');
  assert.equal(refresh.typ, 'refresh');
  assert.equal(access.ver, 0);
  assert.equal(refresh.ver, 0);
  assert.equal(access.exp - access.iat, ACCESS_TTL);
  assert.equal(refresh.exp - refresh.iat, REFRESH_TTL);

  const stored = await savedUser();
  const hash = stored.password_hash;
  assert.match(hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(stored.token_version, 0);

  const me = await api('GET', '/api/auth/me', undefined, first.accessToken);
  assert.equal(me.status, 200, me.raw);
  assert.equal(me.body.data.email, EMAIL);
  assert.equal(me.raw.includes('passwordHash'), false);
  assert.equal((await api('GET', '/api/auth/me')).status, 401);

  const rotated = await api('POST', '/api/auth/refresh', { refreshToken: first.refreshToken });
  assert.equal(rotated.status, 200, rotated.raw);
  const second = rotated.body.data.tokens as { accessToken: string; refreshToken: string };
  assert.notEqual(second.refreshToken, first.refreshToken);
  assert.equal(claims(second.refreshToken).jti === refresh.jti, false);
  assert.equal((await api('POST', '/api/auth/refresh', { refreshToken: first.refreshToken })).status, 401);
  assert.equal((await api('GET', '/api/auth/me', undefined, second.accessToken)).status, 200);
  assert.equal((await api('GET', '/api/auth/me', undefined, first.accessToken)).status, 200, 'an access token stays valid until it expires or the token version changes');

  const loggedOut = await api('POST', '/api/auth/logout', { refreshToken: second.refreshToken });
  assert.equal(loggedOut.status, 200, loggedOut.raw);
  assert.equal(loggedOut.body.data.loggedOut, true);
  assert.equal((await api('POST', '/api/auth/refresh', { refreshToken: second.refreshToken })).status, 401);

  const again = await api('POST', '/api/auth/login', { email: EMAIL, password });
  assert.equal(again.status, 200, again.raw);
  const session = again.body.data.tokens as { accessToken: string; refreshToken: string };
  assert.equal((await api('POST', '/api/auth/change-password', { currentPassword: 'wrong', newPassword: 'NewSessionPassw0rd!' })).status, 401);
  const wrong = await api('POST', '/api/auth/change-password', { currentPassword: 'wrong', newPassword: 'NewSessionPassw0rd!' }, session.accessToken);
  assert.equal(wrong.status, 400);
  const weak = await api('POST', '/api/auth/change-password', { currentPassword: password, newPassword: 'short' }, session.accessToken);
  assert.equal(weak.status, 400);

  const nextPassword = 'NewSessionPassw0rd!';
  const changed = await api('POST', '/api/auth/change-password', { currentPassword: password, newPassword: nextPassword }, session.accessToken);
  assert.equal(changed.status, 200, changed.raw);
  const fresh = changed.body.data.tokens as { accessToken: string; refreshToken: string };
  assert.equal(claims(fresh.accessToken).ver, 1);
  assert.equal((await api('GET', '/api/auth/me', undefined, session.accessToken)).status, 401, 'the previous access token is revoked');
  assert.equal((await api('POST', '/api/auth/refresh', { refreshToken: session.refreshToken })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { email: EMAIL, password })).status, 401);
  const signedIn = await api('POST', '/api/auth/login', { email: EMAIL, password: nextPassword });
  assert.equal(signedIn.status, 200, signedIn.raw);
  assert.equal((await api('GET', '/api/auth/me', undefined, fresh.accessToken)).status, 200);

  const afterChange = await savedUser();
  assert.match(afterChange.password_hash, /^scrypt\$/);
  assert.notEqual(afterChange.password_hash, hash);
  assert.equal(afterChange.token_version, 1);
});
