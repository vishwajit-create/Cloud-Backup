const redis = require('../config/redis');
const { v4: uuidv4 } = require('uuid');
const { sendOtpEmail } = require('./emailService');
const { sendSmsOtp } = require('./smsService');

const OTP_TTL = parseInt(process.env.OTP_TTL || '600'); // 10 minutes
const SESSION_TTL = parseInt(process.env.SESSION_TTL || '604800'); // 7 days

// Helper to generate 6-digit OTP
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Clean & normalize identifier
 */
function normalizeIdentifier(type, value) {
  if (type === 'email') {
    return value.trim().toLowerCase();
  } else if (type === 'mobile') {
    return value.replace(/[^0-9+]/g, '');
  }
  return value.trim();
}

/**
 * Send OTP for email or mobile login
 */
async function requestOtp(type, value, optionalLinkedValue = '') {
  if (!type || !value) {
    throw new Error('Type and identifier are required');
  }

  const normalized = normalizeIdentifier(type, value);
  const otpKey = `otp:${type}:${normalized}`;
  const code = generateOtp();

  // Save OTP in Redis with expiry
  await redis.set(otpKey, code, 'EX', OTP_TTL);

  // If email login, send via email
  if (type === 'email') {
    const emailResult = await sendOtpEmail(normalized, code);
    return {
      success: true,
      type: 'email',
      target: normalized,
      expiresIn: OTP_TTL,
      previewOtp: emailResult.previewMode ? emailResult.otpCode : undefined,
      message: emailResult.previewMode
        ? `OTP generated! Check email or use preview OTP: ${emailResult.otpCode}`
        : `OTP sent successfully to ${normalized}`
    };
  } else {
    // Mobile number OTP via TextBee SMS Gateway
    const smsResult = await sendSmsOtp(normalized, code);

    return {
      success: true,
      type: 'mobile',
      target: normalized,
      expiresIn: OTP_TTL,
      previewOtp: smsResult.previewMode ? smsResult.otpCode : undefined,
      message: smsResult.message || `OTP sent to mobile ${normalized}`
    };
  }
}

/**
 * Verify OTP and authenticate user
 */
async function verifyOtp(type, value, code, extraDetails = {}) {
  const normalized = normalizeIdentifier(type, value);
  const otpKey = `otp:${type}:${normalized}`;

  const storedOtp = await redis.get(otpKey);

  if (!storedOtp) {
    throw new Error('OTP has expired or was not requested. Please request a new OTP.');
  }

  if (storedOtp.trim() !== code.trim()) {
    throw new Error('Invalid verification code. Please check and try again.');
  }

  // OTP verified, remove it
  await redis.del(otpKey);

  // Resolve or create user
  let userId;
  const indexKey = `user:by_${type}:${normalized}`;
  userId = await redis.get(indexKey);

  let isNewUser = false;
  if (!userId) {
    userId = 'usr_' + uuidv4().replace(/-/g, '').slice(0, 16);
    isNewUser = true;
    await redis.set(indexKey, userId);

    const now = new Date().toISOString();
    const userData = {
      id: userId,
      email: type === 'email' ? normalized : (extraDetails.email ? normalizeIdentifier('email', extraDetails.email) : ''),
      mobile: type === 'mobile' ? normalized : (extraDetails.mobile ? normalizeIdentifier('mobile', extraDetails.mobile) : ''),
      name: extraDetails.name || (type === 'email' ? normalized.split('@')[0] : `User_${normalized.slice(-4)}`),
      createdAt: now,
      lastLogin: now
    };

    // Index the other field if provided
    if (userData.email && type !== 'email') {
      await redis.set(`user:by_email:${userData.email}`, userId);
    }
    if (userData.mobile && type !== 'mobile') {
      await redis.set(`user:by_mobile:${userData.mobile}`, userId);
    }

    await redis.hset(`user:${userId}`, userData);
  } else {
    // Existing user: update last login and optional extra details if missing
    const userUpdates = {
      lastLogin: new Date().toISOString()
    };
    if (extraDetails.email) {
      userUpdates.email = normalizeIdentifier('email', extraDetails.email);
      await redis.set(`user:by_email:${userUpdates.email}`, userId);
    }
    if (extraDetails.mobile) {
      userUpdates.mobile = normalizeIdentifier('mobile', extraDetails.mobile);
      await redis.set(`user:by_mobile:${userUpdates.mobile}`, userId);
    }
    await redis.hset(`user:${userId}`, userUpdates);
  }

  // Generate session token
  const token = 'sess_' + uuidv4().replace(/-/g, '');
  await redis.set(`session:${token}`, userId, 'EX', SESSION_TTL);

  const user = await redis.hgetall(`user:${userId}`);

  return {
    success: true,
    token,
    user,
    isNewUser
  };
}

/**
 * Get user by session token
 */
async function getUserByToken(token) {
  if (!token) return null;

  const userId = await redis.get(`session:${token}`);
  if (!userId) return null;

  const user = await redis.hgetall(`user:${userId}`);
  if (!user || !user.id) return null;

  return user;
}

/**
 * Update user profile (e.g. mobile number or email)
 */
async function updateUserProfile(userId, { name, mobile, email }) {
  const current = await redis.hgetall(`user:${userId}`);
  if (!current || !current.id) {
    throw new Error('User not found');
  }

  const updates = {};
  if (name !== undefined) updates.name = name.trim();

  if (mobile !== undefined && mobile.trim() !== '') {
    const cleanMobile = normalizeIdentifier('mobile', mobile);
    updates.mobile = cleanMobile;
    await redis.set(`user:by_mobile:${cleanMobile}`, userId);
  }

  if (email !== undefined && email.trim() !== '') {
    const cleanEmail = normalizeIdentifier('email', email);
    updates.email = cleanEmail;
    await redis.set(`user:by_email:${cleanEmail}`, userId);
  }

  if (Object.keys(updates).length > 0) {
    await redis.hset(`user:${userId}`, updates);
  }

  return await redis.hgetall(`user:${userId}`);
}

/**
 * Logout / invalidate session
 */
async function logout(token) {
  if (token) {
    await redis.del(`session:${token}`);
  }
  return { success: true };
}

module.exports = {
  requestOtp,
  verifyOtp,
  getUserByToken,
  updateUserProfile,
  logout
};
