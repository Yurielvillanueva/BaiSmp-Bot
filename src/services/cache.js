const Redis = require('ioredis');
const { logger } = require('../logger');

let redis = null;

function createRedisClient(env) {
  if (!env.REDIS_HOST) {
    logger.info('Redis not configured, using in-memory cache fallback');
    return createMemoryCache();
  }

  redis = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT || 6379,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB || 0,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: 3
  });

  redis.on('error', (err) => {
    logger.warn({ err }, 'Redis connection error');
  });

  redis.on('connect', () => {
    logger.info('Redis connected');
  });

  return createRedisCache(redis, env.CACHE_TTL_SECONDS || 300);
}

function createMemoryCache() {
  const cache = new Map();
  const timeouts = new Map();

  return {
    async get(key) {
      return cache.get(key);
    },
    async set(key, value, ttl = 300) {
      cache.set(key, value);
      if (timeouts.has(key)) clearTimeout(timeouts.get(key));
      const timeout = setTimeout(() => {
        cache.delete(key);
        timeouts.delete(key);
      }, ttl * 1000);
      timeouts.set(key, timeout);
    },
    async del(key) {
      cache.delete(key);
      if (timeouts.has(key)) {
        clearTimeout(timeouts.get(key));
        timeouts.delete(key);
      }
    },
    async delPattern(pattern) {
      for (const key of cache.keys()) {
        if (key.match(pattern.replace(/\*/g, '.*'))) {
          await this.del(key);
        }
      }
    },
    async flush() {
      cache.clear();
      for (const timeout of timeouts.values()) {
        clearTimeout(timeout);
      }
      timeouts.clear();
    },
    async quit() {
      await this.flush();
    }
  };
}

function createRedisCache(client, defaultTtl) {
  return {
    async get(key) {
      try {
        const value = await client.get(key);
        return value ? JSON.parse(value) : null;
      } catch (err) {
        logger.error({ err, key }, 'Redis get failed');
        return null;
      }
    },
    async set(key, value, ttl = defaultTtl) {
      try {
        const serialized = JSON.stringify(value);
        if (ttl) {
          await client.setex(key, ttl, serialized);
        } else {
          await client.set(key, serialized);
        }
      } catch (err) {
        logger.error({ err, key }, 'Redis set failed');
      }
    },
    async del(key) {
      try {
        await client.del(key);
      } catch (err) {
        logger.error({ err, key }, 'Redis del failed');
      }
    },
    async delPattern(pattern) {
      try {
        const keys = await client.keys(pattern);
        if (keys.length) {
          await client.del(...keys);
        }
      } catch (err) {
        logger.error({ err, pattern }, 'Redis delPattern failed');
      }
    },
    async flush() {
      try {
        await client.flushdb();
      } catch (err) {
        logger.error({ err }, 'Redis flush failed');
      }
    },
    async quit() {
      if (client) {
        await client.quit();
      }
    }
  };
}

function createCacheService(cache) {
  const prefixes = {
    stats: 'stats:',
    config: 'config:',
    status: 'status:',
    player: 'player:',
    link: 'link:',
    perf: 'perf:'
  };

  return {
    async getStats(uuid) {
      return cache.get(`${prefixes.stats}${uuid}`);
    },
    async setStats(uuid, data, ttl = 60) {
      await cache.set(`${prefixes.stats}${uuid}`, data, ttl);
    },
    async invalidateStats(uuid) {
      await cache.del(`${prefixes.stats}${uuid}`);
    },
    async invalidateAllStats() {
      await cache.delPattern(`${prefixes.stats}*`);
    },

    async getConfig(key) {
      return cache.get(`${prefixes.config}${key}`);
    },
    async setConfig(key, value, ttl = 300) {
      await cache.set(`${prefixes.config}${key}`, value, ttl);
    },
    async invalidateConfig(key) {
      await cache.del(`${prefixes.config}${key}`);
    },
    async invalidateAllConfig() {
      await cache.delPattern(`${prefixes.config}*`);
    },

    async getStatus(serverId) {
      return cache.get(`${prefixes.status}${serverId}`);
    },
    async setStatus(serverId, data, ttl = 30) {
      await cache.set(`${prefixes.status}${serverId}`, data, ttl);
    },
    async invalidateStatus(serverId) {
      await cache.del(`${prefixes.status}${serverId}`);
    },

    async getPlayerData(discordId) {
      return cache.get(`${prefixes.player}${discordId}`);
    },
    async setPlayerData(discordId, data, ttl = 600) {
      await cache.set(`${prefixes.player}${discordId}`, data, ttl);
    },
    async invalidatePlayer(discordId) {
      await cache.del(`${prefixes.player}${discordId}`);
    },

    async getLinkCode(codeHash) {
      return cache.get(`${prefixes.link}${codeHash}`);
    },
    async setLinkCode(codeHash, data, ttl = 600) {
      await cache.set(`${prefixes.link}${codeHash}`, data, ttl);
    },
    async invalidateLinkCode(codeHash) {
      await cache.del(`${prefixes.link}${codeHash}`);
    },

    async getPerfData(serverId) {
      return cache.get(`${prefixes.perf}${serverId}`);
    },
    async setPerfData(serverId, data, ttl = 60) {
      await cache.set(`${prefixes.perf}${serverId}`, data, ttl);
    },
    async invalidatePerf(serverId) {
      await cache.del(`${prefixes.perf}${serverId}`);
    },

    async flush() {
      await cache.flush();
    },

    async quit() {
      await cache.quit();
    }
  };
}

module.exports = { createRedisClient, createCacheService };
