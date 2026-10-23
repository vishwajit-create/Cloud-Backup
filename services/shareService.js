const redis = require('../config/redis');
const crypto = require('crypto');
const fileService = require('./fileService');

function hashPassword(password) {
  if (!password) return '';
  return crypto.createHash('sha256').update(password.trim()).digest('hex');
}

/**
 * Create a new shareable link for a file
 */
async function createShareLink(userId, fileId, options = {}) {
  const {
    expiresIn = 86400, // default 24 hours (in seconds), 0 = never
    maxDownloads = 0,   // 0 = unlimited
    password = ''
  } = options;

  // Verify user owns the file
  const meta = await redis.hgetall(`file:meta:${fileId}`);
  if (!meta || !meta.fileId) {
    throw new Error('File not found in database');
  }
  if (meta.userId !== userId) {
    throw new Error('Unauthorized: You do not own this file');
  }

  // Get user details for branding
  const owner = await redis.hgetall(`user:${userId}`);
  const ownerName = owner?.name || 'A CloudVault user';

  // Generate clean 10-character share ID
  const shareId = 'sh_' + crypto.randomBytes(6).toString('hex');
  const now = new Date();
  const expiresAt = expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000).toISOString() : 'never';

  const shareData = {
    shareId,
    fileId,
    ownerId: userId,
    ownerName,
    originalName: meta.originalName,
    mimeType: meta.mimeType || 'application/octet-stream',
    size: meta.size || '0',
    extension: meta.extension || 'file',
    hasPassword: password ? 'true' : 'false',
    passwordHash: hashPassword(password),
    maxDownloads: maxDownloads.toString(),
    downloadsCount: '0',
    createdAt: now.toISOString(),
    expiresAt
  };

  const pipeline = redis.pipeline();
  pipeline.hset(`share:${shareId}`, shareData);
  if (expiresIn > 0) {
    pipeline.expire(`share:${shareId}`, expiresIn);
  }
  // Track shares for this file
  pipeline.sadd(`file:${fileId}:shares`, shareId);
  // Track shares for this user
  pipeline.sadd(`user:${userId}:shares`, shareId);
  await pipeline.exec();

  return {
    shareId,
    fileId,
    originalName: meta.originalName,
    size: parseInt(meta.size || '0'),
    hasPassword: Boolean(password),
    maxDownloads: parseInt(maxDownloads.toString()),
    expiresAt,
    expiresIn
  };
}

/**
 * Get share info (public view, hides passwordHash)
 */
async function getShareInfo(shareId) {
  const share = await redis.hgetall(`share:${shareId}`);
  if (!share || !share.shareId) {
    return null;
  }

  // Check download limits
  const max = parseInt(share.maxDownloads || '0');
  const count = parseInt(share.downloadsCount || '0');
  if (max > 0 && count >= max) {
    return { expired: true, reason: 'download_limit_reached' };
  }

  // Check expiry date
  if (share.expiresAt && share.expiresAt !== 'never') {
    if (new Date(share.expiresAt).getTime() <= Date.now()) {
      return { expired: true, reason: 'expired' };
    }
  }

  return {
    shareId: share.shareId,
    fileId: share.fileId,
    ownerName: share.ownerName || 'CloudVault User',
    originalName: share.originalName,
    mimeType: share.mimeType,
    size: parseInt(share.size || '0'),
    extension: share.extension,
    hasPassword: share.hasPassword === 'true',
    maxDownloads: max,
    downloadsCount: count,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt
  };
}

/**
 * Unlock a password-protected share link
 */
async function verifySharePassword(shareId, password) {
  const share = await redis.hgetall(`share:${shareId}`);
  if (!share || !share.shareId) {
    throw new Error('Share link not found or expired');
  }

  if (share.hasPassword !== 'true') {
    return true; // No password needed
  }

  const hash = hashPassword(password);
  if (hash !== share.passwordHash) {
    throw new Error('Incorrect password for this shared file');
  }

  return true;
}

/**
 * Get file buffer for download/preview from share
 */
async function getSharedFileWithData(shareId, password = '') {
  const share = await redis.hgetall(`share:${shareId}`);
  if (!share || !share.shareId) {
    throw new Error('Share link has expired or does not exist');
  }

  // Check download limit
  const max = parseInt(share.maxDownloads || '0');
  let count = parseInt(share.downloadsCount || '0');
  if (max > 0 && count >= max) {
    throw new Error('Download limit reached for this share link');
  }

  // Check password if set
  if (share.hasPassword === 'true') {
    if (!password || hashPassword(password) !== share.passwordHash) {
      throw new Error('Password required to access this file');
    }
  }

  // Fetch actual file binary buffer from Valkey Redis
  const buffer = await redis.getBuffer(`file:data:${share.fileId}`);
  if (!buffer) {
    throw new Error('File data is missing from vault storage');
  }

  // Increment download counter
  count++;
  await redis.hset(`share:${shareId}`, 'downloadsCount', count.toString());

  // If download limit reached, clean up share
  if (max > 0 && count >= max) {
    await redis.del(`share:${shareId}`);
    await redis.srem(`file:${share.fileId}:shares`, shareId);
    await redis.srem(`user:${share.ownerId}:shares`, shareId);
  }

  return {
    share,
    meta: {
      originalName: share.originalName,
      mimeType: share.mimeType,
      size: parseInt(share.size || '0')
    },
    buffer
  };
}

/**
 * Revoke/delete a share link
 */
async function revokeShareLink(userId, shareId) {
  const share = await redis.hgetall(`share:${shareId}`);
  if (!share || !share.shareId) {
    return { success: true };
  }

  if (share.ownerId !== userId) {
    throw new Error('Unauthorized: You cannot revoke another user\'s share link');
  }

  const pipeline = redis.pipeline();
  pipeline.del(`share:${shareId}`);
  pipeline.srem(`file:${share.fileId}:shares`, shareId);
  pipeline.srem(`user:${userId}:shares`, shareId);
  await pipeline.exec();

  return { success: true, shareId };
}

/**
 * Get all active share links for a file
 */
async function getFileShares(userId, fileId) {
  const meta = await redis.hgetall(`file:meta:${fileId}`);
  if (!meta || !meta.fileId || meta.userId !== userId) {
    throw new Error('File not found or unauthorized');
  }

  const shareIds = await redis.smembers(`file:${fileId}:shares`);
  if (!shareIds || shareIds.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const id of shareIds) {
    pipeline.hgetall(`share:${id}`);
  }
  const results = await pipeline.exec();
  const shares = [];

  for (let i = 0; i < results.length; i++) {
    const [err, s] = results[i];
    if (!err && s && s.shareId) {
      shares.push({
        shareId: s.shareId,
        fileId: s.fileId,
        originalName: s.originalName,
        size: parseInt(s.size || '0'),
        hasPassword: s.hasPassword === 'true',
        maxDownloads: parseInt(s.maxDownloads || '0'),
        downloadsCount: parseInt(s.downloadsCount || '0'),
        createdAt: s.createdAt,
        expiresAt: s.expiresAt
      });
    } else {
      // Clean up dead share ID
      await redis.srem(`file:${fileId}:shares`, shareIds[i]);
    }
  }

  return shares;
}

module.exports = {
  createShareLink,
  getShareInfo,
  verifySharePassword,
  getSharedFileWithData,
  revokeShareLink,
  getFileShares
};
