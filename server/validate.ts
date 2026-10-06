/** Small input validation helpers. Each throws ValidationError with a user-facing message. */
export class ValidationError extends Error {}

type Obj = Record<string, unknown>;

export function body(req: { body?: unknown }): Obj {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Obj : {};
}

export function reqStr(o: Obj, key: string, label: string, max = 200): string {
  const v = o[key];
  if (typeof v !== 'string' || v.trim() === '') throw new ValidationError(`${label} is required`);
  if (v.trim().length > max) throw new ValidationError(`${label} must be at most ${max} characters`);
  return v.trim();
}

export function optStr(o: Obj, key: string, label: string, max = 500): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new ValidationError(`${label} must be text`);
  if (v.trim().length > max) throw new ValidationError(`${label} must be at most ${max} characters`);
  return v.trim();
}

export function optInt(o: Obj, key: string, label: string, min: number, max: number): number | undefined {
  const v = o[key];
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${label} must be a whole number between ${min} and ${max}`);
  return n;
}

export function optBool(o: Obj, key: string): boolean | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new ValidationError(`${key} must be true or false`);
}

export function oneOf<T extends string>(o: Obj, key: string, label: string, allowed: readonly T[], fallback?: T): T {
  const v = o[key];
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new ValidationError(`${label} must be one of: ${allowed.join(', ')}`);
  return v as T;
}

export function optOneOf<T extends string>(o: Obj, key: string, label: string, allowed: readonly T[]): T | undefined {
  const v = o[key];
  if (v === undefined || v === null || v === '') return undefined;
  return oneOf(o, key, label, allowed);
}

export function optDate(o: Obj, key: string, label: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw new ValidationError(`${label} must be a valid date/time`);
  return new Date(v).toISOString();
}

export function strArray(o: Obj, key: string, label: string, maxItems = 100): string[] | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw new ValidationError(`${label} must be a list of text values`);
  return (v as string[]).map(s => s.trim()).filter(Boolean).slice(0, maxItems);
}

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
export const isHostname = (s: string) => HOSTNAME_RE.test(s);
export const isDomain = (s: string) => HOSTNAME_RE.test(s) && s.includes('.');
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
