import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

function int(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) {
    console.warn(`[config] ${name}="${raw}" is invalid, using ${fallback}`);
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
  if (fromEnv) console.warn('[config] JWT_SECRET is shorter than 32 characters — using generated secret instead');
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

  jwtSecret: resolveJwtSecret(),
  accessTokenTtlSec: int('ACCESS_TOKEN_TTL_SEC', 8 * 3600, 60),
  refreshTokenTtlSec: int('REFRESH_TOKEN_TTL_SEC', 7 * 24 * 3600, 300),

  adminEmail: str('ADMIN_EMAIL').toLowerCase(),
  adminPassword: str('ADMIN_PASSWORD'),
  adminName: str('ADMIN_NAME', 'System Administrator'),

  cloudflareApiToken: str('CLOUDFLARE_API_TOKEN'),
  cloudflareAccountId: str('CLOUDFLARE_ACCOUNT_ID'),
  cloudflareSyncIntervalSec: int('CLOUDFLARE_SYNC_INTERVAL_SEC', 300, 30),

  hostingerApiToken: str('HOSTINGER_API_TOKEN'),
  hostingerSyncIntervalSec: int('HOSTINGER_SYNC_INTERVAL_SEC', 600, 60),

  smtp: {
    host: str('SMTP_HOST'),
    port: int('SMTP_PORT', 587, 1),
    secure: str('SMTP_SECURE') === 'true',
    user: str('SMTP_USER'),
    pass: str('SMTP_PASS'),
    from: str('SMTP_FROM'),
  },

  /** Outbound dead-man heartbeat (e.g. healthchecks.io / UptimeRobot heartbeat URL) */
  deadManHeartbeatUrl: str('DEADMAN_HEARTBEAT_URL'),
  deadManIntervalSec: int('DEADMAN_INTERVAL_SEC', 60, 10),
  deadManToleranceSec: int('DEADMAN_TOLERANCE_SEC', 180, 10),

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
