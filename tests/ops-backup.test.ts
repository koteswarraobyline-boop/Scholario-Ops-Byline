/**
 * Scholario Ops' own database backup:
 *   • opsBackupHealth() rules over the status files (no database needed)
 *   • deploy/backup-db.sh + deploy/verify-backup.sh end to end against a throw-away schema with the
 *     real pg_dump / psql (skipped when bash or a matching pg_dump / psql is not available):
 *     dump → integrity → row counts → gpg encryption → checksum → off-server copy failure reported →
 *     restore test into a separate scratch database → refusal to restore into production →
 *     corruption detected.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });
const { opsBackupHealth } = await import('../server/opsBackup.ts');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-opsbackup-'));
const cleanups: Array<() => Promise<void> | void> = [() => fs.rmSync(tmpRoot, { recursive: true, force: true })];
after(async () => { for (const c of cleanups.reverse()) { try { await c(); } catch { /* best effort */ } } });

const HOUR = 3_600_000;
function dirWith(files: Record<string, unknown>) {
  const d = fs.mkdtempSync(path.join(tmpRoot, 'st-'));
  for (const [name, v] of Object.entries(files)) fs.writeFileSync(path.join(d, name), typeof v === 'string' ? v : JSON.stringify(v));
  return d;
}
const run = (over: Record<string, unknown> = {}) => ({
  status: 'SUCCESS', error: null, startedAt: new Date(Date.now() - 2 * HOUR).toISOString(), completedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
  file: 'ops-1.sql.gz.age', sizeBytes: 1000, sha256: 'ab'.repeat(32), encryption: 'age', retentionDays: 14, tables: { 'ops.servers': 2 },
  offsite: { target: 'backup@dr:/b', ok: true, error: null }, ...over,
});
const restore = (over: Record<string, unknown> = {}) => ({ status: 'VERIFIED', error: null, testedAt: new Date(Date.now() - 24 * HOUR).toISOString(), durationSec: 3, file: 'ops-1.sql.gz.age', tables: {}, ...over });

// ── Scripts end to end ──────────────────────────────────────────────────────
const BASH = process.platform === 'win32'
  ? ['C:\\Program Files\\Git\\bin\\bash.exe'].find(p => fs.existsSync(p))
  : 'bash';
const PG_BIN = process.platform === 'win32'
  ? ['18', '17', '16'].map(v => `C:\\Program Files\\PostgreSQL\\${v}\\bin`).find(p => fs.existsSync(p))
  : undefined;
const PATH_ENV = PG_BIN ? `${PG_BIN}${path.delimiter}${process.env.PATH}` : process.env.PATH;
const DATABASE_URL = process.env.DATABASE_URL;

function clientMajor(tool: string): number | null {
  const r = spawnSync(tool, ['--version'], { env: { ...process.env, PATH: PATH_ENV }, encoding: 'utf8', shell: false });
  const m = /(\d+)(?:\.\d+)/.exec(r.stdout ?? '');
  return r.status === 0 && m ? Number(m[1]) : null;
}

let skipReason: string | false = false;
let pool: pg.Pool | null = null;
let serverMajor = 0;
if (!BASH) skipReason = 'bash not found';
else if (!DATABASE_URL) skipReason = 'DATABASE_URL not set';
else {
  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  cleanups.push(() => pool!.end());
  try {
    serverMajor = Math.floor(Number((await pool.query('show server_version_num')).rows[0].server_version_num) / 10000);
    const dumpMajor = clientMajor('pg_dump'), psqlMajor = clientMajor('psql');
    if (!dumpMajor || !psqlMajor) skipReason = 'pg_dump / psql not installed';
    else if (dumpMajor < serverMajor) skipReason = `pg_dump ${dumpMajor} is older than the server (${serverMajor})`;
  } catch (e) { skipReason = `database unreachable: ${(e as Error).message}`; }
}

function bash(script: string, appDir: string, env: Record<string, string> = {}, args: string[] = []) {
  const r = spawnSync(BASH as string, [path.join(process.cwd(), 'deploy', script), ...args], {
    env: { ...process.env, PATH: PATH_ENV, APP_DIR: appDir, ...env }, encoding: 'utf8', timeout: 120_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
const readJson = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const withDb = (url: string, dbName: string) => { const u = new URL(url); u.pathname = `/${dbName}`; return u.toString(); };

test('backup-db.sh + verify-backup.sh end to end (real pg_dump / psql, throw-away schema)', { skip: skipReason }, async t => {
  const schema = `bkt_${process.pid}`;
  await pool!.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema};
    CREATE TABLE ${schema}.servers (id text primary key, note text);
    CREATE TABLE ${schema}.empty_table (id int);
    INSERT INTO ${schema}.servers VALUES ('a', 'tab\there'), ('b', E'multi\\nline'), ('c', null);`);
  cleanups.push(() => pool!.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).then(() => undefined));

  const appDir = fs.mkdtempSync(path.join(tmpRoot, 'app-'));
  fs.writeFileSync(path.join(appDir, '.env'), `DATABASE_URL="${DATABASE_URL}"\nDB_SCHEMA=${schema}\n`);
  const backups = path.join(appDir, 'backups');

  // 1. Plain backup + an unreachable off-server target: local backup good (exit 0), copy failure reported
  const r1 = bash('backup-db.sh', appDir, { BACKUP_REMOTE: 'backup@127.0.0.1:/var/backups/ops', BACKUP_SSH_PORT: '1' });
  assert.equal(r1.code, 0, r1.out);
  const s1 = readJson(path.join(backups, 'last-backup.json'));
  assert.equal(s1.status, 'SUCCESS');
  assert.equal(s1.encryption, 'none');
  assert.deepEqual(s1.tables, { [`${schema}.servers`]: 3, [`${schema}.empty_table`]: 0 });
  assert.match(s1.sha256, /^[0-9a-f]{64}$/);
  assert.equal(s1.offsite.ok, false); assert.ok(s1.offsite.error, 'reason recorded');
  assert.ok(fs.existsSync(path.join(backups, `${s1.file}.sha256`)));
  assert.equal(fs.readdirSync(backups).filter(f => f.endsWith('.partial')).length, 0, 'no temp files left');
  assert.equal(opsBackupHealth(Date.now(), backups).status, 'DEGRADED', 'the app flags the failed off-server copy');

  // Malformed remote: refused before any ssh call
  const r1b = bash('backup-db.sh', appDir, { BACKUP_REMOTE: "x@host:/tmp/a';reboot;'" });
  assert.equal(r1b.code, 0, r1b.out);
  assert.match(readJson(path.join(backups, 'last-backup.json')).offsite.error, /must look like/);

  // 2. Wrong schema → no tables → FAILED status, exit 1
  const badDir = fs.mkdtempSync(path.join(tmpRoot, 'bad-'));
  fs.writeFileSync(path.join(badDir, '.env'), `DATABASE_URL="${DATABASE_URL}"\nDB_SCHEMA=no_such_schema_${process.pid}\n`);
  const r2 = bash('backup-db.sh', badDir);
  assert.equal(r2.code, 1, r2.out);
  const s2 = readJson(path.join(badDir, 'backups', 'last-backup.json'));
  assert.equal(s2.status, 'FAILED'); assert.ok(s2.error);
  assert.equal(opsBackupHealth(Date.now(), path.join(badDir, 'backups')).status, 'FAILED');

  // 3. Restore test: refuses the production database
  const r3 = bash('verify-backup.sh', appDir, { BACKUP_VERIFY_DATABASE_URL: DATABASE_URL! });
  assert.equal(r3.code, 1, r3.out);
  assert.match(readJson(path.join(backups, 'last-restore-test.json')).error, /different database/);

  // A scratch database (needs CREATEDB; otherwise the restore part is skipped)
  const scratch = `ops_restore_test_${process.pid}`;
  try { await pool!.query(`CREATE DATABASE ${scratch}`); } catch (e) { t.diagnostic(`restore part skipped: ${(e as Error).message}`); return; }
  cleanups.push(() => pool!.query(`DROP DATABASE IF EXISTS ${scratch}`).then(() => undefined));
  const scratchUrl = withDb(DATABASE_URL!, scratch);

  const r4 = bash('verify-backup.sh', appDir, { BACKUP_VERIFY_DATABASE_URL: scratchUrl });
  assert.equal(r4.code, 0, r4.out);
  const v4 = readJson(path.join(backups, 'last-restore-test.json'));
  assert.equal(v4.status, 'VERIFIED');
  assert.deepEqual(v4.tables[`${schema}.servers`], { expected: 3, restored: 3 });
  const left = await new pg.Pool({ connectionString: scratchUrl, max: 1 });
  try {
    assert.equal((await left.query(`select count(*)::int n from pg_namespace where nspname = $1`, [schema])).rows[0].n, 0, 'restored schema dropped again');
  } finally { await left.end(); }

  // 4. Corruption is caught by the checksum
  const file = path.join(backups, s1.file);
  const bytes = fs.readFileSync(file); bytes[bytes.length - 20] ^= 0xff; fs.writeFileSync(file, bytes);
  const r5 = bash('verify-backup.sh', appDir, { BACKUP_VERIFY_DATABASE_URL: scratchUrl }, [file]);
  assert.equal(r5.code, 1, r5.out);
  assert.match(readJson(path.join(backups, 'last-restore-test.json')).error, /checksum mismatch/);

  // 5. gpg: encrypted with the public key, restore test decrypts with the secret key
  const gpgVersion = spawnSync(BASH as string, ['-c', 'gpg --version'], { encoding: 'utf8' });
  if (gpgVersion.status !== 0) { t.diagnostic('gpg part skipped: gpg not installed'); return; }
  const gnupg = fs.mkdtempSync(path.join(tmpRoot, 'gnupg-'));
  const gnupgPosix = spawnSync(BASH as string, ['-c', `cygpath -u '${gnupg}' 2>/dev/null || echo '${gnupg}'`], { encoding: 'utf8' }).stdout.trim();
  const gen = spawnSync(BASH as string, ['-c', 'gpg --batch --passphrase "" --quick-gen-key ops-backup-test@example.invalid default default never'], { env: { ...process.env, GNUPGHOME: gnupgPosix }, encoding: 'utf8' });
  assert.equal(gen.status, 0, gen.stderr);
  const r6 = bash('backup-db.sh', appDir, { GNUPGHOME: gnupgPosix, BACKUP_GPG_RECIPIENT: 'ops-backup-test@example.invalid' });
  assert.equal(r6.code, 0, r6.out);
  const s6 = readJson(path.join(backups, 'last-backup.json'));
  assert.equal(s6.encryption, 'gpg'); assert.match(s6.file, /\.sql\.gz\.gpg$/);
  assert.notEqual(fs.readFileSync(path.join(backups, s6.file)).subarray(0, 2).toString('hex'), '1f8b', 'not a plain gzip file');
  const r7 = bash('verify-backup.sh', appDir, { GNUPGHOME: gnupgPosix, BACKUP_VERIFY_DATABASE_URL: scratchUrl });
  assert.equal(r7.code, 0, r7.out);
  assert.equal(readJson(path.join(backups, 'last-restore-test.json')).file, s6.file, 'newest (encrypted) backup tested');
  assert.equal(opsBackupHealth(Date.now(), backups).status, 'HEALTHY');
});

test('ops backup health: not configured, healthy, failed, stale, off-server failure, restore test, advisories, unreadable file', () => {
  assert.equal(opsBackupHealth(Date.now(), dirWith({})).status, 'NOT_CONFIGURED');

  const ok = opsBackupHealth(Date.now(), dirWith({ 'last-backup.json': run(), 'last-restore-test.json': restore() }));
  assert.equal(ok.status, 'HEALTHY'); assert.deepEqual(ok.problems, []); assert.deepEqual(ok.advisories, []);
  assert.equal(ok.ageHours, 2);

  const failed = opsBackupHealth(Date.now(), dirWith({ 'last-backup.json': run({ status: 'FAILED', error: 'pg_dump failed' }) }));
  assert.equal(failed.status, 'FAILED'); assert.match(failed.problems[0], /pg_dump failed/);

  const stale = opsBackupHealth(Date.now(), dirWith({ 'last-backup.json': run({ completedAt: new Date(Date.now() - 50 * HOUR).toISOString() }) }));
  assert.equal(stale.status, 'STALE');

  const offsite = opsBackupHealth(Date.now(), dirWith({ 'last-backup.json': run({ offsite: { target: 'backup@dr:/b', ok: false, error: 'ssh refused' } }), 'last-restore-test.json': restore() }));
  assert.equal(offsite.status, 'DEGRADED'); assert.match(offsite.problems.join(), /ssh refused/);

  const badRestore = opsBackupHealth(Date.now(), dirWith({ 'last-backup.json': run(), 'last-restore-test.json': restore({ status: 'FAILED', error: 'row counts differ' }) }));
  assert.equal(badRestore.status, 'DEGRADED'); assert.match(badRestore.problems.join(), /row counts differ/);

  const plain = opsBackupHealth(Date.now(), dirWith({ 'last-backup.json': run({ encryption: 'none', offsite: null }), 'last-restore-test.json': restore({ testedAt: new Date(Date.now() - 20 * 24 * HOUR).toISOString() }) }));
  assert.equal(plain.status, 'HEALTHY', 'advisories never change the status');
  assert.equal(plain.advisories.length, 3, plain.advisories.join(' | ')); // not encrypted, local only, restore overdue

  const broken = opsBackupHealth(Date.now(), dirWith({ 'last-backup.json': '{not json' }));
  assert.notEqual(broken.status, 'HEALTHY'); assert.match(broken.problems.join(), /unreadable/);
});
