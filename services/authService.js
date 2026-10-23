const redis = require('../config/redis');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
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

    // IMPORTANT: If TextBee API accepted the request but the Android device
    // is offline or not sending, the user gets no SMS.
    // We always pass the OTP back in the response so the frontend can show
    // the click-to-fill preview banner as a fallback safety net.
    // In production, remove this fallback once TextBee delivery is verified.
    return {
      success:         true,
      type:            'mobile',
      target:          normalized,
      expiresIn:       OTP_TTL,
      previewOtp:      smsResult.previewMode ? smsResult.otpCode : undefined,
      // Debug info visible in Vercel logs
      textbeeQueued:   !smsResult.previewMode,
      textbeeBatchId:  smsResult.batchId || null,
      message:         smsResult.message || `OTP sent to mobile ${normalized}`
    };
  }
}

/**
 * Verify OTP and authenticate user (Optimized with Redis Pipelining)
 */
async function verifyOtp(type, value, code, extraDetails = {}) {
  const normalized = normalizeIdentifier(type, value);
  const otpKey = `otp:${type}:${normalized}`;
  const indexKey = `user:by_${type}:${normalized}`;

  // STEP 1: Single pipelined roundtrip to fetch OTP and existing user index simultaneously
  const pipeline1 = redis.pipeline();
  pipeline1.get(otpKey);
  pipeline1.get(indexKey);
  const results1 = await pipeline1.exec();

  const storedOtp = results1[0][1];
  const existingUserId = results1[1][1];

  if (!storedOtp) {
    throw new Error('OTP has expired or was not requested. Please request a new OTP.');
  }

  if (storedOtp.trim() !== code.trim()) {
    throw new Error('Invalid verification code. Please check and try again.');
  }

  // STEP 2: Prepare session & user payload
  const token = 'sess_' + uuidv4().replace(/-/g, '');
  const now = new Date().toISOString();
  let userId = existingUserId;
  let isNewUser = false;
  let userData = {};

  const pipeline2 = redis.pipeline();
  pipeline2.del(otpKey); // Delete consumed OTP immediately

  if (!userId) {
    userId = 'usr_' + uuidv4().replace(/-/g, '').slice(0, 16);
    isNewUser = true;

    userData = {
      id: userId,
      email: type === 'email' ? normalized : (extraDetails.email ? normalizeIdentifier('email', extraDetails.email) : ''),
      mobile: type === 'mobile' ? normalized : (extraDetails.mobile ? normalizeIdentifier('mobile', extraDetails.mobile) : ''),
      name: extraDetails.name || (type === 'email' ? normalized.split('@')[0] : `User_${normalized.slice(-4)}`),
      createdAt: now,
      lastLogin: now
    };

    pipeline2.set(indexKey, userId);
    if (userData.email) pipeline2.set(`user:by_email:${userData.email}`, userId);
    if (userData.mobile) pipeline2.set(`user:by_mobile:${userData.mobile}`, userId);
    pipeline2.hset(`user:${userId}`, userData);
  } else {
    // Existing user: update last login and optional details
    const updates = { lastLogin: now };
    if (extraDetails.email) {
      const cleanEmail = normalizeIdentifier('email', extraDetails.email);
      updates.email = cleanEmail;
      pipeline2.set(`user:by_email:${cleanEmail}`, userId);
    }
    if (extraDetails.mobile) {
      const cleanMobile = normalizeIdentifier('mobile', extraDetails.mobile);
      updates.mobile = cleanMobile;
      pipeline2.set(`user:by_mobile:${cleanMobile}`, userId);
    }
    pipeline2.hset(`user:${userId}`, updates);
    pipeline2.hgetall(`user:${userId}`); // Retrieve full profile in the same pipeline!
  }

  // Store active session token with TTL
  pipeline2.set(`session:${token}`, userId, 'EX', SESSION_TTL);

  // STEP 3: Execute all writes & fetch in ONE single atomic pipelined roundtrip
  const results2 = await pipeline2.exec();

  let finalUser;
  if (isNewUser) {
    finalUser = userData;
  } else {
    // Extract hgetall result from pipeline
    const hgetallEntry = results2.find(r => r[1] && typeof r[1] === 'object' && r[1].id);
    finalUser = hgetallEntry ? hgetallEntry[1] : await redis.hgetall(`user:${userId}`);
  }

  return {
    success: true,
    token,
    user: finalUser,
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
