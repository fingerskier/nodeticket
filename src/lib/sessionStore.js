/**
 * Session store factory.
 *
 * Default: MemoryStore (express-session built-in) — single process only.
 * Optional Redis: install peer deps `redis` + `connect-redis`, then set
 *   SESSION_STORE=redis
 *   REDIS_URL=redis://127.0.0.1:6379
 *
 * @module lib/sessionStore
 */

/**
 * Resolve an express-session store, or null for MemoryStore default.
 * @returns {{ store: import('express-session').Store|null, name: string, warning?: string }}
 */
function createSessionStore() {
  const wantRedis =
    String(process.env.SESSION_STORE || '').toLowerCase() === 'redis';

  if (!wantRedis) {
    return { store: null, name: 'memory' };
  }

  const redisUrl = process.env.REDIS_URL || process.env.REDIS_URI || '';
  if (!redisUrl) {
    return {
      store: null,
      name: 'memory',
      warning:
        'SESSION_STORE=redis set but REDIS_URL is missing; using MemoryStore. ' +
        'Set REDIS_URL (e.g. redis://127.0.0.1:6379).',
    };
  }

  let RedisStore;
  let createClient;
  try {
    // Optional peer dependencies — not installed by default
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    const connectRedis = require('connect-redis');
    RedisStore = connectRedis.RedisStore || connectRedis.default || connectRedis;
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    ({ createClient } = require('redis'));
  } catch (err) {
    return {
      store: null,
      name: 'memory',
      warning:
        'SESSION_STORE=redis requested but optional peers are not installed. ' +
        'Run: npm install redis connect-redis  (peerDependencies of nodeticket). ' +
        `Using MemoryStore. (${err.code || err.message})`,
    };
  }

  if (typeof RedisStore !== 'function' || typeof createClient !== 'function') {
    return {
      store: null,
      name: 'memory',
      warning:
        'connect-redis/redis loaded but expected exports missing; using MemoryStore. ' +
        'Need connect-redis@^9 (RedisStore export) and redis@^5.',
    };
  }

  try {
    const redisClient = createClient({ url: redisUrl });
    redisClient.on('error', (err) => {
      console.error('Redis session client error:', err.message);
    });
    redisClient.connect().catch((err) => {
      console.error('Redis session store connect failed:', err.message);
    });

    const store = new RedisStore({
      client: redisClient,
      prefix: process.env.REDIS_SESSION_PREFIX || 'nt:sess:',
    });

    return { store, name: 'redis' };
  } catch (err) {
    return {
      store: null,
      name: 'memory',
      warning:
        `Failed to initialize Redis session store (${err.message}); using MemoryStore.`,
    };
  }
}

module.exports = {
  createSessionStore,
};
