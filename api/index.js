let app;
let initError = null;

try {
  app = require('../server');
} catch (e) {
  initError = e;
  console.error('[Vercel Startup Error]:', e);
}

module.exports = (req, res) => {
  if (initError) {
    return res.status(500).json({
      success: false,
      error: 'Module initialization failed on Vercel',
      message: initError.message,
      stack: initError.stack
    });
  }

  try {
    return app(req, res);
  } catch (err) {
    console.error('[Vercel Request Error]:', err);
    return res.status(500).json({
      success: false,
      error: 'Request execution error',
      message: err.message,
      stack: err.stack
    });
  }
};
