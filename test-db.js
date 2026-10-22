require('dotenv').config();
const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error('❌ REDIS_URL is not set in .env');
  process.exit(1);
}

console.log('Connecting to Valkey/Redis...');
const redis = new Redis(REDIS_URL, {
  tls: {
    rejectUnauthorized: false
  },
  connectTimeout: 10000,
  maxRetriesPerRequest: 2
});

redis.on('connect', () => {
  console.log('✅ Connected to Valkey/Redis successfully!');
});

redis.on('error', (err) => {
  console.error('❌ Redis error:', err.message);
});

async function run() {
  try {
    await redis.set('test_key', 'Hello from Backup App at ' + new Date().toISOString(), 'EX', 60);
    const val = await redis.get('test_key');
    console.log('✅ Retrieved test value from Valkey:', val);
    await redis.quit();
    process.exit(0);
  } catch (err) {
    console.error('❌ Operation failed:', err);
    process.exit(1);
  }
}

run();
