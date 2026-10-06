/**
 * Minimal structured logger.
 *  - production (NODE_ENV=production or LOG_FORMAT=json): one JSON object per line
 *    {"ts","level","service","component","msg", ...fields}
 *  - development: readable text
 * Fields whose name looks secret (password, token, secret, authorization, key, cookie) are redacted,
 * and bearer tokens / connection-string passwords inside messages are masked.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: Level = (['debug', 'info', 'warn', 'error'] as const).find(l => l === (process.env.LOG_LEVEL ?? '').toLowerCase()) ?? 'info';
const json = (process.env.LOG_FORMAT ?? '').toLowerCase() === 'json' || ((process.env.LOG_FORMAT ?? '') === '' && process.env.NODE_ENV === 'production');
const SECRET_KEY = /pass(word)?|secret|token|authorization|api[-_]?key|cookie|credential/i;

/** Masks secrets that may appear inside free text (bearer tokens, URL passwords, long hex keys). */
export function scrub(text: string): string {
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:/\s]+:)[^@\s]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:token|ticket|key|access_token)=)[^&\s]+/gi, '$1[REDACTED]');
}

function clean(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return { name: value.name, message: scrub(value.message), ...(process.env.NODE_ENV !== 'production' && value.stack ? { stack: scrub(value.stack) } : {}) };
  if (typeof value === 'string') return scrub(value);
  if (!value || typeof value !== 'object' || depth > 3) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(v => clean(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : clean(v, depth + 1);
  return out;
}

function write(level: Level, component: string, msg: string, fields?: Record<string, unknown>) {
  if (RANK[level] < RANK[minLevel]) return;
  const f = fields ? (clean(fields) as Record<string, unknown>) : undefined;
  const text = scrub(msg);
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (json) {
    stream.write(`${JSON.stringify({ ts: new Date().toISOString(), level, service: 'scholario-ops', component, msg: text, ...f })}\n`);
  } else {
    const extra = f && Object.keys(f).length ? ` ${JSON.stringify(f)}` : '';
    stream.write(`${new Date().toISOString().slice(11, 19)} ${level.toUpperCase().padEnd(5)} [${component}] ${text}${extra}\n`);
  }
}

export const log = {
  debug: (component: string, msg: string, fields?: Record<string, unknown>) => write('debug', component, msg, fields),
  info: (component: string, msg: string, fields?: Record<string, unknown>) => write('info', component, msg, fields),
  warn: (component: string, msg: string, fields?: Record<string, unknown>) => write('warn', component, msg, fields),
  error: (component: string, msg: string, fields?: Record<string, unknown>) => write('error', component, msg, fields),
};
