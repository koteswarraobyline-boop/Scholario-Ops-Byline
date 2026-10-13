import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { log } from './logger.ts';

const SMTP_VARS = ['SMTP_SERVICE', 'SMTP_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] as const;
/** Set before .env was read (shell, PM2, node --env-file); dotenv never overrides these, not even with an empty value */
const smtpFromEnvironment = new Set<string>(SMTP_VARS.filter(k => process.env[k] !== undefined));
const envFile = path.resolve('.env');
const loadedAt = Date.now();

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

/**
 * Email over SMTP, any provider. Three ways to configure it (first match wins):
 * - SMTP_URL: smtp://user:pass@host:587 or smtps://user:pass@host:465
 * - SMTP_SERVICE: a nodemailer preset (Gmail, Outlook365, SendGrid, Mailgun, SES, Zoho, Brevo, Postmark, …)
 * - SMTP_HOST + SMTP_PORT
 * SMTP_SECURE unset means implicit TLS only on port 465 (STARTTLS is negotiated on 587 / 25).
 * SMTP_FROM defaults to SMTP_USER when that is an address.
 */
function smtpConfig() {
  const url = str('SMTP_URL');
  let host = str('SMTP_HOST');
  let port = int('SMTP_PORT', 587, 1);
  let portSet = str('SMTP_PORT') !== '';
  let user = str('SMTP_USER');
  let pass = str('SMTP_PASS');
  let secureRaw = str('SMTP_SECURE').toLowerCase();
  if (url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') throw new Error('use smtp:// or smtps://');
      host = u.hostname;
      port = u.port ? Number(u.port) : u.protocol === 'smtps:' ? 465 : 587;
      portSet = true;
      if (u.username) user = decodeURIComponent(u.username);
      if (u.password) pass = decodeURIComponent(u.password);
      if (!secureRaw) secureRaw = u.protocol === 'smtps:' ? 'true' : 'false';
    } catch (err) {
      log.warn('config', `SMTP_URL is invalid (${(err as Error).message}) — ignored`);
    }
  }
  const from = str('SMTP_FROM') || (/^[^\s@]+@[^\s@]+$/.test(user) ? user : '');
  return {
    host,
    port,
    /** SMTP_PORT (or a port in SMTP_URL) was given; it then overrides a preset's port */
    portSet,
    service: str('SMTP_SERVICE'),
    /** null: decided by the port (465 → implicit TLS) */
    secure: secureRaw === 'true' ? true : secureRaw === 'false' ? false : null as boolean | null,
    user,
    pass,
    from,
    /** Refuse to send without STARTTLS on a plain port */
    requireTls: str('SMTP_REQUIRE_TLS') === 'true',
    /** false only for an internal relay with a self-signed certificate */
    tlsRejectUnauthorized: str('SMTP_TLS_REJECT_UNAUTHORIZED') !== 'false',
  };
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
  /** Notification delivery log (Notifications page) */
  notificationLogRetentionDays: int('NOTIFICATION_LOG_RETENTION_DAYS', 90, 1),

  /** Default thresholds (applications can override per environment in Setup) */
  backupMaxAgeHours: int('BACKUP_MAX_AGE_HOURS', 26, 1),
  /** Where deploy/backup-db.sh writes the Ops database backups and last-backup.json */
  opsBackupDir: path.resolve(str('OPS_BACKUP_DIR', './backups')),
  replicationMaxLagSec: int('REPLICATION_MAX_LAG_SEC', 300, 0),
  /** SSL certificates expiring within this many days are DEGRADED (and alert); within 7 days they fail */
  sslExpiryWarnDays: int('SSL_EXPIRY_WARN_DAYS', 21, 1),
  /** Minimum minutes between notifications for the same alert (prevents notification storms) */
  alertCooldownMin: int('ALERT_COOLDOWN_MIN', 15, 0),
  /** Optional: signs outgoing WEBHOOK notifications (X-Scholario-Signature, HMAC-SHA256) so receivers can verify them */
  notifyWebhookSecret: str('NOTIFY_WEBHOOK_SECRET'),
  /** Hostnames / IPs / CIDRs that notification webhooks may reach although they are private or loopback (never link-local) */
  notifyAllowedPrivateTargets: str('NOTIFY_ALLOWED_PRIVATE_TARGETS'),
  /** Non-critical alerts for one application within this many seconds of the first are sent as one summary (0 = off) */
  notifyGroupWindowSec: int('NOTIFY_GROUP_WINDOW_SEC', 60, 0),
  /** API requests per IP per minute (agents and heartbeats are exempt — they use their own tokens) */
  apiRateLimitPerMin: int('API_RATE_LIMIT_PER_MIN', 600, 10),

  hostingerApiToken: str('HOSTINGER_API_TOKEN'),
  hostingerSyncIntervalSec: int('HOSTINGER_SYNC_INTERVAL_SEC', 600, 60),
  hostingerTimeoutMs: int('HOSTINGER_TIMEOUT_MS', 15_000, 500),

  smtp: smtpConfig(),

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
export const isSmtpConfigured = () => Boolean((config.smtp.host || config.smtp.service) && config.smtp.from);

export interface SmtpSettingsReport {
  envFile: string;
  envFileFound: boolean;
  /** .env was saved after this process read it: the change needs a restart */
  envFileChangedSinceStart: boolean;
  variables: { name: string; present: boolean; source: 'environment' | '.env' | 'unset' }[];
}

/** Where the SMTP settings came from; names and presence only, never values */
export function smtpSettingsReport(): SmtpSettingsReport {
  let mtime = 0;
  try { mtime = fs.statSync(envFile).mtimeMs; } catch { /* no .env */ }
  return {
    envFile,
    envFileFound: mtime > 0,
    envFileChangedSinceStart: mtime > loadedAt,
    variables: SMTP_VARS.map(name => ({
      name,
      present: str(name) !== '',
      source: smtpFromEnvironment.has(name) ? 'environment' : process.env[name] !== undefined ? '.env' : 'unset',
    })),
  };
}

export function describeSmtpSettings(r = smtpSettingsReport()): string {
  const vars = r.variables.map(v => `${v.name}=${v.present ? 'set' : 'missing'}${v.source === 'environment' ? ' (from environment)' : ''}`).join(', ');
  return `SMTP settings from ${r.envFile}${r.envFileFound ? '' : ' (file not found)'}: ${vars}`;
}

log.info('config', describeSmtpSettings());
