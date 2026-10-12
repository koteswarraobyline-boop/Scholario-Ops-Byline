/**
 * Encryption at rest for notification channel secrets (webhook URLs, PagerDuty routing keys, email
 * recipients): AES-256-GCM, stored as "enc:v1:<base64(iv | tag | ciphertext)>".
 *
 * Key: NOTIFY_SECRETS_KEY (base64 or hex, 32 bytes) if set, otherwise a random key created once in
 * DATA_DIR/notify-secrets.key (mode 0600). Protects database dumps, backups and replicas; it does not
 * protect against someone who controls the server itself (the key lives there too).
 *
 * Values are encrypted only at the database boundary (server/store.ts); in memory they stay usable.
 * Within a process the same plaintext keeps the same ciphertext, so unchanged rows are not rewritten
 * on every save. A value that cannot be decrypted (key lost or changed) is kept exactly as stored —
 * never overwritten — and reported.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.ts';
import { log } from './logger.ts';

const PREFIX = 'enc:v1:';
let key: Buffer | null = null;
/** Encrypted values were loaded from the database: a missing key then means a LOST key, not a new install */
let encryptedDataSeen = false;
export function noteEncryptedData() { encryptedDataSeen = true; }

export class SecretsKeyMissingError extends Error {}

function loadKey(): Buffer {
  if (key) return key;
  const fromEnv = (process.env.NOTIFY_SECRETS_KEY ?? '').trim();
  if (fromEnv) {
    const k = /^[0-9a-f]{64}$/i.test(fromEnv) ? Buffer.from(fromEnv, 'hex') : Buffer.from(fromEnv, 'base64');
    if (k.length !== 32) throw new Error('NOTIFY_SECRETS_KEY must be 32 bytes (64 hex characters or base64)');
    return (key = k);
  }
  const file = path.join(DATA_DIR, 'notify-secrets.key');
  // Never replace a lost key with a new one while encrypted data exists: later saves would use the new
  // key and restoring the backed-up key afterwards would leave a mix of two keys in the database.
  if (encryptedDataSeen && !fs.existsSync(file)) {
    throw new SecretsKeyMissingError(`${file} is missing but encrypted channel secrets exist — restore the key file from your backup (or set NOTIFY_SECRETS_KEY). A new key is not created.`);
  }
  try {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600, flag: 'wx' });
    log.info('secrets', `created the notification secrets key ${file} (back it up with .env — without it stored channel targets cannot be read)`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  const k = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  if (k.length !== 32) throw new Error(`${file} does not contain a 32-byte key`);
  return (key = k);
}

/** plaintext → ciphertext of this process (stable output, so unchanged rows are not rewritten) */
const sealed = new Map<string, string>();
/** Values that could not be decrypted: kept verbatim and reported */
const undecryptable = new Set<string>();

export const isSealed = (v: string) => typeof v === 'string' && v.startsWith(PREFIX);

export function sealSecret(plain: string): string {
  if (!plain || isSealed(plain)) return plain; // empty, or already ciphertext (e.g. could not be decrypted)
  const hit = sealed.get(plain);
  if (hit) return hit;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', loadKey(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const out = PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
  sealed.set(plain, out);
  return out;
}

/** Decrypts; plaintext (from before encryption) passes through; undecryptable values are returned unchanged */
export function openSecret(stored: string): string {
  if (!isSealed(stored)) return stored;
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
    if (raw.length < 29) throw new Error('too short');
    const d = crypto.createDecipheriv('aes-256-gcm', loadKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
    sealed.set(plain, stored); // keep the stored ciphertext: no rewrite on the next save
    return plain;
  } catch (err) {
    if (!undecryptable.has(stored)) {
      undecryptable.add(stored);
      log.error('secrets', `a stored channel secret cannot be decrypted (${(err as Error).message}) — was the key changed or lost? Re-enter the channel target.`);
    }
    return stored;
  }
}

/** Whether channel secrets can be encrypted / decrypted right now (health view, channel saves) */
export function secretsKeyStatus(): { ok: true } | { ok: false; error: string } {
  try { loadKey(); return { ok: true }; } catch (err) { return { ok: false, error: (err as Error).message }; }
}

/** For tests: forget the in-memory cache and key (simulates a new process) */
export function resetSecretsForTests(newKey?: string) {
  sealed.clear(); undecryptable.clear(); key = null; encryptedDataSeen = false;
  if (newKey !== undefined) process.env.NOTIFY_SECRETS_KEY = newKey;
}
