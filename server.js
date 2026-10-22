require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const redis = require('./config/redis');
const { router: authRouter } = require('./routes/authRoutes');
const fileRouter = require('./routes/fileRoutes');
const { testTextBeeConnection } = require('./services/smsService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static frontend assets (for local development)
if (!process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, 'public')));
}

// Database Health & Status check endpoint (supports both /api/health and /health)
const healthHandler = async (req, res) => {
  try {
    if (!process.env.REDIS_URL) {
      return res.json({
        status: 'warning',
        database: 'Valkey / Redis',
        connected: false,
        message: 'REDIS_URL is not configured in environment variables'
      });
    }

    const pingStart = Date.now();
    await redis.ping();
    const latency = Date.now() - pingStart;

    res.json({
      status: 'online',
      database: 'Valkey / Redis (Aiven Cloud)',
      connected: redis.status === 'ready' || redis.status === 'connect',
      latencyMs: latency,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.json({
      status: 'degraded',
      database: 'Valkey / Redis',
      connected: false,
      error: err.message
    });
  }
};

app.get('/api/health', healthHandler);
app.get('/health', healthHandler);

// ─── TextBee Diagnostic Endpoint ─────────────────────────────────────────────
// Visit: /api/diagnose/textbee  to check your TextBee configuration live
app.get('/api/diagnose/textbee', async (req, res) => {
  try {
    const result = await testTextBeeConnection();
    const healthy = result.apiKeySet && !result.error;
    res.status(healthy ? 200 : 400).json({
      success: healthy,
      service: 'TextBee SMS Gateway',
      ...result,
      instructions: !result.apiKeySet
        ? 'Go to Vercel → Project → Settings → Environment Variables → Add TEXTBEE_API_KEY'
        : !result.deviceIdSet
        ? 'Optional: Set TEXTBEE_DEVICE_ID to pin a specific Android device'
        : result.error
        ? 'Fix the error above, then redeploy on Vercel'
        : 'Configuration looks good! If SMS still fails, check device is online in TextBee app.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Mount API routes (supports both /api/* and root fallback on Vercel)
app.use('/api/auth', authRouter);
app.use('/auth', authRouter);

app.use('/api/files', fileRouter);
app.use('/files', fileRouter);

// Fallback for unmatched API routes
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: 'API route not found' });
});

// Fallback to index.html ONLY when running locally (not on Vercel)
if (!process.env.VERCEL) {
  app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error occurred'
  });
});

// Start local listener only if not running inside Vercel serverless environment
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 File Backup App running at http://localhost:${PORT}`);
    console.log(`📦 Database: Valkey Cloud (TLS Rediss) connected`);
    console.log(`======================================================\n`);
  });
}

module.exports = app;
