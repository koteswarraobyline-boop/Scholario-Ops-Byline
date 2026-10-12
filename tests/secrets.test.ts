/**
 * Encryption at rest of notification channel targets (server/secrets.ts + the channels table in
 * server/store.ts): round trip, no plaintext in the database, stable ciphertext (no rewrite churn),
 * restart with the same key, tampered / wrong-key values kept verbatim (never overwritten), legacy
 * plaintext rows migrated on the next save. Throw-away schema in the local test database.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
process.env.DB_SCHEMA = `ops_secrets_${process.pid}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scholario-secrets-'));
process.env.NOTIFY_SECRETS_KEY = '';
process.env.HOSTINGER_API_TOKEN = '';
process.env.CLOUDFLARE_API_TOKEN = '';

const secrets = await import('../server/secrets.ts');
const { initStore, db, flush, persist } = await import('../server/store.ts');
const save = async () => { persist(); return flush(); };
const { query, closePool, SCHEMA, T } = await import('../server/db.ts');

const TARGET = 'https://prod-12.westeurope.logic.azure.com/workflows/abc123/triggers/manual/paths/invoke?sig=TOPSECRETSIGNATURE';
const rowData = async (id: string) => (await query(`SELECT data FROM ${T('channels')} WHERE id = $1`, [id])).rows[0]?.data as { targetEndpoint: string } | undefined;

before(async () => { await initStore(); });
after(async () => {
  await query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
  await closePool();
  fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100).unref();
});

test('seal / open: round trip, no plaintext, stable within a process, tamper and wrong key detected without losing the stored value', () => {
  const sealed = secrets.sealSecret(TARGET);
  assert.match(sealed, /^enc:v1:[A-Za-z0-9+/=]+$/);
  assert.equal(sealed.includes('TOPSECRET'), false);
  assert.equal(secrets.sealSecret(TARGET), sealed, 'same ciphertext within a process (no rewrite on every save)');
  assert.equal(secrets.openSecret(sealed), TARGET);
  assert.equal(secrets.openSecret('https://legacy.example/plain'), 'https://legacy.example/plain', 'plaintext from before encryption passes through');
  assert.equal(secrets.sealSecret(''), '', 'empty stays empty');

  // Tampered ciphertext: authentication fails, the stored value is returned unchanged and never re-sealed
  const raw = Buffer.from(sealed.slice('enc:v1:'.length), 'base64'); raw[raw.length - 1] ^= 1;
  const tampered = 'enc:v1:' + raw.toString('base64');
  assert.equal(secrets.openSecret(tampered), tampered);
  assert.equal(secrets.sealSecret(tampered), tampered, 'an undecryptable value is kept verbatim');

  // Key file created in DATA_DIR
  assert.ok(fs.existsSync(path.join(process.env.DATA_DIR!, 'notify-secrets.key')));

  // A different key cannot read it (simulated new process with another key)
  secrets.resetSecretsForTests(crypto.randomBytes(32).toString('base64'));
  assert.equal(secrets.openSecret(sealed), sealed, 'wrong key: value kept, not decrypted');
  assert.throws(() => { secrets.resetSecretsForTests('short'); secrets.sealSecret('x'); }, /32 bytes/);
  secrets.resetSecretsForTests(''); // back to the key file
  assert.equal(secrets.openSecret(sealed), TARGET, 'the key file opens it again');
});

test('store: channel targets are encrypted in PostgreSQL, unchanged rows keep their ciphertext, a restart reads them back', async () => {
  const id = crypto.randomUUID();
  db.channels.push({ id, name: 'Encrypted Teams', type: 'TEAMS', targetEndpoint: TARGET, enabled: true, lastDeliveryAt: '', lastDeliveryStatus: 'PENDING', failureCount: 0 });
  assert.equal(await save(), true);
  const stored = (await rowData(id))!;
  assert.match(stored.targetEndpoint, /^enc:v1:/);
  const wholeRow = JSON.stringify((await query(`SELECT * FROM ${T('channels')} WHERE id = $1`, [id])).rows[0]);
  assert.equal(wholeRow.includes('TOPSECRET'), false, 'no plaintext anywhere in the row');
  assert.equal(db.channels.find(c => c.id === id)!.targetEndpoint, TARGET, 'in memory it stays usable');

  // Unrelated change + save: the channel row keeps the same ciphertext (no churn)
  db.channels.find(c => c.id === id)!.failureCount = 1;
  await save();
  assert.equal((await rowData(id))!.targetEndpoint, stored.targetEndpoint);

  // A real restart: another process with the same DATA_DIR (key file) loads the store
  const child = path.join(process.env.DATA_DIR!, 'reload.mts');
  fs.writeFileSync(child, `
    const { initStore, db } = await import(${JSON.stringify(new URL('../server/store.ts', import.meta.url).href)});
    const { closePool } = await import(${JSON.stringify(new URL('../server/db.ts', import.meta.url).href)});
    await initStore();
    console.log(JSON.stringify(db.channels.find(c => c.id === ${JSON.stringify(id)})?.targetEndpoint));
    await closePool(); process.exit(0);`);
  const out = execFileSync(process.execPath, ['--import', 'tsx', child], { env: { ...process.env }, encoding: 'utf8', timeout: 60_000 });
  assert.equal(JSON.parse(out.trim().split(/\r?\n/).pop()!), TARGET, 'restart decrypts with the key file');
});

test('store: a plaintext row from before encryption is encrypted on the next save', async () => {
  const id = crypto.randomUUID();
  const legacy = { id, name: 'Legacy', type: 'WEBHOOK', targetEndpoint: 'https://hooks.example.com/LEGACYSECRET', enabled: true, lastDeliveryAt: '', lastDeliveryStatus: 'PENDING', failureCount: 0 };
  await query(`INSERT INTO ${T('channels')} (id, data) VALUES ($1, $2)`, [id, JSON.stringify(legacy)]);
  // As loaded at startup: openSecret passes plaintext through
  db.channels.push({ ...legacy, targetEndpoint: secrets.openSecret(legacy.targetEndpoint) } as never);
  db.channels.find(c => c.id === id)!.enabled = false; // any save
  await save();
  const stored = (await rowData(id))!;
  assert.match(stored.targetEndpoint, /^enc:v1:/);
  assert.equal(JSON.stringify(stored).includes('LEGACYSECRET'), false);
});

test('lost key file with encrypted data stored: no new key is created, stored ciphertext is untouched, restoring the backup recovers', async () => {
  const id = crypto.randomUUID();
  db.channels.push({ id, name: 'Key loss', type: 'SLACK', targetEndpoint: TARGET, enabled: true, lastDeliveryAt: '', lastDeliveryStatus: 'PENDING', failureCount: 0 });
  assert.equal(await save(), true);
  const stored = (await rowData(id))!.targetEndpoint;
  const keyFile = path.join(process.env.DATA_DIR!, 'notify-secrets.key');
  const backup = keyFile + '.bak';
  fs.renameSync(keyFile, backup); // the key is "lost"; the backup stays outside the app's view

  // A restart without the key: loads the store, then tries to save a change
  const child = path.join(process.env.DATA_DIR!, 'keyloss.mts');
  fs.writeFileSync(child, `
    const { initStore, db, persist, flush } = await import(${JSON.stringify(new URL('../server/store.ts', import.meta.url).href)});
    const secrets = await import(${JSON.stringify(new URL('../server/secrets.ts', import.meta.url).href)});
    const { closePool } = await import(${JSON.stringify(new URL('../server/db.ts', import.meta.url).href)});
    await initStore();
    const status = secrets.secretsKeyStatus?.() ?? { ok: true };
    db.channels.find(c => c.id === ${JSON.stringify(id)}).failureCount = 7;
    persist(); await flush();
    console.log(JSON.stringify({ ok: status.ok }));
    await closePool(); process.exit(0);`);
  const out = execFileSync(process.execPath, ['--import', 'tsx', child], { env: { ...process.env }, encoding: 'utf8', timeout: 60_000 });
  const res = JSON.parse(out.trim().split(/\r?\n/).pop()!);
  assert.equal(fs.existsSync(keyFile), false, 'no replacement key was generated while encrypted data exists');
  assert.equal(res.ok, false, 'the key problem is reported (health / channel saves)');
  assert.equal((await rowData(id))!.targetEndpoint, stored, 'stored ciphertext kept exactly');

  // Restore the backed-up key: everything reads back
  fs.renameSync(backup, keyFile);
  secrets.resetSecretsForTests('');
  assert.equal(secrets.openSecret(stored), TARGET);
});

test('fresh install (no encrypted data yet): a key file is still created automatically', () => {
  secrets.resetSecretsForTests('');
  assert.equal(secrets.secretsKeyStatus().ok, true);
  secrets.noteEncryptedData();
  assert.equal(secrets.secretsKeyStatus().ok, true, 'an existing key file is fine once encrypted data is seen');
});
