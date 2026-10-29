/**
 * Environment-variable names for provider tokens.
 * The value is read from process.env at use time (filled at process start). It is never stored or returned.
 * A name outside the Hostinger pattern is rejected so a connection cannot send some other secret to Hostinger.
 */
export const LEGACY_HOSTINGER_ENV = 'HOSTINGER_API_TOKEN';
/** Stable id for the built-in HOSTINGER_API_TOKEN connection. */
export const LEGACY_HOSTINGER_ID = '00000000-0000-4000-8000-0000000000a1';

const TOKEN_ENV = /^HOSTINGER_([A-Z][A-Z0-9]*(_[A-Z0-9]+)*_)?API_TOKEN$/;

export function isAllowedTokenEnv(name: string): boolean {
  return TOKEN_ENV.test(name);
}

/** Trimmed token for an allowed variable, or '' when the name is not allowed or the variable is missing. */
export function tokenFromEnv(name: string): string {
  if (!isAllowedTokenEnv(name)) return '';
  return (process.env[name] ?? '').trim();
}

export function connectionNameError(name: string): string | null {
  const n = name.trim();
  if (n.length < 1 || n.length > 80) return 'Connection name must be 1–80 characters';
  if (/[\u0000-\u001f]/.test(n)) return 'Connection name cannot contain control characters';
  return null;
}

/** Removes known token values from a message before it is logged, stored, or returned. */
export function redactSecrets(message: string): string {
  let out = message;
  const names = new Set<string>([LEGACY_HOSTINGER_ENV]);
  for (const key of Object.keys(process.env)) if (isAllowedTokenEnv(key)) names.add(key);
  for (const name of names) {
    const token = (process.env[name] ?? '').trim();
    if (token.length >= 8 && out.includes(token)) out = out.split(token).join('[REDACTED]');
  }
  return out;
}
