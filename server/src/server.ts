import http from 'http';
import { createApp } from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { testConnection, closePool } from './database/pool';
import { testRedis, closeRedis } from './database/redis';
import { initWebSocket } from './realtime/websocket';
import { startMonitorWorker } from './workers/monitorWorker';
import { startEscalationWorker } from './workers/escalationWorker';
import { startDeadManWorker } from './workers/deadManWorker';

async function main() {
  logger.info({ env: config.env, port: config.port }, 'Starting Scholario Ops API...');

  // ── Database connectivity ──────────────────────────────────────────────────
  const dbOk = await testConnection();
  if (!dbOk) {
    logger.error('PostgreSQL connection failed — aborting startup');
    process.exit(1);
  }

  const redisOk = await testRedis();
  if (!redisOk) {
    logger.warn('Redis connection failed — caching disabled, continuing');
  }

  // ── HTTP server ────────────────────────────────────────────────────────────
  const app = createApp();
  const server = http.createServer(app);

  // ── WebSocket ─────────────────────────────────────────────────────────────
  initWebSocket(server);

  // ── Background workers ────────────────────────────────────────────────────
  if (!config.isTest()) {
    startMonitorWorker();
    startEscalationWorker();
    startDeadManWorker();
  }

  // ── Start listening ───────────────────────────────────────────────────────
  server.listen(config.port, () => {
    logger.info(
      { port: config.port, url: `http://localhost:${config.port}` },
      '✅ Scholario Ops API listening'
    );
    logger.info({ url: `ws://localhost:${config.port}/ws` }, '✅ WebSocket ready');
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  async function shutdown(signal: string) {
    logger.info({ signal }, 'Shutting down gracefully...');

    server.close(async () => {
      try {
        await closePool();
        await closeRedis();
        logger.info('Graceful shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    });

    // Force exit after 15s
    setTimeout(() => {
      logger.error('Forced shutdown after 15s timeout');
      process.exit(1);
    }, 15_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled promise rejection');
    shutdown('unhandledRejection');
  });
}

main();
