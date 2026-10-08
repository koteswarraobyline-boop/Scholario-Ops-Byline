/**
 * Dead-man switch: this control plane pings an EXTERNAL watchdog (healthchecks.io, UptimeRobot
 * heartbeat, Better Stack …) every DEADMAN_INTERVAL_SEC with a plain GET. If Scholario Ops dies or
 * loses outbound connectivity, the pings stop and the external watchdog alerts — independently of
 * this process. What this module records is only the LOCAL side (did our ping succeed?); it cannot
 * prove that the watchdog itself is alive.
 *
 * Security: the URL comes only from the server environment. It is never logged, never returned by
 * the API (only its host name) and is removed from every error text.
 */
import { DeadManControlPlane, DeadManStatus } from '../src/types/index.ts';
import { log } from './logger.ts';

export interface DeadManOptions {
  url: string;
  intervalSec: number;
  toleranceSec: number;
  /** Injected in tests */
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Called after every attempt and state change (broadcast, audit) */
  onChange?: (state: DeadManControlPlane, previous: DeadManStatus) => void;
}

/** Parses the configured URL. Only http(s) without spaces; anything else is a configuration error. */
export function parseHeartbeatUrl(raw: string): { url: URL | null; error: string | null } {
  const v = raw.trim();
  if (!v) return { url: null, error: null };
  let u: URL;
  try { u = new URL(v); } catch { return { url: null, error: 'DEADMAN_HEARTBEAT_URL is not a valid URL' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { url: null, error: 'DEADMAN_HEARTBEAT_URL must be an http:// or https:// URL' };
  return { url: u, error: null };
}

/** Removes the heartbeat URL and every secret-looking part of it (path, query, credentials) from a text. */
export function redactUrl(text: string, url: URL | null): string {
  if (!url) return text;
  let out = text;
  const parts = [url.href, url.href.replace(/\/$/, ''), `${url.pathname}${url.search}`, url.search.slice(1), url.username, url.password, decodeURIComponent(url.pathname)]
    .concat(url.pathname.split('/').filter(p => p.length >= 6))
    .concat([...url.searchParams.values()].filter(v => v.length >= 4))
    .filter(p => p && p !== '/');
  for (const p of [...new Set(parts)].sort((a, b) => b.length - a.length)) out = out.split(p).join('[redacted]');
  return out;
}

/** Short, URL-free description of a failed fetch */
function describeError(err: unknown): string {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return 'timed out';
  const code = e?.cause?.code;
  return code ? `${e.message || 'request failed'} (${code})` : (e?.message || 'request failed');
}

export class DeadManHeartbeat {
  readonly state: DeadManControlPlane;
  private readonly url: URL | null;
  private readonly opts: DeadManOptions;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: AbortController | null = null;
  private startedAt = 0;

  constructor(opts: DeadManOptions) {
    this.opts = opts;
    const { url, error } = parseHeartbeatUrl(opts.url);
    this.url = url;
    this.state = {
      id: 'deadman-outbound',
      name: 'External Dead-Man Heartbeat',
      nodeLocation: url ? url.hostname : 'Not configured',
      targetControlPlane: url ? url.hostname : '',
      lastHeartbeatReceivedAt: '',
      intervalSec: opts.intervalSec,
      toleranceSec: opts.toleranceSec,
      status: 'NOT_CONFIGURED',
      consecutiveMisses: 0,
      configured: Boolean(url),
      configError: error,
      workerRunning: false,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastHttpStatus: null,
      lastLatencyMs: null,
      lastError: null,
      consecutiveFailures: 0,
    };
    if (url) this.state.status = 'PENDING';
  }

  private now() { return (this.opts.now ?? Date.now)(); }

  /** Re-derives the state from the recorded attempts (also called on a timer so FAILING appears even if attempts hang). */
  evaluate(): DeadManStatus {
    const s = this.state;
    if (!this.url) return (s.status = 'NOT_CONFIGURED');
    if (!s.lastAttemptAt) return (s.status = 'PENDING');
    const now = this.now();
    const tolMs = s.toleranceSec * 1000;
    const lastOk = s.lastSuccessAt ? Date.parse(s.lastSuccessAt) : null;
    if (s.consecutiveFailures === 0 && lastOk !== null && now - lastOk <= tolMs) return (s.status = 'HEALTHY');
    // No success within the tolerance (or never, once the worker has been running that long)
    const silentSince = lastOk ?? this.startedAt;
    if (now - silentSince > tolMs) return (s.status = 'FAILING');
    return (s.status = 'DEGRADED');
  }

  /** One ping. Never throws. */
  async beat(): Promise<void> {
    if (!this.url || this.inFlight) return;
    if (!this.startedAt) this.startedAt = this.now();
    const prev = this.state.status;
    const controller = new AbortController();
    this.inFlight = controller;
    const timeoutMs = Math.min(10_000, Math.max(2_000, this.state.intervalSec * 500));
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = this.now();
    const s = this.state;
    s.lastAttemptAt = new Date(t0).toISOString();
    try {
      const resp = await (this.opts.fetchImpl ?? fetch)(this.url.href, {
        method: 'GET', signal: controller.signal, redirect: 'follow',
        headers: { 'User-Agent': 'scholario-ops-deadman/1' },
      });
      await resp.body?.cancel().catch(() => {});
      s.lastLatencyMs = Math.max(0, this.now() - t0);
      s.lastHttpStatus = resp.status;
      if (!resp.ok) throw Object.assign(new Error(`HTTP ${resp.status}`), { httpStatus: resp.status });
      s.lastSuccessAt = new Date(this.now()).toISOString();
      s.lastHeartbeatReceivedAt = s.lastSuccessAt;
      s.consecutiveFailures = 0;
      s.lastError = null;
    } catch (err) {
      // An HTTP error response keeps its status and latency; no response at all → nothing measured
      if (!(err as { httpStatus?: number }).httpStatus) { s.lastHttpStatus = null; s.lastLatencyMs = null; }
      s.consecutiveFailures += 1;
      s.lastError = redactUrl(describeError(err), this.url).slice(0, 200);
      // First failure and then every 10th: enough to notice, no log flood while the watchdog is unreachable
      if (s.consecutiveFailures === 1 || s.consecutiveFailures % 10 === 0) {
        log.warn('deadman', `heartbeat to ${this.url.hostname} failed (${s.consecutiveFailures} in a row): ${s.lastError}`);
      }
    } finally {
      clearTimeout(timer);
      this.inFlight = null;
    }
    s.consecutiveMisses = s.consecutiveFailures;
    this.evaluate();
    if (prev !== s.status) log.info('deadman', `heartbeat state ${prev} → ${s.status}`);
    this.opts.onChange?.(s, prev);
  }

  /** Starts the loop. Idempotent: returns false (and does nothing) when already running or not configured. */
  start(): boolean {
    if (this.timer || !this.url) return false;
    this.startedAt = this.now();
    this.state.workerRunning = true;
    void this.beat();
    this.timer = setInterval(() => { void this.beat(); }, this.state.intervalSec * 1000);
    this.timer.unref();
    log.info('deadman', `heartbeat to ${this.url.hostname} every ${this.state.intervalSec}s (silence tolerance ${this.state.toleranceSec}s)`);
    return true;
  }

  /** Stops the loop and aborts a ping in flight. Safe to call more than once. */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.inFlight?.abort();
    this.state.workerRunning = false;
  }

  get running() { return this.timer !== null; }
}
