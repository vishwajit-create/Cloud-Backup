const Redis = require('ioredis');
require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL;

let redis;

if (REDIS_URL) {
  console.log('[Database] Initializing connection to Valkey/Redis...');
  redis = new Redis(REDIS_URL, {
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
  console.warn('⚠️ [Database] REDIS_URL is not set. A mock client will be used until REDIS_URL is configured in Vercel settings.');
  redis = new Proxy({}, {
    get(target, prop) {
      if (prop === 'status') return 'missing_config';
      return async () => {
        throw new Error('REDIS_URL environment variable is missing. Please set it in your Vercel project settings.');
      };
    }
  });
}

module.exports = redis;
