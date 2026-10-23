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

    const folderId = req.body.folderId || 'root';
    const uploadedResults = [];
    for (const file of req.files) {
      const backupMeta = await fileService.backupFileToDatabase(req.user.id, file, folderId);
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

// ==========================================
// 🗑️ TRASH BIN ROUTES (Before /:id)
// ==========================================

// List files in Trash
router.get('/trash', requireAuth, async (req, res) => {
  try {
    const files = await fileService.getTrashFiles(req.user.id);
    res.json({ success: true, files });
  } catch (err) {
    console.error('List trash error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve trash' });
  }
});

// Empty entire Trash
router.delete('/trash/empty', requireAuth, async (req, res) => {
  try {
    const result = await fileService.emptyTrash(req.user.id);
    res.json(result);
  } catch (err) {
    console.error('Empty trash error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 📦 BATCH ACTIONS ROUTES (Before /:id)
// ==========================================

// Batch download selected files as ZIP
router.post('/batch/download-zip', requireAuth, async (req, res) => {
  try {
    const { fileIds } = req.body;
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No files provided for ZIP' });
    }
    await fileService.downloadFilesAsZip(req.user.id, fileIds, res);
  } catch (err) {
    console.error('Batch ZIP error:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
});

// Support GET for batch download (direct link/download)
router.get('/batch/download-zip', requireAuth, async (req, res) => {
  try {
    const fileIds = (req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (fileIds.length === 0) {
      return res.status(400).send('No file IDs provided');
    }
    await fileService.downloadFilesAsZip(req.user.id, fileIds, res);
  } catch (err) {
    console.error('Batch ZIP error:', err);
    if (!res.headersSent) {
      res.status(500).send(err.message);
    }
  }
});

// Batch move files
router.post('/batch/move', requireAuth, async (req, res) => {
  try {
    const { fileIds, folderId } = req.body;
    const result = await fileService.batchMoveFiles(req.user.id, fileIds, folderId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Batch trash files
router.post('/batch/trash', requireAuth, async (req, res) => {
  try {
    const { fileIds } = req.body;
    const result = await fileService.batchTrashFiles(req.user.id, fileIds);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
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

// Toggle Star/Favorite for a file
router.post('/:id/star', requireAuth, async (req, res) => {
  try {
    const result = await fileService.toggleStarFile(req.user.id, req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Toggle star error:', err);
    res.status(400).json({ success: false, message: err.message || 'Failed to update star status' });
  }
});

// Move a file to another folder
router.post('/:id/move', requireAuth, async (req, res) => {
  try {
    const { folderId } = req.body;
    const result = await fileService.moveFileToFolder(req.user.id, req.params.id, folderId);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Move file error:', err);
    res.status(400).json({ success: false, message: err.message || 'Failed to move file' });
  }
});

// Restore single file from trash
router.post('/:id/restore', requireAuth, async (req, res) => {
  try {
    const result = await fileService.restoreFile(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('Restore error:', err);
    res.status(400).json({ success: false, message: err.message || 'Failed to restore file' });
  }
});

// Permanently delete single file
router.delete('/:id/permanent', requireAuth, async (req, res) => {
  try {
    const result = await fileService.deletePermanently(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('Permanent delete error:', err);
    res.status(400).json({ success: false, message: err.message || 'Failed to permanently delete file' });
  }
});

module.exports = router;
