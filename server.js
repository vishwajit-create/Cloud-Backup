require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const redis = require('./config/redis');
const { router: authRouter } = require('./routes/authRoutes');
const fileRouter = require('./routes/fileRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Database Health & Status check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const pingStart = Date.now();
    await redis.ping();
    const latency = Date.now() - pingStart;

    res.json({
      status: 'online',
      database: 'Valkey / Redis (Aiven Cloud)',
      connected: redis.status === 'ready',
      latencyMs: latency,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      database: 'Valkey / Redis',
      connected: false,
      error: err.message
    });
  }
});

// Mount API routes
app.use('/api/auth', authRouter);
app.use('/api/files', fileRouter);

// Fallback to index.html for single-page routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error occurred'
  });
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 File Backup App running at http://localhost:${PORT}`);
  console.log(`📦 Database: Valkey Cloud (TLS Rediss) connected`);
  console.log(`======================================================\n`);
});
