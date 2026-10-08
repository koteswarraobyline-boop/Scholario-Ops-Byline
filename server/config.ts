import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { log } from './logger.ts';

dotenv.config({ quiet: true });

function int(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) {
    log.warn('config', `${name}="${raw}" is invalid, using ${fallback}`);
    return fallback;
  }
  return n;
}

function str(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

export const DATA_DIR = path.resolve(str('DATA_DIR', './data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * Signing secret for access/refresh tokens. If JWT_SECRET is not provided, a random
 * secret is generated once and persisted in DATA_DIR so sessions survive restarts.
 */
function resolveJwtSecret(): string {
  const fromEnv = str('JWT_SECRET');
  if (fromEnv.length >= 32) return fromEnv;
  if (fromEnv) log.warn('config', 'JWT_SECRET is shorter than 32 characters — using generated secret instead');
  const file = path.join(DATA_DIR, '.jwt-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const config = {
  port: int('PORT', 3000, 1),
  host: str('HOST', '0.0.0.0'),
  /** Public URL of this Ops server, used in the agent installer and notification links */
  publicUrl: str('PUBLIC_URL').replace(/\/+$/, ''),
  corsOrigins: str('CORS_ORIGINS').split(',').map(s => s.trim()).filter(Boolean),
  trustProxy: str('TRUST_PROXY', 'loopback'),

  /** PostgreSQL — single source of truth for configuration and operational data */
  databaseUrl: str('DATABASE_URL'),
  dbSchema: str('DB_SCHEMA', 'ops'),

  jwtSecret: resolveJwtSecret(),
  accessTokenTtlSec: int('ACCESS_TOKEN_TTL_SEC', 8 * 3600, 60),
  refreshTokenTtlSec: int('REFRESH_TOKEN_TTL_SEC', 7 * 24 * 3600, 300),

  adminEmail: str('ADMIN_EMAIL').toLowerCase(),
  adminPassword: str('ADMIN_PASSWORD'),
  adminName: str('ADMIN_NAME', 'System Administrator'),

  cloudflareApiToken: str('CLOUDFLARE_API_TOKEN'),
  cloudflareSyncIntervalSec: int('CLOUDFLARE_SYNC_INTERVAL_SEC', 300, 30),
  /** Load Balancer pool + pool health polling (read-only) */
  cloudflareLbSyncIntervalSec: int('CLOUDFLARE_LB_SYNC_INTERVAL_SEC', 60, 30),

  /** DR readiness: DR application latency above this is a WARNING */
  drLatencyThresholdMs: int('DR_LATENCY_THRESHOLD_MS', 2000, 50),
  /** Agent reports whose timestamp differs from server time by more than this are rejected */
  agentMaxClockSkewSec: int('AGENT_MAX_CLOCK_SKEW_SEC', 300, 30),
  checkHistoryRetentionDays: int('CHECK_HISTORY_RETENTION_DAYS', 90, 1),

  /** Default thresholds (applications can override per environment in Setup) */
  backupMaxAgeHours: int('BACKUP_MAX_AGE_HOURS', 26, 1),
  replicationMaxLagSec: int('REPLICATION_MAX_LAG_SEC', 300, 0),
  /** SSL certificates expiring within this many days are DEGRADED (and alert); within 7 days they fail */
  sslExpiryWarnDays: int('SSL_EXPIRY_WARN_DAYS', 21, 1),
  /** Minimum minutes between notifications for the same alert (prevents notification storms) */
  alertCooldownMin: int('ALERT_COOLDOWN_MIN', 15, 0),
  /** API requests per IP per minute (agents and heartbeats are exempt — they use their own tokens) */
  apiRateLimitPerMin: int('API_RATE_LIMIT_PER_MIN', 600, 10),

  hostingerApiToken: str('HOSTINGER_API_TOKEN'),
  hostingerSyncIntervalSec: int('HOSTINGER_SYNC_INTERVAL_SEC', 600, 60),
  hostingerTimeoutMs: int('HOSTINGER_TIMEOUT_MS', 15_000, 500),

  smtp: {
    host: str('SMTP_HOST'),
    port: int('SMTP_PORT', 587, 1),
    secure: str('SMTP_SECURE') === 'true',
    user: str('SMTP_USER'),
    pass: str('SMTP_PASS'),
    from: str('SMTP_FROM'),
  },

  /** Deprecated and ignored: DEADMAN_HEARTBEAT_URL / DEADMAN_INTERVAL_SEC / DEADMAN_TOLERANCE_SEC (no external watchdog) */
  deprecatedDeadManVars: ['DEADMAN_HEARTBEAT_URL', 'DEADMAN_INTERVAL_SEC', 'DEADMAN_TOLERANCE_SEC'].filter(k => (process.env[k] ?? '').trim() !== ''),

  /** Agent is STALE after this many seconds without a report, DISCONNECTED after 10x */
  telemetryStaleSec: int('TELEMETRY_STALE_THRESHOLD_SEC', 60, 10),
  metricsRetentionHours: int('METRICS_RETENTION_HOURS', 48, 1),
  monitorConcurrency: int('MONITOR_WORKER_CONCURRENCY', 10, 1),
  auditRetention: int('AUDIT_RETENTION_ENTRIES', 5000, 100),
  /** Token CI pipelines use to report deployments (POST /api/v1/deployments/report) */
  deployReportToken: str('DEPLOY_REPORT_TOKEN'),
};

export const isCloudflareConfigured = () => config.cloudflareApiToken.length > 0;
export const isHostingerConfigured = () => config.hostingerApiToken.length > 0;
export const isSmtpConfigured = () => Boolean(config.smtp.host && config.smtp.from);
