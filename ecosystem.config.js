/**
 * PM2 Ecosystem File — Scholario Ops Production
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup
 */
module.exports = {
  apps: [
    {
      name: 'scholario-ops-api',
      cwd: './server',
      script: './dist/server.js',
      instances: 1,              // single instance (WebSocket state is in-process)
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      // Graceful shutdown
      kill_timeout: 15000,
      wait_ready: true,
      listen_timeout: 10000,
      // Logs
      out_file: './logs/api-out.log',
      error_file: './logs/api-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
