import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(config.redis.url, {
      keyPrefix: config.redis.keyPrefix,
      retryStrategy: (times) => {
        if (times > 10) return null; // stop retrying
        return Math.min(times * 100, 3000);
      },
      lazyConnect: false,
    });

    client.on('connect', () => logger.info('Redis connected'));
    client.on('error', (err) => logger.error({ err }, 'Redis error'));
    client.on('reconnecting', () => logger.warn('Redis reconnecting'));
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
    logger.info('Redis connection closed');
  }
}

export async function testRedis(): Promise<boolean> {
  try {
    const redis = getRedis();
    await redis.ping();
    logger.info('Redis PING OK');
    return true;
  } catch (err) {
    logger.error({ err }, 'Redis connection test failed');
    return false;
  }
}

// Convenience helpers
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  const val = await redis.get(key);
  return val ? (JSON.parse(val) as T) : null;
}

export async function cacheSet(key: string, value: unknown, ttlSec = 60): Promise<void> {
  const redis = getRedis();
  await redis.set(key, JSON.stringify(value), 'EX', ttlSec);
}

export async function cacheDel(key: string): Promise<void> {
  const redis = getRedis();
  await redis.del(key);
}

export async function cacheDelPattern(pattern: string): Promise<void> {
  const redis = getRedis();
  // Note: keyPrefix is prepended automatically, use raw client for SCAN
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
