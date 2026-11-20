/**
 * Expiry window for API keys, tokens, and subscriptions.
 * Days are whole days remaining. A date in the past is EXPIRED. Inside the warn window is EXPIRING.
 */
import type { CredentialExpiryState } from '../types/index.ts';

export function daysUntil(expiresAt: string, now = Date.now()): number | null {
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now) / 86_400_000);
}

export function expiryState(expiresAt: string, warnDays: number, now = Date.now()): CredentialExpiryState {
  const days = daysUntil(expiresAt, now);
  if (days === null) return 'INVALID';
  if (days < 0) return 'EXPIRED';
  if (days < Math.max(1, warnDays)) return 'EXPIRING';
  return 'OK';
}
