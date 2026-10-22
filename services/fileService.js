const redis = require('../config/redis');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const path = require('path');

/**
 * Save an uploaded file directly into Valkey / Redis database for backup
 * @param {string} userId
 * @param {Express.Multer.File} file
 */
async function backupFileToDatabase(userId, file) {
  const fileId = 'file_' + uuidv4().replace(/-/g, '');
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '') || 'bin';
  const now = new Date().toISOString();

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
    uploadDate: now
  };

  await redis.hset(metaKey, metadata);

  // 3. Add to user's file index
  const userFilesKey = `user:${userId}:files`;
  await redis.sadd(userFilesKey, fileId);

  return metadata;
}

/**
 * List all backed up files for a user
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
      files.push({
        ...meta,
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
      size: parseInt(meta.size || '0')
    },
    buffer
  };
}

/**
 * Delete a file from Redis backup
 */
async function deleteFile(userId, fileId) {
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
  await pipeline.exec();

  return { success: true, fileId };
}

/**
 * Get user backup summary stats
 */
async function getUserStats(userId) {
  const files = await getUserFiles(userId);
  const totalFiles = files.length;
  const totalSizeBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);

  // Group by category
  const categories = {
    documents: 0,
    images: 0,
    archives: 0,
    media: 0,
    other: 0
  };

  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  const docExts = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'md'];
  const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];
  const mediaExts = ['mp3', 'wav', 'ogg', 'mp4', 'mov', 'avi', 'mkv', 'webm', 'flac'];

  for (const f of files) {
    const ext = (f.extension || '').toLowerCase();
    if (imageExts.includes(ext)) categories.images++;
    else if (docExts.includes(ext)) categories.documents++;
    else if (archiveExts.includes(ext)) categories.archives++;
    else if (mediaExts.includes(ext)) categories.media++;
    else categories.other++;
  }

  return {
    totalFiles,
    totalSizeBytes,
    totalSizeFormatted: formatBytes(totalSizeBytes),
    categories
  };
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
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
  deleteFile,
  getUserStats,
  formatBytes
};
