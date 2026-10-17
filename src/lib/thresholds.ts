/**
 * Monitoring thresholds — the single place to tune them. Shared by the backend (server health,
 * warnings, alerts, DR capacity checks) and the UI (bars, badges), so both always agree.
 *
 * WARNING = needs attention; CRITICAL = act now. "sustainedMinutes" means the condition must hold
 * for every 1-minute rollup in that window before it is reported as a warning or opens an incident
 * (one noisy 10-second sample never alerts).
 */
export interface Band { warning: number; critical: number }

export const THRESHOLDS = {
  /** CPU busy % (all cores). Server status has always used 85 / 95 on the hottest resource. */
  cpuPercent: { warning: 85, critical: 95, sustainedMinutes: 5 },
  /** % of CPU time waiting on disk I/O — high values mean the disk, not the CPU, is the bottleneck */
  cpuIowaitPercent: { warning: 20, critical: 40 },
  /** % of CPU time taken by the hypervisor (noisy neighbour on a VPS) */
  cpuStealPercent: { warning: 10, critical: 25 },
  /** 1-minute load average divided by CPU cores */
  loadPerCore: { warning: 1, critical: 2 },
  /** Memory used % (total − MemAvailable; reclaimable cache is not "used") */
  memoryPercent: { warning: 85, critical: 95, sustainedMinutes: 5 },
  /** Swap used % — only evaluated when swap is configured */
  swapPercent: { warning: 50, critical: 80, sustainedMinutes: 5 },
  /** Memory pressure (PSI 'some' avg60 %): tasks stalled waiting for memory */
  memoryPressurePercent: { warning: 10, critical: 30 },
  /** Filesystem used % (root and every mounted filesystem) */
  diskPercent: { warning: 85, critical: 95 },
  /** Inode used % */
  inodePercent: { warning: 85, critical: 95 },
  /** Busiest disk utilisation % (time the device had I/O in flight) */
  diskIoUtilPercent: { warning: 80, critical: 95, sustainedMinutes: 5 },
  /** Average disk request latency (ms) */
  diskLatencyMs: { warning: 50, critical: 200 },
  /** New interface errors + drops since the previous report */
  networkErrorsPerReport: { warning: 1, critical: 100 },
  /** |server clock − agent clock| (ms). Reports beyond AGENT_MAX_CLOCK_SKEW_SEC are rejected by the server. */
  clockSkewMs: { warning: 2_000, critical: 30_000 },
  /** NTP offset reported by chrony / systemd-timesyncd (ms) */
  ntpOffsetMs: { warning: 500, critical: 5_000 },
  /** Agent → server delivery time (ms) */
  transportDelayMs: { warning: 5_000, critical: 20_000 },
  /** PM2 restarts within restartWindowMinutes */
  pm2Restarts: { warning: 3, critical: 10, restartWindowMinutes: 15 },
  /** Local application health check latency (ms) */
  localHealthLatencyMs: { warning: 1_000, critical: 5_000 },
  /** Consecutive failed local health checks before an incident is opened (checks run about every 30 s) */
  localHealthFailuresForAlert: 2,
  /** Database connections / max_connections % (the database is DEGRADED from 90 %) */
  dbConnectionUsagePercent: { warning: 80, critical: 90 },
  /** Availability / uptime %: at or above "good" is green, at or above "warning" amber, below it red */
  uptimePercent: { good: 99.9, warning: 99 },
  /** DR capacity checks (informational, not part of the 13 core DR readiness checks) */
  drCapacity: {
    diskPercent: { warning: 80, critical: 90 },
    memoryPercent: { warning: 85, critical: 95 },
    cpuPercent: { warning: 80, critical: 95 },
  },
} as const;

export type Level = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';

/** Level of a value against a band (null / undefined / NaN → UNKNOWN, never HEALTHY). */
export function levelOf(value: number | null | undefined, band: Band): Level {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'UNKNOWN';
  return value >= band.critical ? 'CRITICAL' : value >= band.warning ? 'WARNING' : 'HEALTHY';
}

const RANK: Record<Level, number> = { HEALTHY: 0, UNKNOWN: 1, WARNING: 2, CRITICAL: 3 };

/** Worst level of a list (empty → fallback). UNKNOWN outranks HEALTHY: missing data is never green. */
export function worstLevel(levels: Level[], fallback: Level = 'UNKNOWN'): Level {
  return levels.length ? levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a)) : fallback;
}
