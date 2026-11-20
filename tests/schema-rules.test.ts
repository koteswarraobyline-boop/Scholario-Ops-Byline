/**
 * Database rules from 001_init.sql and the retention jobs:
 * role and environment lists, 32-character hex Cloudflare ids, positive plan capacity,
 * check history 90 days, audit log 5000 entries, server metrics 48 hours.
 * Good rows stay. Bad rows are rejected or removed.
 * Throw-away schema in scholario_ops_ui_test only.
 *   npm run test:local -- tests/schema-rules.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pinTestDatabaseUrl, assertConnectedToTestDatabase, dropVerifiedTestSchema } from './helpers/test-db-guard.ts';

pinTestDatabaseUrl();
process.env.DB_SCHEMA = `ops_rules_${process.pid}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-rules-'));
process.env.HOSTINGER_API_TOKEN = '';
process.env.CLOUDFLARE_API_TOKEN = '';
process.env.CHECK_HISTORY_RETENTION_DAYS = '90';
process.env.AUDIT_RETENTION_ENTRIES = '5000';
process.env.METRICS_RETENTION_HOURS = '48';

const { config } = await import('../server/config.ts');
const { safeEqual } = await import('../server/auth.ts');
const { initStore, db, applyAuditRetention, pruneAuditLog, pruneServerMetrics, minuteMetrics } = await import('../server/store.ts');
const { pruneCheckHistory } = await import('../server/history.ts');
const { query, closePool, SCHEMA, T } = await import('../server/db.ts');

const id = () => crypto.randomUUID();
const pgCode = (err: unknown) => (err as { code?: string }).code;

let verified = false;
before(async () => {
  await assertConnectedToTestDatabase({ query: sql => query(sql) });
  verified = true;
  await initStore();
});
after(async () => {
  await dropVerifiedTestSchema(verified, () => query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {}));
  await closePool();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100).unref();
});

const TABLES = [
  'meta', 'users', 'refresh_tokens', 'servers', 'applications', 'application_load_balancers', 'monitors', 'monitor_buckets',
  'check_results', 'server_metrics', 'incidents', 'audit_logs', 'channels', 'escalation_policies', 'maintenance_windows',
  'runbooks', 'deployments', 'backups',
];

test('001_init creates the 18 tables, with configuration in typed columns and live state in jsonb', async () => {
  const names = (await query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2::text[]) ORDER BY table_name`,
    [SCHEMA, TABLES],
  )).rows.map(r => r.table_name);
  assert.deepEqual(names, [...TABLES].sort());
  const cols = (await query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema = $1 AND (table_name, column_name) IN (('servers','state'),('servers','plan_cpu_cores'),('applications','state'),('applications','tier'),('users','role_name'),('monitors','state'))`,
    [SCHEMA],
  )).rows;
  const typeOf = (table: string, column: string) => cols.find(c => c.table_name === table && c.column_name === column)?.data_type;
  assert.equal(typeOf('servers', 'plan_cpu_cores'), 'integer');
  assert.equal(typeOf('servers', 'state'), 'jsonb');
  assert.equal(typeOf('applications', 'tier'), 'text');
  assert.equal(typeOf('applications', 'state'), 'jsonb');
  assert.equal(typeOf('users', 'role_name'), 'text');
  assert.equal(typeOf('monitors', 'state'), 'jsonb');
});

test('agent and deployment token compare is constant-time for equal, different, and different-length values', () => {
  const token = 'a'.repeat(48);
  assert.equal(safeEqual(token, token), true);
  assert.equal(safeEqual(token, 'b'.repeat(48)), false);
  assert.equal(safeEqual(token, token.slice(0, 16)), false);
  assert.equal(safeEqual('', ''), true);
  assert.equal(safeEqual('short', 'a-much-longer-deployment-token'), false);
});

test('retention defaults are 90 days, 5000 audit entries and 48 hours', () => {
  assert.equal(config.checkHistoryRetentionDays, 90);
  assert.equal(config.auditRetention, 5000);
  assert.equal(config.metricsRetentionHours, 48);
});

test('database checks accept a valid role, environment, Cloudflare id and plan, and reject the rest', async () => {
  const userId = id();
  await query(`INSERT INTO ${T('users')} (id, email, full_name, role_name, password_hash) VALUES ($1, $2, 'Valid', 'viewer', 'x')`, [userId, `valid-${userId}@example.com`]);
  await assert.rejects(
    () => query(`INSERT INTO ${T('users')} (id, email, full_name, role_name, password_hash) VALUES ($1, $2, 'Bad', 'owner', 'x')`, [id(), `bad-${userId}@example.com`]),
    (err: unknown) => pgCode(err) === '23514',
  );

  const serverId = id();
  await query(
    `INSERT INTO ${T('servers')} (id, hostname, ip, environment, agent_token, plan_cpu_cores, plan_ram_gb, plan_disk_gb) VALUES ($1, $2, '192.0.2.10', 'PRD', $3, 2, 8, 100)`,
    [serverId, `good-${serverId}`, 'a'.repeat(48)],
  );
  await assert.rejects(
    () => query(`INSERT INTO ${T('servers')} (id, hostname, ip, environment, agent_token) VALUES ($1, $2, '192.0.2.11', 'STAGING', 'b')`, [id(), `env-${serverId}`]),
    (err: unknown) => pgCode(err) === '23514',
  );
  await assert.rejects(
    () => query(`INSERT INTO ${T('servers')} (id, hostname, ip, environment, agent_token, plan_cpu_cores, plan_ram_gb, plan_disk_gb) VALUES ($1, $2, '192.0.2.12', 'DR', 'c', 0, 8, 100)`, [id(), `cpu-${serverId}`]),
    (err: unknown) => pgCode(err) === '23514',
  );
  await assert.rejects(
    () => query(`INSERT INTO ${T('servers')} (id, hostname, ip, environment, agent_token, plan_cpu_cores, plan_ram_gb, plan_disk_gb) VALUES ($1, $2, '192.0.2.13', 'DR', 'd', 2, -1, 100)`, [id(), `ram-${serverId}`]),
    (err: unknown) => pgCode(err) === '23514',
  );
  await assert.rejects(
    () => query(`INSERT INTO ${T('servers')} (id, hostname, ip, environment, agent_token, plan_cpu_cores, plan_ram_gb, plan_disk_gb) VALUES ($1, $2, '192.0.2.14', 'DR', 'e', 2, 8, 0)`, [id(), `disk-${serverId}`]),
    (err: unknown) => pgCode(err) === '23514',
  );

  const appId = id();
  await query(`INSERT INTO ${T('applications')} (id, name, code_name, tier, rto_target_min, rpo_target_min) VALUES ($1, 'Rules', $2, 'TIER_1', 30, 15)`, [appId, `rules-${appId.slice(0, 8)}`]);
  const hex = (ch: string) => ch.repeat(32);
  await query(
    `INSERT INTO ${T('application_load_balancers')} (application_id, account_id, hostname, prd_pool_id, dr_pool_id) VALUES ($1, $2, 'app.example.com', $3, $4)`,
    [appId, hex('a'), hex('b'), hex('c')],
  );
  const otherApp = id();
  await query(`INSERT INTO ${T('applications')} (id, name, code_name, tier, rto_target_min, rpo_target_min) VALUES ($1, 'Rules 2', $2, 'TIER_2', 30, 15)`, [otherApp, `rules2-${otherApp.slice(0, 8)}`]);
  await assert.rejects(
    () => query(
      `INSERT INTO ${T('application_load_balancers')} (application_id, account_id, hostname, prd_pool_id, dr_pool_id) VALUES ($1, 'xyz', 'other.example.com', $2, $3)`,
      [otherApp, hex('d'), hex('e')],
    ),
    (err: unknown) => pgCode(err) === '23514',
  );
  await assert.rejects(
    () => query(
      `INSERT INTO ${T('application_load_balancers')} (application_id, account_id, hostname, prd_pool_id, dr_pool_id) VALUES ($1, $2, 'upper.example.com', $3, $4)`,
      [otherApp, 'A'.repeat(32), hex('d'), hex('e')],
    ),
    (err: unknown) => pgCode(err) === '23514',
  );
});

test('check history: a result from the last 90 days is kept, an older one is deleted', async () => {
  const recent = new Date(Date.now() - 89 * 86_400_000).toISOString();
  const expired = new Date(Date.now() - 91 * 86_400_000).toISOString();
  await query(
    `INSERT INTO ${T('check_results')} (t, monitor_id, environment, target, ok, probe_status, latency_ms) VALUES ($1, 'keep-check', 'PRD', 'https://keep.example/health', true, 'OK', 12), ($2, 'drop-check', 'PRD', 'https://old.example/health', false, 'DOWN', 1)`,
    [recent, expired],
  );
  const removed = await pruneCheckHistory();
  assert.ok(removed >= 1);
  const left = (await query(`SELECT monitor_id FROM ${T('check_results')} WHERE monitor_id IN ('keep-check', 'drop-check') ORDER BY monitor_id`)).rows.map(r => r.monitor_id);
  assert.deepEqual(left, ['keep-check']);
});

test('server metrics: a rollup from the last 48 hours is kept, an older one is deleted', async () => {
  const recent = new Date(Date.now() - 47 * 3600_000).toISOString();
  const expired = new Date(Date.now() - 49 * 3600_000).toISOString();
  const point = (t: string, cpu: number) => ({ t, cpu, ram: 1, disk: 1, load1: 0, netIn: 0, netOut: 0, swap: null, iowait: null, steal: null, diskRead: null, diskWrite: null, diskUtil: null });
  minuteMetrics['mem-server'] = [point(expired, 9), point(recent, 3)];
  await query(
    `INSERT INTO ${T('server_metrics')} (server_id, t, cpu, ram, disk, load1, net_in, net_out) VALUES ('keep-metric', $1, 3, 1, 1, 0, 0, 0), ('drop-metric', $2, 9, 1, 1, 0, 0, 0)`,
    [recent, expired],
  );
  const removed = await pruneServerMetrics();
  assert.ok(removed >= 1);
  const left = (await query(`SELECT server_id FROM ${T('server_metrics')} WHERE server_id IN ('keep-metric', 'drop-metric') ORDER BY server_id`)).rows.map(r => r.server_id);
  assert.deepEqual(left, ['keep-metric']);
  assert.deepEqual(minuteMetrics['mem-server'].map(p => p.cpu), [3]);
});

test('audit log: the newest 5000 entries are kept and the older ones are deleted', async () => {
  const keepId = id();
  const dropId = id();
  await query(`INSERT INTO ${T('audit_logs')} (id, ts, operator, action, category, target_id, details) VALUES ($1, now(), 't', 'KEEP', 'AUTH', '', 'good')`, [keepId]);
  await query(
    `INSERT INTO ${T('audit_logs')} (id, ts, operator, action, category, target_id, details)
     SELECT gen_random_uuid(), now() - (g || ' seconds')::interval, 't', 'FILL', 'AUTH', '', 'fill' FROM generate_series(1, 4999) g`,
  );
  await query(`INSERT INTO ${T('audit_logs')} (id, ts, operator, action, category, target_id, details) VALUES ($1, now() - interval '40 days', 't', 'DROP', 'AUTH', '', 'old')`, [dropId]);
  const before = (await query(`SELECT count(*)::int n FROM ${T('audit_logs')}`)).rows[0].n as number;
  assert.ok(before > 5000, `expected more than 5000 rows, found ${before}`);
  const removed = await pruneAuditLog();
  assert.ok(removed >= 1);
  assert.equal((await query(`SELECT count(*)::int n FROM ${T('audit_logs')}`)).rows[0].n, 5000);
  assert.equal((await query(`SELECT count(*)::int n FROM ${T('audit_logs')} WHERE id = $1`, [keepId])).rows[0].n, 1);
  assert.equal((await query(`SELECT count(*)::int n FROM ${T('audit_logs')} WHERE id = $1`, [dropId])).rows[0].n, 0);

  const saved = db.auditLogs;
  try {
    const newest = { id: 'newest', timestamp: new Date().toISOString(), operator: 't', action: 'A', category: 'AUTH' as const, targetId: '', details: 'good' };
    const oldest = { ...newest, id: 'oldest', timestamp: new Date(0).toISOString(), details: 'old' };
    const fillers = Array.from({ length: 4999 }, (_, i) => ({ ...newest, id: `fill-${i}`, timestamp: new Date(Date.now() - (i + 1) * 1000).toISOString() }));
    db.auditLogs = [newest, ...fillers, oldest];
    assert.equal(applyAuditRetention(), true);
    assert.equal(db.auditLogs.length, 5000);
    assert.equal(db.auditLogs[0].id, 'newest');
    assert.equal(db.auditLogs.some(a => a.id === 'oldest'), false);
    db.auditLogs = [newest, oldest];
    assert.equal(applyAuditRetention(), false);
    assert.deepEqual(db.auditLogs.map(a => a.id), ['newest', 'oldest']);
  } finally {
    db.auditLogs = saved;
  }
});
