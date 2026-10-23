const redis = require('../config/redis');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const { sendOtpEmail } = require('./emailService');
const { sendSmsOtp, formatE164 } = require('./smsService');

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
  if (!value) return '';
  if (type === 'email') {
    return value.trim().toLowerCase();
  } else if (type === 'mobile') {
    return formatE164(value);
  }
  return value.trim();
}

/**
 * Check if email or mobile is already registered
 */
async function checkUserExists({ email, mobile }) {
  const pipeline = redis.pipeline();
  const cleanEmail = email ? normalizeIdentifier('email', email) : null;
  const cleanMobile = mobile ? normalizeIdentifier('mobile', mobile) : null;

  if (cleanEmail) pipeline.get(`user:by_email:${cleanEmail}`);
  if (cleanMobile) pipeline.get(`user:by_mobile:${cleanMobile}`);

  const results = await pipeline.exec();
  let emailExists = false;
  let mobileExists = false;

  let idx = 0;
  if (cleanEmail) {
    emailExists = !!(results[idx] && results[idx][1]);
    idx++;
  }
  if (cleanMobile) {
    mobileExists = !!(results[idx] && results[idx][1]);
  }

  return { emailExists, mobileExists, cleanEmail, cleanMobile };
}

/**
 * Send OTP for email or mobile login/signup
 * @param {string} type - 'email' | 'mobile'
 * @param {string} value - identifier value
 * @param {string} mode - 'login' | 'signup'
 * @param {object} signupDetails - { name, email, mobile }
 */
async function requestOtp(type, value, mode = 'login', signupDetails = {}) {
  if (!type || !value) {
    throw new Error('Type and identifier are required');
  }

  const normalized = normalizeIdentifier(type, value);
  const otpKey = `otp:${type}:${normalized}`;
  const code = generateOtp();

  // Validate according to mode: 'signup' vs 'login'
  if (mode === 'signup') {
    const emailToCheck = signupDetails.email ? normalizeIdentifier('email', signupDetails.email) : (type === 'email' ? normalized : '');
    const mobileToCheck = signupDetails.mobile ? normalizeIdentifier('mobile', signupDetails.mobile) : (type === 'mobile' ? normalized : '');

    const { emailExists, mobileExists } = await checkUserExists({
      email: emailToCheck,
      mobile: mobileToCheck
    });

    if (emailExists) {
      throw new Error(`An account with the email (${emailToCheck}) already exists. Please sign in instead.`);
    }

    if (mobileExists) {
      throw new Error(`An account with the mobile number (${mobileToCheck}) already exists. Please sign in instead.`);
    }

    // Save pending signup profile in Redis alongside OTP
    const pendingKey = `pending_signup:${type}:${normalized}`;
    const pendingData = {
      name: (signupDetails.name || '').trim() || (type === 'email' ? normalized.split('@')[0] : `User_${normalized.slice(-4)}`),
      email: emailToCheck,
      mobile: mobileToCheck
    };
    await redis.set(pendingKey, JSON.stringify(pendingData), 'EX', OTP_TTL);
  } else {
    // Mode is 'login': ensure user already exists!
    const indexKey = `user:by_${type}:${normalized}`;
    const existingUserId = await redis.get(indexKey);

    if (!existingUserId) {
      throw new Error(`No account found with this ${type === 'email' ? 'email address' : 'mobile number'}. Please sign up first.`);
    }
  }

  // Save OTP in Redis with expiry
  await redis.set(otpKey, code, 'EX', OTP_TTL);

  // Send OTP
  if (type === 'email') {
    const emailResult = await sendOtpEmail(normalized, code);
    return {
      success: true,
      type: 'email',
      target: normalized,
      mode,
      expiresIn: OTP_TTL,
      previewOtp: emailResult.previewMode ? emailResult.otpCode : undefined,
      message: emailResult.previewMode
        ? `OTP generated! Check email or use preview OTP: ${emailResult.otpCode}`
        : `OTP sent successfully to ${normalized}`
    };
  } else {
    const smsResult = await sendSmsOtp(normalized, code);
    return {
      success: true,
      type: 'mobile',
      target: normalized,
      mode,
      expiresIn: OTP_TTL,
      previewOtp: smsResult.previewMode ? smsResult.otpCode : undefined,
      textbeeQueued: !smsResult.previewMode,
      textbeeBatchId: smsResult.batchId || null,
      message: smsResult.message || `OTP sent to mobile ${normalized}`
    };
  }
}

/**
 * Verify OTP and authenticate user (Supports distinct Login and Signup)
 */
async function verifyOtp(type, value, code, extraDetails = {}, mode = 'login') {
  const normalized = normalizeIdentifier(type, value);
  const otpKey = `otp:${type}:${normalized}`;
  const indexKey = `user:by_${type}:${normalized}`;
  const pendingKey = `pending_signup:${type}:${normalized}`;

  // STEP 1: Single pipelined roundtrip to fetch OTP, existing user, and pending signup
  const pipeline1 = redis.pipeline();
  pipeline1.get(otpKey);
  pipeline1.get(indexKey);
  pipeline1.get(pendingKey);
  const results1 = await pipeline1.exec();

  const storedOtp = results1[0][1];
  const existingUserId = results1[1][1];
  const pendingDataRaw = results1[2][1];

  if (!storedOtp) {
    throw new Error('OTP has expired or was not requested. Please request a new OTP.');
  }

  if (storedOtp.trim() !== code.trim()) {
    throw new Error('Invalid verification code. Please check and try again.');
  }

  let pendingData = null;
  if (pendingDataRaw) {
    try {
      pendingData = JSON.parse(pendingDataRaw);
    } catch (_) {}
  }

  const token = 'sess_' + uuidv4().replace(/-/g, '');
  const now = new Date().toISOString();
  let userId;
  let finalUser;
  let isNewUser = false;

  const pipeline2 = redis.pipeline();
  pipeline2.del(otpKey);
  pipeline2.del(pendingKey);

  if (mode === 'signup') {
    // 1. Strict guard: Make sure details are not taken
    const emailToRegister = (pendingData?.email || extraDetails.email || (type === 'email' ? normalized : '')).trim().toLowerCase();
    const mobileToRegister = (pendingData?.mobile || extraDetails.mobile || (type === 'mobile' ? normalized : '')).trim();

    const { emailExists, mobileExists } = await checkUserExists({
      email: emailToRegister,
      mobile: mobileToRegister
    });

    if (emailExists) {
      throw new Error(`An account with email (${emailToRegister}) is already registered. Please sign in.`);
    }
    if (mobileExists) {
      throw new Error(`An account with mobile (${mobileToRegister}) is already registered. Please sign in.`);
    }

    userId = 'usr_' + uuidv4().replace(/-/g, '').slice(0, 16);
    isNewUser = true;

    finalUser = {
      id: userId,
      email: emailToRegister,
      mobile: mobileToRegister,
      name: (pendingData?.name || extraDetails.name || '').trim() || (emailToRegister ? emailToRegister.split('@')[0] : `User_${mobileToRegister.slice(-4)}`),
      createdAt: now,
      lastLogin: now
    };

    pipeline2.set(indexKey, userId);
    if (finalUser.email) pipeline2.set(`user:by_email:${finalUser.email}`, userId);
    if (finalUser.mobile) pipeline2.set(`user:by_mobile:${finalUser.mobile}`, userId);
    pipeline2.hset(`user:${userId}`, finalUser);

  } else {
    // Mode is 'login': user must exist
    if (!existingUserId) {
      throw new Error(`No account found for this ${type === 'email' ? 'email' : 'mobile'}. Please sign up first.`);
    }

    userId = existingUserId;
    const updates = { lastLogin: now };
    pipeline2.hset(`user:${userId}`, updates);
    pipeline2.hgetall(`user:${userId}`);
  }

  // Save session token
  pipeline2.set(`session:${token}`, userId, 'EX', SESSION_TTL);

  const results2 = await pipeline2.exec();

  if (!isNewUser) {
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
    // Ensure mobile is not taken by another user
    const existingForMobile = await redis.get(`user:by_mobile:${cleanMobile}`);
    if (existingForMobile && existingForMobile !== userId) {
      throw new Error('This mobile number is already linked to another account');
    }
    updates.mobile = cleanMobile;
    await redis.set(`user:by_mobile:${cleanMobile}`, userId);
  }

  if (email !== undefined && email.trim() !== '') {
    const cleanEmail = normalizeIdentifier('email', email);
    // Ensure email is not taken by another user
    const existingForEmail = await redis.get(`user:by_email:${cleanEmail}`);
    if (existingForEmail && existingForEmail !== userId) {
      throw new Error('This email address is already linked to another account');
    }
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
  checkUserExists,
  getUserByToken,
  updateUserProfile,
  logout
};
