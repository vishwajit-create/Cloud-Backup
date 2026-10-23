const redis = require('../config/redis');
const crypto = require('crypto');

/**
 * Create a new folder for a user
 * @param {string} userId
 * @param {string} name
 * @param {string} color - e.g. 'indigo', 'blue', 'emerald', 'amber', 'rose', 'purple'
 */
async function createFolder(userId, name, color = 'indigo') {
  const cleanName = (name || '').trim();
  if (!cleanName) {
    throw new Error('Folder name cannot be empty');
  }
  if (cleanName.length > 50) {
    throw new Error('Folder name cannot exceed 50 characters');
  }

  // Prevent illegal characters
  if (/[<>:"/\\|?*]/.test(cleanName)) {
    throw new Error('Folder name contains invalid characters');
  }

  const folderId = 'fld_' + crypto.randomBytes(6).toString('hex');
  const now = new Date().toISOString();

  const folderData = {
    folderId,
    userId,
    name: cleanName,
    color: color || 'indigo',
    createdAt: now
  };

  const pipeline = redis.pipeline();
  pipeline.hset(`folder:${folderId}`, folderData);
  pipeline.sadd(`user:${userId}:folders`, folderId);
  await pipeline.exec();

  return {
    ...folderData,
    fileCount: 0
  };
}

/**
 * List all folders for a user with file count
 * @param {string} userId
 */
async function getUserFolders(userId) {
  const folderIds = await redis.smembers(`user:${userId}:folders`);
  if (!folderIds || folderIds.length === 0) {
    return [];
  }

  const pipeline = redis.pipeline();
  for (const id of folderIds) {
    pipeline.hgetall(`folder:${id}`);
    pipeline.scard(`folder:${id}:files`);
  }

  const results = await pipeline.exec();
  const folders = [];

  for (let i = 0; i < folderIds.length; i++) {
    const metaIndex = i * 2;
    const countIndex = i * 2 + 1;

    const [metaErr, meta] = results[metaIndex];
    const [countErr, count] = results[countIndex];

    if (!metaErr && meta && meta.folderId) {
      folders.push({
        folderId: meta.folderId,
        userId: meta.userId,
        name: meta.name,
        color: meta.color || 'indigo',
        createdAt: meta.createdAt,
        fileCount: count || 0
      });
    } else {
      // Clean up orphaned folder ID from set
      await redis.srem(`user:${userId}:folders`, folderIds[i]);
    }
  }

  // Sort alphabetically by name
  folders.sort((a, b) => a.name.localeCompare(b.name));

  return folders;
}

/**
 * Get single folder details
 * @param {string} userId
 * @param {string} folderId
 */
async function getFolder(userId, folderId) {
  const meta = await redis.hgetall(`folder:${folderId}`);
  if (!meta || !meta.folderId) {
    throw new Error('Folder not found');
  }
  if (meta.userId !== userId) {
    throw new Error('Unauthorized: You do not own this folder');
  }

  const fileCount = await redis.scard(`folder:${folderId}:files`);
  return {
    ...meta,
    fileCount: fileCount || 0
  };
}

/**
 * Rename a folder
 * @param {string} userId
 * @param {string} folderId
 * @param {string} newName
 */
async function renameFolder(userId, folderId, newName) {
  const cleanName = (newName || '').trim();
  if (!cleanName) {
    throw new Error('Folder name cannot be empty');
  }
  if (cleanName.length > 50) {
    throw new Error('Folder name cannot exceed 50 characters');
  }
  if (/[<>:"/\\|?*]/.test(cleanName)) {
    throw new Error('Folder name contains invalid characters');
  }

  const folder = await getFolder(userId, folderId);
  await redis.hset(`folder:${folderId}`, 'name', cleanName);

  return {
    ...folder,
    name: cleanName
  };
}

/**
 * Delete a folder safely
 * All files inside the folder are safely moved back to 'root' (never deleted!)
 * @param {string} userId
 * @param {string} folderId
 */
async function deleteFolder(userId, folderId) {
  await getFolder(userId, folderId);

  // Retrieve all files in this folder
  const fileIds = await redis.smembers(`folder:${folderId}:files`);

  const pipeline = redis.pipeline();

  // Move files to 'root'
  if (fileIds && fileIds.length > 0) {
    for (const fileId of fileIds) {
      pipeline.hset(`file:meta:${fileId}`, 'folderId', 'root');
    }
  }

  // Delete folder record, files set, and remove from user set
  pipeline.del(`folder:${folderId}`);
  pipeline.del(`folder:${folderId}:files`);
  pipeline.srem(`user:${userId}:folders`, folderId);

  await pipeline.exec();

  return {
    success: true,
    folderId,
    movedFilesCount: fileIds ? fileIds.length : 0
  };
}

module.exports = {
  createFolder,
  getUserFolders,
  getFolder,
  renameFolder,
  deleteFolder
};
