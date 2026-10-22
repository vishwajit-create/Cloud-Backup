const Redis = require('ioredis');
require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL;

let redis;

if (REDIS_URL && REDIS_URL.trim() !== '') {
  console.log('[Database] Initializing connection to Valkey/Redis...');
  redis = new Redis(REDIS_URL.trim(), {
    tls: {
      rejectUnauthorized: false
    },
    retryStrategy(times) {
      const delay = Math.min(times * 200, 3000);
      return delay;
    },
    maxRetriesPerRequest: 5,
    enableReadyCheck: true,
    connectTimeout: 15000
  });

  redis.on('connect', () => {
    console.log('✅ [Database] Connected to Valkey / Redis Cloud successfully.');
  });

  redis.on('ready', () => {
    console.log('🚀 [Database] Valkey / Redis Cloud is ready to process commands.');
  });

  redis.on('error', (err) => {
    console.error('❌ [Database] Valkey / Redis Error:', err.message);
  });
} else {
  console.warn('⚠️ [Database] REDIS_URL is not configured in environment variables.');
  redis = {
    status: 'missing_config',
    ping: async () => 'PONG_MOCK',
    get: async () => null,
    set: async () => 'OK',
    del: async () => 1,
    hgetall: async () => ({}),
    hset: async () => 1,
    smembers: async () => [],
    sadd: async () => 1,
    srem: async () => 1,
    getBuffer: async () => null,
    pipeline: () => ({
      hgetall: () => {},
      del: () => {},
      srem: () => {},
      exec: async () => []
    }),
    on: () => {}
  };
}

module.exports = redis;
