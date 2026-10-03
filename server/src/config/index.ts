import dotenv from 'dotenv';
import path from 'path';

// Load .env — try cwd first (npm run dev from server/), then relative to file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../server/.env') });

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optionalNumber(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}

function optionalBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

export const config = {
  env: optional('NODE_ENV', 'development') as 'development' | 'production' | 'test',
  port: optionalNumber('PORT', 4000),
  appUrl: optional('APP_URL', 'http://localhost:3000'),
  apiUrl: optional('API_URL', 'http://localhost:4000'),

  db: {
    url: optional('DATABASE_URL', 'postgresql://scholario_ops:password@localhost:5432/scholario_ops_dev'),
    poolMin: optionalNumber('DB_POOL_MIN', 2),
    poolMax: optionalNumber('DB_POOL_MAX', 20),
    ssl: optionalBool('DB_SSL', false),
  },

  redis: {
    url: optional('REDIS_URL', 'redis://localhost:6379'),
    keyPrefix: optional('REDIS_KEY_PREFIX', 'scholario:'),
  },

  auth: {
    jwtSecret: optional('JWT_SECRET', 'dev_jwt_secret_change_in_production'),
    jwtExpiresIn: optional('JWT_EXPIRES_IN', '15m'),
    refreshSecret: optional('REFRESH_TOKEN_SECRET', 'dev_refresh_secret_change_in_production'),
    refreshExpiresIn: optional('REFRESH_TOKEN_EXPIRES_IN', '7d'),
    bcryptRounds: optionalNumber('BCRYPT_ROUNDS', 12),
  },

  cors: {
    origins: optional('CORS_ORIGINS', 'http://localhost:3000').split(',').map(s => s.trim()),
  },

  rateLimit: {
    windowMs: optionalNumber('RATE_LIMIT_WINDOW_MS', 60_000),
    max: optionalNumber('RATE_LIMIT_MAX', 200),
    authMax: optionalNumber('AUTH_RATE_LIMIT_MAX', 10),
  },

  smtp: {
    host: optional('SMTP_HOST', ''),
    port: optionalNumber('SMTP_PORT', 587),
    secure: optionalBool('SMTP_SECURE', false),
    user: optional('SMTP_USER', ''),
    pass: optional('SMTP_PASS', ''),
    from: optional('SMTP_FROM', 'Scholario Ops <ops@scholario.net>'),
  },

  teams: {
    webhookUrl: optional('TEAMS_WEBHOOK_URL', ''),
  },

  cloudflare: {
    apiToken: optional('CLOUDFLARE_API_TOKEN', ''),
    accountId: optional('CLOUDFLARE_ACCOUNT_ID', ''),
  },

  hostinger: {
    apiToken: optional('HOSTINGER_API_TOKEN', ''),
  },

  encryptionKey: optional('ENCRYPTION_KEY', 'dev_encryption_key_32_chars_here!!'),

  monitoring: {
    workerConcurrency: optionalNumber('MONITOR_WORKER_CONCURRENCY', 5),
    defaultIntervalSec: optionalNumber('MONITOR_DEFAULT_INTERVAL_SEC', 30),
    deadManIntervalSec: optionalNumber('DEAD_MAN_INTERVAL_SEC', 15),
    deadManToleranceSec: optionalNumber('DEAD_MAN_TOLERANCE_SEC', 45),
    telemetryStaleThresholdSec: optionalNumber('TELEMETRY_STALE_THRESHOLD_SEC', 120),
  },

  gemini: {
    apiKey: optional('GEMINI_API_KEY', ''),
    enabled: optionalBool('GEMINI_ENABLED', false),
  },

  isDev(): boolean {
    return this.env === 'development';
  },

  isProd(): boolean {
    return this.env === 'production';
  },

  isTest(): boolean {
    return this.env === 'test';
  },
};
