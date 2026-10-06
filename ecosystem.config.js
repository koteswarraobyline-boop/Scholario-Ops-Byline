/**
 * PM2 Ecosystem File — Scholario Ops Production
 *
 * Build first:   npm ci && npm run build
 * Start:         pm2 start ecosystem.config.js --env production
 *                pm2 save && pm2 startup
 *
 * Configuration is read from .env in this directory (see .env.example and DEPLOYMENT.md).
 */
const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, 'logs');
fs.mkdirSync(logDir, { recursive: true });

module.exports = {
  apps: [
    {
      name: 'scholario-ops',
      cwd: __dirname,
      script: './dist-server/server.js',
      instances: 1,              // single instance: monitor scheduler + realtime state are in-process
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      // Restart on crash with exponential back-off (1s doubling up to 15s); an app that stays up 30s counts as healthy again
      min_uptime: '30s',
      max_restarts: 50,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '700M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
        HOST: '127.0.0.1',       // only reachable through nginx
      },
      // Graceful shutdown (server/server.ts writes pending data to PostgreSQL on SIGINT/SIGTERM)
      kill_timeout: 10000,
      shutdown_with_message: process.platform === 'win32', // Windows has no SIGINT for child processes
      wait_ready: true,
      listen_timeout: 15000,     // the HTTP port opens before the database is ready (/api/health/ready reports progress)
      out_file: path.join(logDir, 'ops-out.log'),
      error_file: path.join(logDir, 'ops-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
