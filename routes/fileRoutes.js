const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireAuth } = require('./authRoutes');
const fileService = require('../services/fileService');

const maxFileSizeMB = parseInt(process.env.MAX_FILE_SIZE_MB || '50');

// Configure Multer for in-memory storage (so we stream directly into Redis)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: maxFileSizeMB * 1024 * 1024 // e.g. 50 MB
  }
});

// Upload one or multiple files
router.post('/upload', requireAuth, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files were provided for backup' });
    }

    const uploadedResults = [];
    for (const file of req.files) {
      const backupMeta = await fileService.backupFileToDatabase(req.user.id, file);
      uploadedResults.push(backupMeta);
    }

    res.json({
      success: true,
      count: uploadedResults.length,
      files: uploadedResults,
      message: `${uploadedResults.length} file(s) safely backed up to Valkey/Redis!`
    });
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ success: false, message: err.message || 'File upload failed' });
  }
});

// List all files backed up for current user
router.get('/', requireAuth, async (req, res) => {
  try {
    const files = await fileService.getUserFiles(req.user.id);
    res.json({
      success: true,
      files
    });
  } catch (err) {
    console.error('List files error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve backed up files' });
  }
});

// Get user backup statistics
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const stats = await fileService.getUserStats(req.user.id);
    res.json({
      success: true,
      stats
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch backup statistics' });
  }
});

// Download a file
router.get('/:id/download', requireAuth, async (req, res) => {
  try {
    const { meta, buffer } = await fileService.getFileWithData(req.user.id, req.params.id);

    // Sanitize filename for content disposition
    const safeFilename = encodeURIComponent(meta.originalName);

    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${safeFilename}`);
    res.setHeader('Content-Length', buffer.length);

    res.send(buffer);
  } catch (err) {
    console.error('Download error:', err);
    res.status(404).json({ success: false, message: err.message || 'File not found' });
  }
});

// Preview a file (inline)
router.get('/:id/preview', requireAuth, async (req, res) => {
  try {
    const { meta, buffer } = await fileService.getFileWithData(req.user.id, req.params.id);

    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.originalName)}"`);
    res.setHeader('Content-Length', buffer.length);

    res.send(buffer);
  } catch (err) {
    console.error('Preview error:', err);
    res.status(404).json({ success: false, message: err.message || 'File not found' });
  }
});

// Delete a file
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await fileService.deleteFile(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('Delete error:', err);
    res.status(400).json({ success: false, message: err.message || 'Failed to delete file' });
  }
});

module.exports = router;
