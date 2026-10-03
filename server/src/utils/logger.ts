import pino from 'pino';

// Detect dev mode directly from env without importing config
// (config imports logger, so we must avoid circular deps here)
const isDev = (process.env.NODE_ENV ?? 'development') === 'development';

let transport: pino.TransportSingleOptions | undefined;

if (isDev) {
  try {
    // Only use pino-pretty if it is actually installed
    require.resolve('pino-pretty');
    transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname',
      },
    };
  } catch {
    // pino-pretty not available — fall back to plain JSON
    transport = undefined;
  }
}

export const logger = pino({
  level: isDev ? 'debug' : 'info',
  ...(transport ? { transport } : {}),
  base: { service: 'scholario-ops-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'body.password', 'body.password_hash'],
    censor: '[REDACTED]',
  },
});
