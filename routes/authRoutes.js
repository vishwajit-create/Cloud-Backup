const express = require('express');
const router = express.Router();
const authService = require('../services/authService');

// Middleware to extract token from Cookie or Authorization header
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    const token = req.cookies?.session_token || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null);

    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required. Please login.' });
    }

    const user = await authService.getUserByToken(token);
    if (!user) {
      res.clearCookie('session_token');
      return res.status(401).json({ success: false, message: 'Session expired. Please login again.' });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error during authentication.' });
  }
}

// Request OTP (email or mobile)
router.post('/request-otp', async (req, res) => {
  try {
    const { type, identifier } = req.body;

    if (!type || !['email', 'mobile'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Type must be either "email" or "mobile"' });
    }

    if (!identifier || identifier.trim() === '') {
      return res.status(400).json({ success: false, message: 'Identifier (email or mobile number) is required' });
    }

    if (type === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(identifier.trim())) {
        return res.status(400).json({ success: false, message: 'Please enter a valid email address' });
      }
    } else if (type === 'mobile') {
      const digitsOnly = identifier.replace(/[^0-9]/g, '');
      if (digitsOnly.length < 8 || digitsOnly.length > 15) {
        return res.status(400).json({ success: false, message: 'Please enter a valid mobile phone number' });
      }
    }

    const result = await authService.requestOtp(type, identifier);
    res.json(result);
  } catch (err) {
    console.error('Request OTP error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to generate OTP' });
  }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  try {
    const { type, identifier, code, extraDetails } = req.body;

    if (!type || !identifier || !code) {
      return res.status(400).json({ success: false, message: 'Identifier, type, and OTP code are required' });
    }

    const result = await authService.verifyOtp(type, identifier, code, extraDetails || {});

    // Set HTTP-only session cookie
    res.cookie('session_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json(result);
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(400).json({ success: false, message: err.message || 'Failed to verify OTP' });
  }
});

// Get current user details
router.get('/me', requireAuth, async (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// Update profile (mobile, email, or name)
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { name, mobile, email } = req.body;
    const updatedUser = await authService.updateUserProfile(req.user.id, { name, mobile, email });
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(400).json({ success: false, message: err.message || 'Failed to update profile' });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  try {
    const token = req.cookies?.session_token || req.headers['authorization']?.replace('Bearer ', '');
    await authService.logout(token);
    res.clearCookie('session_token');
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to logout' });
  }
});

module.exports = {
  router,
  requireAuth
};
