const redis = require('../config/redis');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const path = require('path');

/**
 * Save an uploaded file directly into Valkey / Redis database for backup
 * @param {string} userId
 * @param {Express.Multer.File} file
 * @param {string} folderId - defaults to 'root'
 */
async function backupFileToDatabase(userId, file, folderId = 'root') {
  const fileId = 'file_' + uuidv4().replace(/-/g, '');
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '') || 'bin';
  const now = new Date().toISOString();

  // Validate folderId if specified
  const effectiveFolderId = (folderId && folderId !== 'root') ? folderId : 'root';
  if (effectiveFolderId !== 'root') {
    const folder = await redis.hgetall(`folder:${effectiveFolderId}`);
    if (!folder || !folder.folderId || folder.userId !== userId) {
      throw new Error('Target folder does not exist or unauthorized');
    }
  }

  // 1. Store the actual binary file content in Redis
  const dataKey = `file:data:${fileId}`;
  await redis.set(dataKey, file.buffer);

  // 2. Store metadata in Redis
  const metaKey = `file:meta:${fileId}`;
  const metadata = {
    fileId,
    userId,
    originalName: file.originalname,
    mimeType: file.mimetype || 'application/octet-stream',
    size: file.size.toString(),
    extension: ext,
    folderId: effectiveFolderId,
    isStarred: 'false',
    isTrash: 'false',
    uploadDate: now
  };

  const pipeline = redis.pipeline();
  pipeline.hset(metaKey, metadata);

  // 3. Add to user's file index
  const userFilesKey = `user:${userId}:files`;
  pipeline.sadd(userFilesKey, fileId);

  // 4. Add to folder index if inside a folder
  if (effectiveFolderId !== 'root') {
    pipeline.sadd(`folder:${effectiveFolderId}:files`, fileId);
  }

  await pipeline.exec();

  return {
    ...metadata,
    size: file.size,
    isStarred: false,
    isTrash: false
  };
}

/**
 * List all active backed up files for a user (excluding trash)
 */
async function getUserFiles(userId) {
  const userFilesKey = `user:${userId}:files`;
  const fileIds = await redis.smembers(userFilesKey);

  if (!fileIds || fileIds.length === 0) {
    return [];
  }

  const pipeline = redis.pipeline();
  for (const id of fileIds) {
    pipeline.hgetall(`file:meta:${id}`);
  }

  const results = await pipeline.exec();
  const files = [];

  for (let i = 0; i < results.length; i++) {
    const [err, meta] = results[i];
    if (!err && meta && meta.fileId) {
      // Skip trashed files if any leaked into active list
      if (meta.isTrash === 'true') continue;

      files.push({
        ...meta,
        folderId: meta.folderId || 'root',
        isStarred: meta.isStarred === 'true',
        isTrash: false,
        size: parseInt(meta.size || '0')
      });
    } else if (!meta || !meta.fileId) {
      // Clean up orphaned ID
      await redis.srem(userFilesKey, fileIds[i]);
    }
  }

  // Sort by upload date descending (newest first)
  files.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

  return files;
}

/**
 * Retrieve file metadata and binary data from Redis
 */
async function getFileWithData(userId, fileId) {
  const meta = await redis.hgetall(`file:meta:${fileId}`);
  if (!meta || !meta.fileId) {
    throw new Error('File not found in database backup');
  }

  if (meta.userId !== userId) {
    throw new Error('Access denied: You do not own this backup file');
  }

  const buffer = await redis.getBuffer(`file:data:${fileId}`);
  if (!buffer) {
    throw new Error('File binary content is missing from database');
  }

  return {
    meta: {
      ...meta,
      folderId: meta.folderId || 'root',
      isStarred: meta.isStarred === 'true',
      isTrash: meta.isTrash === 'true',
      size: parseInt(meta.size || '0')
    },
    buffer
  };
}

/**
 * Move a file to Trash (Soft Delete)
 */
async function trashFile(userId, fileId) {
  const meta = await redis.hgetall(`file:meta:${fileId}`);
  if (!meta || !meta.fileId) {
    throw new Error('File not found');
  }

  if (meta.userId !== userId) {
    throw new Error('Unauthorized: You do not own this file');
  }

  const now = new Date().toISOString();
  const pipeline = redis.pipeline();

  pipeline.hset(`file:meta:${fileId}`, {
    isTrash: 'true',
    trashedAt: now
  });

  pipeline.srem(`user:${userId}:files`, fileId);
  pipeline.sadd(`user:${userId}:trash`, fileId);

  // Remove from folder set while in trash
  if (meta.folderId && meta.folderId !== 'root') {
    pipeline.srem(`folder:${meta.folderId}:files`, fileId);
  }

  await pipeline.exec();

  return { success: true, fileId, isTrash: true, message: 'File moved to Trash' };
}

/**
 * Restore a file from Trash
 */
async function restoreFile(userId, fileId) {
  const meta = await redis.hgetall(`file:meta:${fileId}`);
  if (!meta || !meta.fileId) {
    throw new Error('File not found');
  }

  if (meta.userId !== userId) {
    throw new Error('Unauthorized: You do not own this file');
  }

  let targetFolder = meta.folderId || 'root';
  if (targetFolder !== 'root') {
    const folder = await redis.hgetall(`folder:${targetFolder}`);
    if (!folder || !folder.folderId || folder.userId !== userId) {
      targetFolder = 'root'; // Fallback to Home if original folder was deleted
    }
  }

  const pipeline = redis.pipeline();
  pipeline.hset(`file:meta:${fileId}`, {
    isTrash: 'false',
    folderId: targetFolder
  });
  pipeline.hdel(`file:meta:${fileId}`, 'trashedAt');

  pipeline.srem(`user:${userId}:trash`, fileId);
  pipeline.sadd(`user:${userId}:files`, fileId);

  if (targetFolder !== 'root') {
    pipeline.sadd(`folder:${targetFolder}:files`, fileId);
  }

  await pipeline.exec();

  return { success: true, fileId, isTrash: false, folderId: targetFolder, message: 'File restored successfully' };
}

/**
 * List all files currently in Trash
 */
async function getTrashFiles(userId) {
  const trashIds = await redis.smembers(`user:${userId}:trash`);
  if (!trashIds || trashIds.length === 0) {
    return [];
  }

  const pipeline = redis.pipeline();
  for (const id of trashIds) {
    pipeline.hgetall(`file:meta:${id}`);
  }

  const results = await pipeline.exec();
  const files = [];

  for (let i = 0; i < trashIds.length; i++) {
    const [err, meta] = results[i];
    if (!err && meta && meta.fileId) {
      files.push({
        ...meta,
        folderId: meta.folderId || 'root',
        isStarred: meta.isStarred === 'true',
        isTrash: true,
        trashedAt: meta.trashedAt || meta.uploadDate,
        size: parseInt(meta.size || '0')
      });
    } else {
      await redis.srem(`user:${userId}:trash`, trashIds[i]);
    }
  }

  // Sort by trashed date descending (newest trashed first)
  files.sort((a, b) => new Date(b.trashedAt || b.uploadDate) - new Date(a.trashedAt || a.uploadDate));

  return files;
}

/**
 * Delete a file permanently (Hard Delete)
 */
async function deletePermanently(userId, fileId) {
  const meta = await redis.hgetall(`file:meta:${fileId}`);
  if (!meta || !meta.fileId) {
    throw new Error('File not found');
  }

  if (meta.userId !== userId) {
    throw new Error('Access denied: You do not own this backup file');
  }

  const pipeline = redis.pipeline();
  pipeline.del(`file:data:${fileId}`);
  pipeline.del(`file:meta:${fileId}`);
  pipeline.srem(`user:${userId}:files`, fileId);
  pipeline.srem(`user:${userId}:trash`, fileId);
  pipeline.srem(`user:${userId}:starred`, fileId);

  if (meta.folderId && meta.folderId !== 'root') {
    pipeline.srem(`folder:${meta.folderId}:files`, fileId);
  }

  // Clean up any shares for this file
  pipeline.del(`file:${fileId}:shares`);

  await pipeline.exec();

  return { success: true, fileId, message: 'File permanently deleted' };
}

/**
 * Empty all files from Trash permanently
 */
async function emptyTrash(userId) {
  const trashIds = await redis.smembers(`user:${userId}:trash`);
  if (!trashIds || trashIds.length === 0) {
    return { success: true, deletedCount: 0 };
  }

  for (const id of trashIds) {
    await deletePermanently(userId, id);
  }

  return { success: true, deletedCount: trashIds.length, message: `${trashIds.length} file(s) permanently purged from Trash` };
}

/**
 * Toggle Star / Favorite for a file
 */
async function toggleStarFile(userId, fileId) {
  const meta = await redis.hgetall(`file:meta:${fileId}`);
  if (!meta || !meta.fileId) {
    throw new Error('File not found');
  }

  if (meta.userId !== userId) {
    throw new Error('Unauthorized: You do not own this file');
  }

  const currentlyStarred = meta.isStarred === 'true';
  const newStarred = !currentlyStarred;

  const pipeline = redis.pipeline();
  pipeline.hset(`file:meta:${fileId}`, 'isStarred', newStarred ? 'true' : 'false');

  if (newStarred) {
    pipeline.sadd(`user:${userId}:starred`, fileId);
  } else {
    pipeline.srem(`user:${userId}:starred`, fileId);
  }

  await pipeline.exec();

  return {
    fileId,
    isStarred: newStarred,
    message: newStarred ? 'Added to Starred favorites' : 'Removed from Starred favorites'
  };
}

/**
 * Move a file to another folder (or 'root')
 */
async function moveFileToFolder(userId, fileId, targetFolderId = 'root') {
  const meta = await redis.hgetall(`file:meta:${fileId}`);
  if (!meta || !meta.fileId) {
    throw new Error('File not found');
  }

  if (meta.userId !== userId) {
    throw new Error('Unauthorized: You do not own this file');
  }

  const effectiveTarget = (targetFolderId && targetFolderId !== 'root') ? targetFolderId : 'root';

  if (effectiveTarget !== 'root') {
    const folder = await redis.hgetall(`folder:${effectiveTarget}`);
    if (!folder || !folder.folderId || folder.userId !== userId) {
      throw new Error('Target folder does not exist or unauthorized');
    }
  }

  const currentFolder = meta.folderId || 'root';
  if (currentFolder === effectiveTarget) {
    return { fileId, folderId: effectiveTarget, changed: false };
  }

  const pipeline = redis.pipeline();

  // Remove from old folder set
  if (currentFolder !== 'root') {
    pipeline.srem(`folder:${currentFolder}:files`, fileId);
  }

  // Add to new folder set
  if (effectiveTarget !== 'root') {
    pipeline.sadd(`folder:${effectiveTarget}:files`, fileId);
  }

  // Update metadata
  pipeline.hset(`file:meta:${fileId}`, 'folderId', effectiveTarget);

  await pipeline.exec();

  return {
    fileId,
    folderId: effectiveTarget,
    changed: true,
    message: `File moved to ${effectiveTarget === 'root' ? 'Home' : 'folder'} successfully`
  };
}

/**
 * Batch Move multiple files to a folder
 */
async function batchMoveFiles(userId, fileIds, targetFolderId = 'root') {
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    throw new Error('No files provided for move');
  }

  let movedCount = 0;
  for (const id of fileIds) {
    try {
      await moveFileToFolder(userId, id, targetFolderId);
      movedCount++;
    } catch (e) {
      console.warn(`Could not move file ${id}:`, e.message);
    }
  }

  return { success: true, movedCount, targetFolderId, message: `${movedCount} file(s) moved successfully` };
}

/**
 * Batch Trash multiple files
 */
async function batchTrashFiles(userId, fileIds) {
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    throw new Error('No files provided');
  }

  let trashedCount = 0;
  for (const id of fileIds) {
    try {
      await trashFile(userId, id);
      trashedCount++;
    } catch (e) {
      console.warn(`Could not trash file ${id}:`, e.message);
    }
  }

  return { success: true, trashedCount, message: `${trashedCount} file(s) moved to Trash` };
}

async function createZipArchive(options = { zlib: { level: 6 } }) {
  let mod;
  try {
    mod = await import('archiver');
  } catch (e) {
    mod = require('archiver');
  }
  if (mod.ZipArchive) {
    return new mod.ZipArchive(options);
  }
  const fn = mod.default || mod;
  if (typeof fn === 'function') {
    return fn('zip', options);
  }
  throw new Error('Unsupported archiver module structure');
}

/**
 * Stream multiple files packaged together as a ZIP archive
 */
async function downloadFilesAsZip(userId, fileIds, res) {
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    throw new Error('No files selected for batch download');
  }

  const zipFilename = `CloudVault_Backup_${Date.now()}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

  const archive = await createZipArchive({ zlib: { level: 6 } });

  archive.on('error', (err) => {
    console.error('ZIP generation error:', err);
    if (!res.headersSent) {
      res.status(500).send('Error creating ZIP archive');
    }
  });

  archive.pipe(res);

  const seenNames = new Map();

  for (const fileId of fileIds) {
    try {
      const { meta, buffer } = await getFileWithData(userId, fileId);
      let filename = meta.originalName || `file_${fileId}`;

      // Handle duplicate filenames in zip
      if (seenNames.has(filename)) {
        const count = seenNames.get(filename) + 1;
        seenNames.set(filename, count);
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        filename = `${base} (${count})${ext}`;
      } else {
        seenNames.set(filename, 1);
      }

      archive.append(buffer, { name: filename });
    } catch (e) {
      console.warn(`Skipping missing file ${fileId} in ZIP:`, e.message);
    }
  }

  await archive.finalize();
}

/**
 * Get user backup summary stats including storage quota & categories
 */
async function getUserStats(userId) {
  const files = await getUserFiles(userId);
  const totalFiles = files.length;
  const totalSizeBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
  const starredCount = files.filter(f => f.isStarred).length;
  const trashCount = await redis.scard(`user:${userId}:trash`);

  // Storage Quota: 500 MB Free Tier
  const quotaBytes = 500 * 1024 * 1024;
  const usagePercent = Math.min(100, Math.round((totalSizeBytes / quotaBytes) * 1000) / 10);

  // Group by category
  const categories = {
    documents: { count: 0, size: 0 },
    images: { count: 0, size: 0 },
    archives: { count: 0, size: 0 },
    media: { count: 0, size: 0 },
    other: { count: 0, size: 0 }
  };

  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  const docExts = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'md'];
  const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];
  const mediaExts = ['mp3', 'wav', 'ogg', 'mp4', 'mov', 'avi', 'mkv', 'webm', 'flac'];

  for (const f of files) {
    const ext = (f.extension || '').toLowerCase();
    const sz = f.size || 0;
    if (imageExts.includes(ext)) { categories.images.count++; categories.images.size += sz; }
    else if (docExts.includes(ext)) { categories.documents.count++; categories.documents.size += sz; }
    else if (archiveExts.includes(ext)) { categories.archives.count++; categories.archives.size += sz; }
    else if (mediaExts.includes(ext)) { categories.media.count++; categories.media.size += sz; }
    else { categories.other.count++; categories.other.size += sz; }
  }

  return {
    totalFiles,
    totalSizeBytes,
    totalSizeFormatted: formatBytes(totalSizeBytes),
    quotaBytes,
    quotaFormatted: formatBytes(quotaBytes),
    usagePercent,
    starredCount,
    trashCount,
    categories
  };
}

function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

module.exports = {
  backupFileToDatabase,
  getUserFiles,
  getFileWithData,
  deleteFile: trashFile, // default delete is soft-delete to Trash
  trashFile,
  restoreFile,
  getTrashFiles,
  deletePermanently,
  emptyTrash,
  toggleStarFile,
  moveFileToFolder,
  batchMoveFiles,
  batchTrashFiles,
  downloadFilesAsZip,
  getUserStats,
  formatBytes
};
