/**
 * Reliability insights — pure functions shared by the server (alerts, /v1/insights) and tests.
 *
 *  • forecastToThreshold — least-squares trend of a metric (e.g. disk %) and the time until it
 *    crosses a threshold. Only reported when there is enough history and the trend is real
 *    (rising and a reasonable fit), never extrapolated from a handful of samples.
 *  • detectFlapping — counts up/down transitions in a monitor's recent checks. Intermittent
 *    failures that never reach the confirmation threshold would otherwise stay invisible.
 *  • errorBudget — SLO error budget and burn rates from hourly check buckets
 *    (multi-window burn-rate alerting as in the Google SRE workbook).
 */

export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Forecast {
  /** Latest value of the series */
  current: number;
  /** Trend in units per day (positive = rising) */
  slopePerDay: number;
  threshold: number;
  /** Hours until the trend reaches the threshold; null when not rising towards it */
  etaHours: number | null;
  /** Goodness of fit 0–1 */
  r2: number;
  samples: number;
  spanHours: number;
  confidence: Confidence;
}

export interface ForecastOptions {
  /** Minimum time covered by the samples */
  minSpanHours?: number;
  minSamples?: number;
  /** ETAs further away than this are not reported (a weak trend over months is noise) */
  maxEtaHours?: number;
}

/** Linear trend of points (t in ms) towards threshold. null when there is not enough history. */
export function forecastToThreshold(points: Array<{ t: number; v: number }>, threshold: number, opts: ForecastOptions = {}): Forecast | null {
  const { minSpanHours = 6, minSamples = 30, maxEtaHours = 24 * 30 } = opts;
  const pts = points.filter(p => Number.isFinite(p.t) && Number.isFinite(p.v));
  if (pts.length < minSamples) return null;
  const t0 = pts[0].t;
  const spanHours = (pts[pts.length - 1].t - t0) / 3_600_000;
  if (spanHours < minSpanHours) return null;

  // Least squares on (hours since t0, value)
  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const x = (p.t - t0) / 3_600_000;
    sx += x; sy += p.v; sxx += x * x; sxy += x * p.v; syy += p.v * p.v;
  }
  const varX = n * sxx - sx * sx;
  if (varX <= 0) return null;
  const slopePerHour = (n * sxy - sx * sy) / varX;
  const intercept = (sy - slopePerHour * sx) / n;
  const varY = n * syy - sy * sy;
  const r2 = varY <= 0 ? 0 : Math.min(1, Math.max(0, ((n * sxy - sx * sy) ** 2) / (varX * varY)));

  const current = pts[pts.length - 1].v;
  const nowX = spanHours;
  const fitted = intercept + slopePerHour * nowX;
  let etaHours: number | null = null;
  if (current >= threshold) etaHours = 0;
  else if (slopePerHour > 0 && r2 >= 0.3) {
    // From the fitted line (not the last noisy sample), but never in the past
    const eta = (threshold - Math.max(fitted, current)) / slopePerHour;
    if (eta >= 0 && eta <= maxEtaHours) etaHours = Math.round(eta * 10) / 10;
  }
  const confidence: Confidence = r2 >= 0.8 && spanHours >= 24 ? 'HIGH' : r2 >= 0.5 && spanHours >= 12 ? 'MEDIUM' : 'LOW';
  return {
    current: Math.round(current * 10) / 10,
    slopePerDay: Math.round(slopePerHour * 24 * 100) / 100,
    threshold, etaHours, r2: Math.round(r2 * 100) / 100, samples: n,
    spanHours: Math.round(spanHours * 10) / 10, confidence,
  };
}

export interface FlapState { flapping: boolean; transitions: number; window: number }

/**
 * outcomes: newest first, true = check passed. Flapping starts at `start` transitions within the
 * window and only ends once it drops to `end` or fewer (hysteresis: no on/off flicker of the flag).
 */
export function detectFlapping(outcomes: boolean[], wasFlapping: boolean, window = 20, start = 5, end = 1): FlapState {
  const recent = outcomes.slice(0, window);
  let transitions = 0;
  for (let i = 1; i < recent.length; i++) if (recent[i] !== recent[i - 1]) transitions++;
  const flapping = wasFlapping ? transitions > end : transitions >= start;
  return { flapping, transitions, window: recent.length };
}

/** Availability SLO per application tier (%) */
export const SLO_TARGETS: Record<'TIER_1' | 'TIER_2' | 'TIER_3', number> = { TIER_1: 99.9, TIER_2: 99.5, TIER_3: 99.0 };

/** Burn-rate thresholds: 14.4× over 1 h and 6 h ≈ 2 % of a 30-day budget per hour (page); 3× over 24 h (ticket) */
export const BURN = { fast: { short: 14.4, long: 6 }, slow: { long: 3 }, minChecks: 10 } as const;

export interface HourBucket { h: number; total: number; ok: number }

export interface ErrorBudget {
  targetPercent: number;
  windowDays: number;
  totalChecks: number;
  failedChecks: number;
  /** Measured availability in the window; null without checks */
  availabilityPercent: number | null;
  /** Failures the SLO allows in the window at the current check volume */
  allowedFailures: number;
  /** 0–100+ (over 100 = budget exceeded) */
  consumedPercent: number | null;
  remainingPercent: number | null;
  /** Error rate ÷ allowed error rate; null when the window has fewer than BURN.minChecks checks */
  burnRate1h: number | null;
  burnRate6h: number | null;
  burnRate24h: number | null;
  status: 'NO_DATA' | 'HEALTHY' | 'AT_RISK' | 'EXHAUSTED';
  alert: 'NONE' | 'SLOW_BURN' | 'FAST_BURN';
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** buckets: hourly (h = floor(ms / 3.6e6)); nowH = the current hour. Several monitors' buckets may be concatenated. */
export function errorBudget(buckets: HourBucket[], targetPercent: number, nowH: number, windowDays = 30): ErrorBudget {
  const allowedRatio = 1 - targetPercent / 100;
  const sum = (hours: number) => {
    let total = 0, ok = 0;
    for (const b of buckets) if (b.h > nowH - hours && b.h <= nowH) { total += b.total; ok += b.ok; }
    return { total, failed: total - ok };
  };
  const burn = (hours: number) => {
    const s = sum(hours);
    return s.total < BURN.minChecks || allowedRatio <= 0 ? null : round2(s.failed / s.total / allowedRatio);
  };
  const w = sum(windowDays * 24);
  const allowedFailures = Math.floor(w.total * allowedRatio);
  const consumed = w.total === 0 ? null : allowedFailures === 0 ? (w.failed > 0 ? 100 : 0) : round2((w.failed / (w.total * allowedRatio)) * 100);
  const b1 = burn(1), b6 = burn(6), b24 = burn(24);
  const alert: ErrorBudget['alert'] =
    b1 !== null && b6 !== null && b1 >= BURN.fast.short && b6 >= BURN.fast.long ? 'FAST_BURN'
      : b24 !== null && b24 >= BURN.slow.long ? 'SLOW_BURN' : 'NONE';
  const status: ErrorBudget['status'] = consumed === null ? 'NO_DATA' : consumed >= 100 ? 'EXHAUSTED' : consumed >= 75 || alert !== 'NONE' ? 'AT_RISK' : 'HEALTHY';
  return {
    targetPercent, windowDays, totalChecks: w.total, failedChecks: w.failed,
    availabilityPercent: w.total ? round2(((w.total - w.failed) / w.total) * 100) : null,
    allowedFailures, consumedPercent: consumed, remainingPercent: consumed === null ? null : round2(Math.max(0, 100 - consumed)),
    burnRate1h: b1, burnRate6h: b6, burnRate24h: b24, status, alert,
  };
}

/** "3 h", "2.5 d" — compact ETA for the UI */
export function formatEta(hours: number | null): string {
  if (hours === null) return '—';
  if (hours <= 0) return 'now';
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round((hours / 24) * 10) / 10} d`;
}
