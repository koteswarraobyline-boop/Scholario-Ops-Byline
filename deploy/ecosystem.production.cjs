/**
 * PM2 ecosystem — Scholario Ops production, release-based layout (see docs/CI-CD.md).
 *
 * REFERENCE ONLY. The authoritative file is the server's /var/www/scholario-ops/ecosystem.config.cjs,
 * which CI/CD never overwrites. During the one-time cutover, compare it with this file: the only
 * required change is `script`, which must point at the `current` release symlink. Keep the server's
 * existing name, cwd, node_args (--env-file=.env), env and log settings.
 *
 *   cwd    = /var/www/scholario-ops   → .env, data/ (DATA_DIR=./data), logs/ stay where they are
 *   script = /var/www/scholario-ops-releases/current/dist-server/server.js
 *            Node resolves the symlink, so dist/, dist-server/migrations and node_modules come
 *            from the live release; `pm2 restart scholario-ops --update-env` picks up a new release.
 */
const path = require('path');

const APP_HOME = '/var/www/scholario-ops';
const CURRENT = '/var/www/scholario-ops-releases/current';

module.exports = {
  apps: [
    {
      name: 'scholario-ops',
      cwd: APP_HOME,
      script: `${CURRENT}/dist-server/server.js`,
      node_args: '--env-file=.env',
      instances: 1,              // single instance: monitor scheduler + realtime state are in-process
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      min_uptime: '30s',
      max_restarts: 50,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '700M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 4100,
        HOST: '127.0.0.1',       // only reachable through nginx — never expose 4100
      },
      kill_timeout: 10000,       // graceful shutdown writes pending data to PostgreSQL
      wait_ready: true,
      listen_timeout: 15000,
      out_file: path.join(APP_HOME, 'logs', 'ops-out.log'),
      error_file: path.join(APP_HOME, 'logs', 'ops-error.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
