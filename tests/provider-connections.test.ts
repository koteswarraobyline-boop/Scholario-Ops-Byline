/**
 * Multi-account Hostinger connections. Provider HTTP is mocked. No real token and no real API call.
 * Database: scholario_ops_ui_test only, throw-away schema, dropped afterwards.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import { pinTestDatabaseUrl, assertConnectedToTestDatabase, dropVerifiedTestSchema } from './helpers/test-db-guard.ts';

pinTestDatabaseUrl();
process.env.DB_SCHEMA = `ops_provtest_${process.pid}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-provtest-'));
process.env.JWT_SECRET = 'provtest-jwt-secret-value-0123456789abcdef';
process.env.HOSTINGER_TIMEOUT_MS = '800';
process.env.HOSTINGER_API_TOKEN = 'provtest-legacy-token-aaa';
process.env.HOSTINGER_DR_API_TOKEN = 'provtest-dr-token-bbb';
process.env.CLOUDFLARE_API_TOKEN = '';

const LEGACY = 'provtest-legacy-token-aaa';
const DR = 'provtest-dr-token-bbb';
const SECRETS = [LEGACY, DR];

type Mode = 'ok' | 'auth' | 'ratelimit' | 'body' | 'hold' | 'one';
const mode: Record<'legacy' | 'dr', Mode> = { legacy: 'ok', dr: 'ok' };
let vmCalls = 0;
let hold: Promise<void> | null = null;
let releaseHold: (() => void) | null = null;
const seenAuth = new Set<string>();
const realFetch = globalThis.fetch;

function accountOf(init?: RequestInit): 'legacy' | 'dr' | 'other' {
  const auth = new Headers(init?.headers).get('authorization') ?? '';
  if (auth === `Bearer ${LEGACY}`) return 'legacy';
  if (auth === `Bearer ${DR}`) return 'dr';
  return 'other';
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith('https://developers.hostinger.com/')) return realFetch(input, init);
  const account = accountOf(init);
  if (account === 'other') return new Response('{"message":"Unauthenticated."}', { status: 401 });
  seenAuth.add(account);
  const current = mode[account];
  if (url.endsWith('/virtual-machines')) {
    vmCalls++;
    if (current === 'hold' && hold) await hold;
    if (current === 'auth') return new Response('{"message":"Unauthenticated."}', { status: 401 });
    if (current === 'body') return new Response(JSON.stringify({ leaked: DR, message: 'nope' }), { status: 500 });
    if (current === 'ratelimit' && vmCalls === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '1' } });
  } else if (current === 'auth') {
    return new Response('{"message":"Unauthenticated."}', { status: 401 });
  }
  if (url.endsWith('/data-centers')) {
    return Response.json([{ id: 17, name: 'in-mum', city: 'Mumbai', location: 'in' }, { id: 3, city: 'Frankfurt', location: 'de' }]);
  }
  if (account === 'dr') {
    return Response.json([
      { id: 2001, hostname: 'backup', state: 'running', cpus: 2, memory: 4096, disk: 81920, plan: 'DR-PLAN', ipv4: [{ address: '198.51.100.30' }], ipv6: [{ address: '2001:db8::30' }], template: { name: 'Debian 12' }, data_center_id: 3 },
      { id: 2002, hostname: 'same-ip', state: 'running', cpus: 1, memory: 2048, disk: 40960, plan: 'OTHER', ipv4: [{ address: '198.51.100.10' }], template: { name: 'Debian 12' }, data_center_id: 3 },
    ]);
  }
  const both = [
    { id: 1001, hostname: 'srv-prd', state: 'running', cpus: 8, memory: 32768, disk: 409600, plan: 'KVM 8', ipv4: [{ address: '198.51.100.10' }], template: { name: 'Ubuntu 24.04' }, data_center_id: 17 },
    { id: 1002, hostname: 'srv-dr', state: 'stopped', cpus: 2, memory: 8192, disk: 102400, plan: 'KVM 2', ipv4: [{ address: '198.51.100.20' }], template: { name: 'Ubuntu 24.04' }, data_center_id: 99 },
  ];
  return Response.json(current === 'one' ? both.slice(0, 1) : both);
}) as typeof fetch;

const { initStore, db, flush, saveState } = await import('../server/store.ts');
const { query, closePool, SCHEMA, T } = await import('../server/db.ts');
const { buildRouter } = await import('../server/routes.ts');
const { hashPassword, issueTokens } = await import('../server/auth.ts');
const { syncConnection, syncEnabledConnections } = await import('../server/providers/sync.ts');
const { isAllowedTokenEnv } = await import('../server/providers/env.ts');
const { hostingerState } = await import('../server/hostinger.ts');

function noSecrets(text: string) {
  for (const secret of SECRETS) assert.equal(text.includes(secret), false, 'a token value was exposed');
}

let server: Server;
let base = '';
let admin = '';
let operator = '';
let viewer = '';
let verified = false;

async function call(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  noSecrets(text);
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  return { status: res.status, text, json: json as { success?: boolean; message?: string; data?: unknown; connections?: unknown } };
}

before(async () => {
  await assertConnectedToTestDatabase({ query: sql => query(sql) });
  verified = true;
  await initStore();
  const add = (email: string, roleName: 'it_administrator' | 'operator' | 'viewer') => {
    const user = {
      id: crypto.randomUUID(), email, fullName: roleName, roleName, isActive: true, isOnCall: false,
      passwordHash: hashPassword('ProvTestPassw0rd!'), tokenVersion: 0, createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    return issueTokens(user).accessToken;
  };
  admin = add('prov-admin@example.com', 'it_administrator');
  operator = add('prov-operator@example.com', 'operator');
  viewer = add('prov-viewer@example.com', 'viewer');
  const app = express();
  app.use(express.json());
  app.use('/api', buildRouter());
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
});

after(async () => {
  server?.close();
  await dropVerifiedTestSchema(verified, () => query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {}));
  await closePool();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
});

describe('provider connections', { concurrency: false }, () => {
test('environment variable names are constrained to Hostinger token variables', () => {
  assert.equal(isAllowedTokenEnv('HOSTINGER_API_TOKEN'), true);
  assert.equal(isAllowedTokenEnv('HOSTINGER_PRODUCTION_API_TOKEN'), true);
  assert.equal(isAllowedTokenEnv('HOSTINGER_DR_API_TOKEN'), true);
  assert.equal(isAllowedTokenEnv('JWT_SECRET'), false);
  assert.equal(isAllowedTokenEnv('DATABASE_URL'), false);
  assert.equal(isAllowedTokenEnv('DIGITALOCEAN_PRODUCTION_API_TOKEN'), false);
  assert.equal(isAllowedTokenEnv('HOSTINGER_dr_API_TOKEN'), false);
});

test('adding a connection rejects other providers, unsafe variable names, and pasted tokens', async () => {
  const digital = await call('POST', '/v1/providers/connections', admin, { name: 'DO', provider: 'digitalocean', tokenEnv: 'HOSTINGER_DR_API_TOKEN' });
  assert.equal(digital.status, 400);
  const jwt = await call('POST', '/v1/providers/connections', admin, { name: 'Bad', provider: 'hostinger', tokenEnv: 'JWT_SECRET' });
  assert.equal(jwt.status, 400);
  const pasted = await call('POST', '/v1/providers/connections', admin, { name: 'Pasted', provider: 'hostinger', tokenEnv: 'HOSTINGER_DR_API_TOKEN', token: DR });
  assert.equal(pasted.status, 400);
  assert.equal(JSON.stringify(db.providerConnections).includes(DR), false);
  assert.equal(db.auditLogs.some(a => a.details.includes(DR) || a.details.includes(LEGACY)), false);
});

test('two Hostinger accounts stay separate, and only the built-in account enriches servers', async () => {
  const created = await call('POST', '/v1/providers/connections', admin, { name: 'Hostinger DR', provider: 'hostinger', tokenEnv: 'HOSTINGER_DR_API_TOKEN' });
  assert.equal(created.status, 201);
  const dr = created.json.data as { id: string; tokenConfigured: boolean; tokenEnv: string; legacy: boolean };
  assert.equal(dr.tokenConfigured, true);
  assert.equal(dr.tokenEnv, 'HOSTINGER_DR_API_TOKEN');
  assert.equal(dr.legacy, false);
  const dupName = await call('POST', '/v1/providers/connections', admin, { name: 'hostinger dr', provider: 'hostinger', tokenEnv: 'HOSTINGER_BACKUP_API_TOKEN' });
  assert.equal(dupName.status, 400);
  const dupEnv = await call('POST', '/v1/providers/connections', admin, { name: 'Other', provider: 'hostinger', tokenEnv: 'HOSTINGER_DR_API_TOKEN' });
  assert.equal(dupEnv.status, 400);
  const viewerCreate = await call('POST', '/v1/providers/connections', viewer, { name: 'Nope', provider: 'hostinger', tokenEnv: 'HOSTINGER_BACKUP_API_TOKEN' });
  assert.equal(viewerCreate.status, 403);
  const operatorCreate = await call('POST', '/v1/providers/connections', operator, { name: 'Nope', provider: 'hostinger', tokenEnv: 'HOSTINGER_BACKUP_API_TOKEN' });
  assert.equal(operatorCreate.status, 403);

  const srv = {
    id: crypto.randomUUID(), hostname: 'manual-box', ip: '198.51.100.10', applicationId: '', environment: 'PRD' as const,
    provider: 'Manual', region: 'kept-region', plan: 'manual-plan', notes: 'keep-me', os: 'kept-os',
    cpuCores: 0, ramGb: 0, diskGb: 0, status: 'UNKNOWN' as const, agentVersion: '', agentStatus: 'DISCONNECTED' as const,
    uptimeDays: 0, lastSeen: '', telemetry: { cpuPercent: 0, ramPercent: 0, diskPercent: 0, loadAvg: [0, 0, 0], networkInKbps: 0, networkOutKbps: 0, observedAt: '', receivedAt: '' },
    processes: [], services: [], logs: [], agentToken: 'agent-secret-should-not-matter', createdAt: new Date().toISOString(),
  };
  db.servers.push(srv);

  const drSync = await call('POST', `/v1/providers/connections/${dr.id}/sync`, operator);
  assert.equal(drSync.status, 200);
  assert.equal(srv.plan, 'manual-plan');
  assert.equal(srv.notes, 'keep-me');
  assert.equal(srv.provider, 'Manual');
  assert.equal(srv.hostinger, undefined);
  const drRows = db.providerInstances.filter(i => i.connectionId === dr.id && !i.absent);
  assert.equal(drRows.length, 2);
  assert.equal(drRows.find(i => i.providerVmId === '2001')?.ipv6[0], '2001:db8::30');
  assert.equal(drRows.find(i => i.providerVmId === '2001')?.region, 'Frankfurt, de');

  const legacySync = await call('POST', '/v1/hostinger/sync', operator);
  assert.equal(legacySync.status, 200);
  assert.equal(hostingerState.status, 'OK');
  assert.equal(srv.plan, 'KVM 8');
  assert.equal(srv.planSpec?.source, 'hostinger');
  assert.equal(srv.notes, 'keep-me');
  assert.equal(srv.os, 'kept-os');
  const legacy = db.providerConnections.find(c => c.legacy)!;
  const legacyRows = db.providerInstances.filter(i => i.connectionId === legacy.id && !i.absent);
  assert.equal(legacyRows.length, 2);
  assert.equal(legacyRows.find(i => i.providerVmId === '1001')?.id, legacyRows.find(i => i.providerVmId === '1001')?.id);
  const firstId = legacyRows.find(i => i.providerVmId === '1001')!.id;
  await call('POST', '/v1/hostinger/sync', operator);
  assert.equal(db.providerInstances.filter(i => i.connectionId === legacy.id && i.providerVmId === '1001').length, 1);
  assert.equal(db.providerInstances.find(i => i.connectionId === legacy.id && i.providerVmId === '1001')!.id, firstId);
  assert.equal(db.providerInstances.filter(i => i.providerVmId === '1001').length, 1);
  assert.equal(db.providerInstances.filter(i => i.providerVmId === '2002').length, 1);

  const again = await call('POST', `/v1/providers/connections/${dr.id}/sync`, operator);
  assert.equal(again.status, 200);
  assert.equal(srv.plan, 'KVM 8', 'the second account must not overwrite the built-in account');
  assert.equal(srv.notes, 'keep-me');

  const listed = await call('GET', '/v1/hostinger/vms', viewer);
  assert.equal(listed.status, 200);
  const ids = (listed.json.data as Array<{ vmId: number }>).map(v => v.vmId).sort();
  assert.deepEqual(ids, [1001, 1002]);
});

test('a failed account does not wipe the other, and a missing VM is kept as absent', async () => {
  const dr = db.providerConnections.find(c => c.tokenEnv === 'HOSTINGER_DR_API_TOKEN')!;
  const before = db.providerInstances.filter(i => i.connectionId === dr.id).map(i => i.id).sort();
  mode.dr = 'auth';
  const logs: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => { logs.push(String(chunk)); return true; }) as typeof process.stderr.write;
  const failed = await call('POST', '/v1/providers/sync', operator);
  process.stderr.write = write;
  noSecrets(logs.join('\n'));
  assert.equal(failed.status, 200);
  const results = failed.json.data as Array<{ name: string; ok: boolean; message?: string }>;
  assert.equal(results.find(r => r.name === 'Hostinger DR')?.ok, false);
  assert.equal(results.find(r => r.name === 'Hostinger')?.ok, true);
  assert.equal(dr.status, 'AUTH_FAILED');
  assert.equal(db.providerInstances.filter(i => i.connectionId === dr.id).map(i => i.id).sort().join(), before.join());
  assert.equal(db.providerInstances.some(i => i.connectionId === dr.id && i.absent), false);
  const legacy = db.providerConnections.find(c => c.legacy)!;
  assert.equal(legacy.status, 'OK');

  mode.legacy = 'one';
  mode.dr = 'ok';
  await syncConnection(legacy.id, { manual: true });
  const gone = db.providerInstances.find(i => i.connectionId === legacy.id && i.providerVmId === '1002')!;
  assert.equal(gone.absent, true);
  assert.equal(db.servers.some(s => s.hostname === 'manual-box'), true);
  const drStill = db.providerInstances.filter(i => i.connectionId === dr.id && !i.absent);
  assert.equal(drStill.length, 2);
  mode.legacy = 'ok';
});

test('rate limits retry once, overlapping syncs share one request, and error bodies are dropped', async () => {
  const dr = db.providerConnections.find(c => c.tokenEnv === 'HOSTINGER_DR_API_TOKEN')!;
  mode.dr = 'ratelimit';
  vmCalls = 0;
  await syncConnection(dr.id, { manual: true });
  assert.equal(dr.status, 'OK');
  assert.ok(vmCalls >= 2);

  mode.legacy = 'hold';
  const legacy = db.providerConnections.find(c => c.legacy)!;
  vmCalls = 0;
  hold = new Promise<void>(r => { releaseHold = r; });
  const first = syncConnection(legacy.id);
  const second = syncConnection(legacy.id);
  assert.equal(first, second, 'a second sync joins the one already running');
  releaseHold!();
  await first;
  assert.equal(vmCalls, 1);
  mode.legacy = 'ok';
  hold = null;

  mode.dr = 'body';
  const logs: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => { logs.push(String(chunk)); return true; }) as typeof process.stderr.write;
  const res = await call('POST', `/v1/providers/connections/${dr.id}/sync`, operator);
  process.stderr.write = write;
  assert.equal(res.status, 502);
  assert.equal(res.text.includes('leaked'), false);
  noSecrets(logs.join('\n'));
  noSecrets(db.auditLogs.map(a => a.details).join('\n'));
  assert.equal(dr.status, 'ERROR');
  mode.dr = 'ok';
});

test('filters combine, a missing token is reported without a value, and rows survive a reload', async () => {
  const missing = await call('POST', '/v1/providers/connections', admin, { name: 'Hostinger Staging', provider: 'hostinger', tokenEnv: 'HOSTINGER_STAGING_API_TOKEN' });
  assert.equal(missing.status, 201);
  const staging = missing.json.data as { id: string; tokenConfigured: boolean; displayStatus: string };
  assert.equal(staging.tokenConfigured, false);
  assert.equal(staging.displayStatus, 'NOT_CONFIGURED');
  const syncMissing = await call('POST', `/v1/providers/connections/${staging.id}/sync`, operator);
  assert.equal(syncMissing.status, 400);
  assert.match(syncMissing.json.message ?? '', /HOSTINGER_STAGING_API_TOKEN/);
  assert.match(syncMissing.json.message ?? '', /restart/);

  const dr = db.providerConnections.find(c => c.tokenEnv === 'HOSTINGER_DR_API_TOKEN')!;
  mode.dr = 'ok';
  await syncConnection(dr.id, { manual: true });
  assert.equal(dr.status, 'OK');
  const combined = await call('GET', `/v1/providers/instances?provider=hostinger&connectionId=${dr.id}&connectionStatus=CONNECTED&region=${encodeURIComponent('Frankfurt, de')}&status=HEALTHY&q=backup`, viewer);
  assert.equal(combined.status, 200);
  const rows = combined.json.data as Array<{ providerVmId: string; connectionId: string }>;
  assert.deepEqual(rows.map(r => r.providerVmId), ['2001']);
  const cleared = await call('GET', '/v1/providers/instances?provider=digitalocean', viewer);
  assert.equal((cleared.json.data as unknown[]).length, 0);

  const renamed = await call('PATCH', `/v1/providers/connections/${dr.id}`, admin, { name: 'Hostinger Disaster Recovery' });
  assert.equal(renamed.status, 200);
  const disabled = await call('PATCH', `/v1/providers/connections/${staging.id}`, admin, { syncEnabled: false });
  assert.equal(disabled.status, 200);
  vmCalls = 0;
  mode.dr = 'auth';
  const before = vmCalls;
  await syncEnabledConnections();
  assert.ok(vmCalls > before, 'enabled accounts still sync');
  const stagingAfter = db.providerConnections.find(c => c.id === staging.id)!;
  assert.equal(stagingAfter.status, 'NOT_CONFIGURED');
  mode.dr = 'ok';

  const saved = await flush();
  if (!saved) assert.fail(saveState().failure?.message ?? 'save failed');
  const stored = await query<{ token_env: string }>(`SELECT token_env FROM ${T('provider_connections')}`);
  const names = stored.rows.map(r => r.token_env).sort();
  assert.deepEqual(names, ['HOSTINGER_API_TOKEN', 'HOSTINGER_DR_API_TOKEN', 'HOSTINGER_STAGING_API_TOKEN']);
  const dump = JSON.stringify(stored.rows);
  noSecrets(dump);
  const instances = await query<{ n: string }>(`SELECT count(*)::text AS n FROM ${T('provider_instances')}`);
  assert.ok(Number(instances.rows[0].n) >= 4);
  const dup = await query<{ n: string }>(`SELECT count(*)::text AS n FROM (SELECT connection_id, provider_vm_id FROM ${T('provider_instances')} GROUP BY 1, 2 HAVING count(*) > 1) d`);
  assert.equal(dup.rows[0].n, '0');
});
});
