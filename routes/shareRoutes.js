const express = require('express');
const router = express.Router();
const { requireAuth } = require('./authRoutes');
const shareService = require('../services/shareService');

// ==========================================
// 🔒 PROTECTED SHARE ROUTES (Logged-in User)
// ==========================================

// Create a new share link
router.post('/create', requireAuth, async (req, res) => {
  try {
    const { fileId, expiresIn, maxDownloads, password } = req.body;
    if (!fileId) {
      return res.status(400).json({ success: false, message: 'File ID is required' });
    }

    const share = await shareService.createShareLink(req.user.id, fileId, {
      expiresIn: parseInt(expiresIn ?? 86400),
      maxDownloads: parseInt(maxDownloads ?? 0),
      password: password || ''
    });

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const shareUrl = `${protocol}://${host}/share/${share.shareId}`;

    res.json({
      success: true,
      shareUrl,
      share,
      message: 'Share link generated successfully!'
    });
  } catch (err) {
    console.error('Create share error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
});

// List all active share links for a file
router.get('/file/:fileId', requireAuth, async (req, res) => {
  try {
    const shares = await shareService.getFileShares(req.user.id, req.params.fileId);
    res.json({ success: true, shares });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Revoke a share link
router.delete('/:shareId', requireAuth, async (req, res) => {
  try {
    const result = await shareService.revokeShareLink(req.user.id, req.params.shareId);
    res.json({ success: true, message: 'Share link revoked successfully', ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ==========================================
// 🌐 PUBLIC SHARE ROUTES (Anyone with Link)
// ==========================================

// Get share metadata (public)
router.get('/public/:shareId', async (req, res) => {
  try {
    const share = await shareService.getShareInfo(req.params.shareId);
    if (!share) {
      return res.status(404).json({ success: false, message: 'Share link not found or has expired' });
    }
    if (share.expired) {
      return res.status(410).json({
        success: false,
        expired: true,
        message: share.reason === 'download_limit_reached'
          ? 'This share link has reached its maximum download limit.'
          : 'This share link has expired.'
      });
    }

    res.json({ success: true, share });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Verify password for locked share
router.post('/public/:shareId/verify', async (req, res) => {
  try {
    const { password } = req.body;
    await shareService.verifySharePassword(req.params.shareId, password);
    res.json({ success: true, verified: true, message: 'Password verified' });
  } catch (err) {
    res.status(401).json({ success: false, message: err.message });
  }
});

// Download shared file
router.get('/public/:shareId/download', async (req, res) => {
  try {
    const password = req.query.pwd || req.headers['x-share-password'] || '';
    const { meta, buffer } = await shareService.getSharedFileWithData(req.params.shareId, password);

    const safeFilename = encodeURIComponent(meta.originalName);
    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${safeFilename}`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    let statusCode = 403;
    if (err.message.includes('Password required') || err.message.includes('Incorrect password')) {
      statusCode = 401;
    } else if (err.message.includes('Download limit reached') || err.message.includes('expired')) {
      statusCode = 410;
    } else if (err.message.includes('not exist')) {
      statusCode = 404;
    }
    res.status(statusCode).json({ success: false, message: err.message });
  }
});

// Preview shared file
router.get('/public/:shareId/preview', async (req, res) => {
  try {
    const password = req.query.pwd || req.headers['x-share-password'] || '';
    const { meta, buffer } = await shareService.getSharedFileWithData(req.params.shareId, password);

    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.originalName)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    let statusCode = 403;
    if (err.message.includes('Password required') || err.message.includes('Incorrect password')) {
      statusCode = 401;
    } else if (err.message.includes('Download limit reached') || err.message.includes('expired')) {
      statusCode = 410;
    } else if (err.message.includes('not exist')) {
      statusCode = 404;
    }
    res.status(statusCode).json({ success: false, message: err.message });
  }
});

module.exports = router;
