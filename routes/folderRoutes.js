const express = require('express');
const router = express.Router();
const { requireAuth } = require('./authRoutes');
const folderService = require('../services/folderService');

// Create a new folder
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, color } = req.body;
    const folder = await folderService.createFolder(req.user.id, name, color);
    res.json({
      success: true,
      folder,
      message: `Folder "${folder.name}" created successfully`
    });
  } catch (err) {
    console.error('Create folder error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
});

// List all folders for current user
router.get('/', requireAuth, async (req, res) => {
  try {
    const folders = await folderService.getUserFolders(req.user.id);
    res.json({
      success: true,
      folders
    });
  } catch (err) {
    console.error('List folders error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve folders' });
  }
});

// Get single folder details
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const folder = await folderService.getFolder(req.user.id, req.params.id);
    res.json({
      success: true,
      folder
    });
  } catch (err) {
    console.error('Get folder error:', err);
    res.status(404).json({ success: false, message: err.message });
  }
});

// Rename folder
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    const folder = await folderService.renameFolder(req.user.id, req.params.id, name);
    res.json({
      success: true,
      folder,
      message: 'Folder renamed successfully'
    });
  } catch (err) {
    console.error('Rename folder error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
});

// Delete folder (files safely moved to root)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await folderService.deleteFolder(req.user.id, req.params.id);
    res.json({
      success: true,
      message: 'Folder deleted safely. Any files inside were moved to Home.',
      ...result
    });
  } catch (err) {
    console.error('Delete folder error:', err);
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
