/**
 * Optional SSO. An identity-provider email can sign in only when that account
 * already exists. No user is created.
 *   npm run test:local -- tests/sso.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { pinTestDatabaseUrl, assertConnectedToTestDatabase, dropVerifiedTestSchema } from './helpers/test-db-guard.ts';
import pg from 'pg';

const DATABASE_URL = pinTestDatabaseUrl();
dotenv.config({ quiet: true });
const SCHEMA = `ops_sso_${process.pid}`;
const PORT = 5300 + (process.pid % 40);
const IDP_PORT = 5400 + (process.pid % 40);
const BASE = `http://127.0.0.1:${PORT}`;
const ISSUER = `http://127.0.0.1:${IDP_PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-sso-'));
const ADMIN = { email: 'sso-admin@example.com', password: 'SsoAdminPassw0rd!' };

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey & { kid: string; use: string; alg: string };
jwk.kid = 'test-key';
jwk.use = 'sig';
jwk.alg = 'RS256';

let nextEmail = ADMIN.email;
let nextKey = privateKey;
let savedNonce = '';

function sign(payload: Record<string, unknown>, key: crypto.KeyObject): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${body}`), key).toString('base64url');
  return `${header}.${body}.${sig}`;
}

const idp = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', ISSUER);
  if (url.pathname === '/.well-known/openid-configuration') {
    const doc = {
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(doc));
    return;
  }
  if (url.pathname === '/jwks') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
    return;
  }
  if (url.pathname === '/authorize') {
    savedNonce = url.searchParams.get('nonce') ?? '';
    const back = new URL(url.searchParams.get('redirect_uri') ?? '');
    back.searchParams.set('code', nextKey === privateKey ? 'good' : 'bad');
    back.searchParams.set('state', url.searchParams.get('state') ?? '');
    res.writeHead(302, { Location: back.toString() });
    res.end();
    return;
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const token = sign({
        iss: ISSUER,
        aud: 'ops-client',
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: savedNonce,
        email: nextEmail,
        email_verified: true,
      }, nextKey);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id_token: token, token_type: 'Bearer' }));
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

let server: ChildProcess | null = null;
let verified = false;
const pgc = new pg.Client({ connectionString: DATABASE_URL });

async function follow(start: string): Promise<{ status: number; location: string }> {
  const res = await fetch(start, { redirect: 'manual' });
  return { status: res.status, location: res.headers.get('location') ?? '' };
}

before(async () => {
  await new Promise<void>((resolve, reject) => idp.listen(IDP_PORT, '127.0.0.1', () => resolve()).on('error', reject));
  server = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    env: {
      ...process.env, DATABASE_URL, PORT: String(PORT), HOST: '127.0.0.1', DB_SCHEMA: SCHEMA, DATA_DIR, NODE_ENV: 'production',
      PUBLIC_URL: BASE, OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: 'ops-client', OIDC_CLIENT_SECRET: 'ops-secret', OIDC_ALLOW_INSECURE: '1',
      ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, HOSTINGER_API_TOKEN: '', CLOUDFLARE_API_TOKEN: '', DEADMAN_HEARTBEAT_URL: '',
      SMTP_SERVICE: '', SMTP_URL: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout?.on('data', d => { log += d; });
  server.stderr?.on('data', d => { log += d; });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ }
    if (i === 59) throw new Error(`server did not start:\n${log}`);
    await new Promise(r => setTimeout(r, 500));
  }
  await pgc.connect();
  await assertConnectedToTestDatabase(pgc);
  verified = true;
});

after(async () => {
  server?.kill();
  idp.close();
  await dropVerifiedTestSchema(verified, () => pgc.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined));
  await pgc.end().catch(() => undefined);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('SSO signs in an existing account and refuses an unknown email', async () => {
  const status = await fetch(`${BASE}/api/auth/oidc/status`);
  const statusBody = await status.json() as { data: { configured: boolean } };
  assert.equal(statusBody.data.configured, true);

  const start = await follow(`${BASE}/api/auth/oidc/start`);
  assert.equal(start.status, 302);
  assert.ok(start.location.startsWith(`${ISSUER}/authorize`));
  const idpHop = await follow(start.location);
  assert.equal(idpHop.status, 302);
  const callback = await follow(idpHop.location);
  assert.equal(callback.status, 302);
  const ticket = new URL(callback.location, BASE).searchParams.get('sso');
  assert.ok(ticket);

  const exchanged = await fetch(`${BASE}/api/auth/oidc/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }),
  });
  assert.equal(exchanged.status, 200);
  const session = await exchanged.json() as { data: { user: { email: string }; tokens: { accessToken: string } } };
  assert.equal(session.data.user.email, ADMIN.email);
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${session.data.tokens.accessToken}` } });
  assert.equal(me.status, 200);
  const again = await fetch(`${BASE}/api/auth/oidc/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }),
  });
  assert.equal(again.status, 401);

  nextEmail = 'nobody@example.com';
  const unknownStart = await follow(`${BASE}/api/auth/oidc/start`);
  const unknownIdp = await follow(unknownStart.location);
  const unknown = await follow(unknownIdp.location);
  assert.match(unknown.location, /sso_error=no_account/);

  nextEmail = ADMIN.email;
  nextKey = other.privateKey;
  const badStart = await follow(`${BASE}/api/auth/oidc/start`);
  const badIdp = await follow(badStart.location);
  const bad = await follow(badIdp.location);
  assert.match(bad.location, /sso_error=denied/);

  const adminLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
  });
  const admin = await adminLogin.json() as { data: { tokens: { accessToken: string } } };
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.data.tokens.accessToken}` };
  for (const roleName of ['viewer', 'operator'] as const) {
    const created = await fetch(`${BASE}/api/v1/users`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ email: `${roleName}@sso.test`, password: 'ViewerPassw0rd!', fullName: roleName, roleName }),
    });
    assert.equal(created.status, 201);
    const signed = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `${roleName}@sso.test`, password: 'ViewerPassw0rd!' }),
    });
    const token = (await signed.json() as { data: { tokens: { accessToken: string } } }).data.tokens.accessToken;
    const denied = await fetch(`${BASE}/api/v1/ops-backup/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'backup' }),
    });
    assert.equal(denied.status, 403);
  }
});
