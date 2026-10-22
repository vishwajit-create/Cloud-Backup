const Redis = require('ioredis');
require('dotenv').config();

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error('❌ [Database] REDIS_URL is missing. Please define REDIS_URL in your .env file.');
  process.exit(1);
}

console.log('[Database] Initializing connection to Valkey/Redis...');

const redis = new Redis(REDIS_URL, {
  tls: {
    rejectUnauthorized: false
  },
  retryStrategy(times) {
    const delay = Math.min(times * 200, 3000);
    console.log(`[Database] Reconnecting in ${delay}ms... (attempt ${times})`);
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

module.exports = redis;
