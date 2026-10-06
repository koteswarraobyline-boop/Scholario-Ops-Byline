/**
 * PM2 Ecosystem File — Scholario Ops Production
 *
 * Build first:   npm ci && npm run build
 * Start:         pm2 start ecosystem.config.js --env production
 *                pm2 save && pm2 startup
 *
 * Configuration is read from .env in this directory (see .env.example).
 */
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
      max_restarts: 10,
      restart_delay: 3000,
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
        HOST: '127.0.0.1',       // only reachable through nginx
      },
      // Graceful shutdown (server.ts flushes data to disk on SIGTERM)
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 15000,
      out_file: './logs/ops-out.log',
      error_file: './logs/ops-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
