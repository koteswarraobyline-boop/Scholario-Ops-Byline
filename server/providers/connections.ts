/**
 * Provider connection records. Tokens stay in environment variables named by tokenEnv.
 */
import crypto from 'crypto';
import type { ProviderConnectionRecord, ProviderConnectionView, ProviderKind } from '../../src/types/index.ts';
import { providerDisplayStatus } from '../../src/lib/providerInventory.ts';
import { ValidationError } from '../validate.ts';
import { db, persist } from '../store.ts';
import { LEGACY_HOSTINGER_ENV, LEGACY_HOSTINGER_ID, connectionNameError, isAllowedTokenEnv, tokenFromEnv } from './env.ts';

export function countActiveInstances(connectionId: string): number {
  return db.providerInstances.filter(i => i.connectionId === connectionId && !i.absent).length;
}

export function viewConnection(c: ProviderConnectionRecord): ProviderConnectionView {
  const tokenConfigured = tokenFromEnv(c.tokenEnv).length > 0;
  return {
    id: c.id,
    name: c.name,
    provider: c.provider,
    tokenEnv: c.tokenEnv,
    tokenConfigured,
    syncEnabled: c.syncEnabled,
    legacy: c.legacy,
    status: tokenConfigured ? c.status : 'NOT_CONFIGURED',
    displayStatus: providerDisplayStatus({ tokenConfigured, syncEnabled: c.syncEnabled, status: c.status }),
    lastSyncAt: c.lastSyncAt,
    lastSuccessAt: c.lastSuccessAt,
    lastError: c.lastError,
    vmCount: countActiveInstances(c.id),
  };
}

/** Creates the built-in Hostinger connection when HOSTINGER_API_TOKEN is set and no row uses it yet. */
export function ensureLegacyHostingerConnection(): void {
  if (tokenFromEnv(LEGACY_HOSTINGER_ENV).length === 0) return;
  if (db.providerConnections.some(c => c.tokenEnv === LEGACY_HOSTINGER_ENV)) return;
  const now = new Date().toISOString();
  let name = 'Hostinger';
  if (db.providerConnections.some(c => c.name.toLowerCase() === name.toLowerCase())) name = 'Hostinger API';
  db.providerConnections.push({
    id: LEGACY_HOSTINGER_ID,
    name,
    provider: 'hostinger',
    tokenEnv: LEGACY_HOSTINGER_ENV,
    syncEnabled: true,
    legacy: true,
    status: 'PENDING',
    lastSyncAt: null,
    lastSuccessAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  });
  persist();
}

function assertUniqueName(name: string, exceptId?: string) {
  if (db.providerConnections.some(c => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase())) {
    throw new ValidationError('A connection with this name already exists');
  }
}

export function createProviderConnection(input: { name: string; provider: string; tokenEnv: string }): ProviderConnectionRecord {
  if (input.provider !== 'hostinger') {
    throw new ValidationError('Only Hostinger connections can be added. Other providers are not available yet.');
  }
  const name = input.name.trim();
  const nameErr = connectionNameError(name);
  if (nameErr) throw new ValidationError(nameErr);
  const tokenEnv = input.tokenEnv.trim();
  if (!isAllowedTokenEnv(tokenEnv)) {
    throw new ValidationError('Environment variable must be HOSTINGER_API_TOKEN or HOSTINGER_<LABEL>_API_TOKEN in uppercase. Add it to .env and restart the server. Token values are not accepted here.');
  }
  if (db.providerConnections.some(c => c.tokenEnv === tokenEnv)) {
    throw new ValidationError(`${tokenEnv} is already used by another connection`);
  }
  assertUniqueName(name);
  const now = new Date().toISOString();
  const row: ProviderConnectionRecord = {
    id: crypto.randomUUID(),
    name,
    provider: 'hostinger' satisfies ProviderKind,
    tokenEnv,
    syncEnabled: true,
    legacy: false,
    status: tokenFromEnv(tokenEnv) ? 'PENDING' : 'NOT_CONFIGURED',
    lastSyncAt: null,
    lastSuccessAt: null,
    lastError: tokenFromEnv(tokenEnv) ? null : `${tokenEnv} is not set. Add it to .env and restart the server.`,
    createdAt: now,
    updatedAt: now,
  };
  db.providerConnections.push(row);
  persist();
  return row;
}

export function renameProviderConnection(id: string, name: string): ProviderConnectionRecord {
  const row = db.providerConnections.find(c => c.id === id);
  if (!row) throw new ValidationError('Connection not found');
  const next = name.trim();
  const nameErr = connectionNameError(next);
  if (nameErr) throw new ValidationError(nameErr);
  assertUniqueName(next, id);
  row.name = next;
  row.updatedAt = new Date().toISOString();
  persist();
  return row;
}

export function setProviderSyncEnabled(id: string, syncEnabled: boolean): ProviderConnectionRecord {
  const row = db.providerConnections.find(c => c.id === id);
  if (!row) throw new ValidationError('Connection not found');
  row.syncEnabled = syncEnabled;
  row.updatedAt = new Date().toISOString();
  persist();
  return row;
}
