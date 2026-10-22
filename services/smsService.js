require('dotenv').config();

/**
 * TextBee SMS Gateway Service
 * Documentation: https://textbee.dev/docs
 *
 * Key architecture:
 *  - TextBee API accepts a request (HTTP 200) but delivery is ASYNC via Android device.
 *  - A 200 from the API does NOT guarantee the user receives the SMS.
 *  - We always store the OTP in Redis (done by authService) so verification works regardless.
 *  - We return the raw TextBee response for logging & debugging.
 */

/**
 * Formats phone number into E.164 standard (e.g., +919876543210)
 * Handles all common Indian input formats:
 *   "+91 98765 43210"  → +919876543210
 *   "+919876543210"    → +919876543210
 *   "919876543210"     → +919876543210
 *   "09876543210"      → +919876543210  (leading 0 stripped, +91 added)
 *   "9876543210"       → +919876543210  (10-digit → +91 prepended)
 */
function formatE164(phone) {
  if (!phone) return '';

  // Strip everything except digits and leading +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // If it already has a + prefix, keep it as-is (trust the user)
  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  // Strip leading 00 (international dialling prefix, e.g. "0091...")
  if (cleaned.startsWith('00')) {
    cleaned = cleaned.slice(2);
  }
  // Strip leading 0 (e.g. "09876543210" → "9876543210")
  else if (cleaned.startsWith('0')) {
    cleaned = cleaned.slice(1);
  }

  // If it starts with 91 and is 12 digits (country code already present)
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return '+' + cleaned;
  }

  // 10-digit bare Indian number → prepend +91
  if (cleaned.length === 10) {
    return '+91' + cleaned;
  }

  // Anything else → just prepend + and let TextBee validate
  return '+' + cleaned;
}

/**
 * Sends OTP SMS via TextBee Gateway API
 * @param {string} mobileNumber  - Raw phone number from user
 * @param {string} otp           - 6-digit OTP code to send
 * @returns {Promise<{success, previewMode, otpCode?, textbeeResponse?, message}>}
 */
async function sendSmsOtp(mobileNumber, otp) {
  const apiKey    = process.env.TEXTBEE_API_KEY;
  const deviceId  = process.env.TEXTBEE_DEVICE_ID;
  const formattedPhone = formatE164(mobileNumber);

  const messageText = `Your CloudVault OTP is: ${otp}. Valid for 10 minutes. Do not share.`;

  // ─── PREVIEW / DEV MODE (no API key configured) ─────────────────────────────
  if (!apiKey || apiKey.trim() === '') {
    console.warn('[TextBee] ⚠️  TEXTBEE_API_KEY not set → running in PREVIEW mode');
    console.log(`[TextBee] DEV OTP for ${formattedPhone}: ${otp}`);
    return {
      success:     true,
      previewMode: true,
      otpCode:     otp,
      message:     `[Dev Mode] Set TEXTBEE_API_KEY in Vercel env vars to send real SMS. OTP: ${otp}`
    };
  }

  // ─── LIVE SEND VIA TEXTBEE API ───────────────────────────────────────────────
  const payload = {
    recipients: [formattedPhone],
    message:    messageText
  };

  // Only attach deviceId if explicitly provided
  if (deviceId && deviceId.trim() !== '') {
    payload.deviceId = deviceId.trim();
    console.log(`[TextBee] Using device ID: ${deviceId.trim()}`);
  } else {
    console.warn('[TextBee] ⚠️  TEXTBEE_DEVICE_ID not set → using TextBee default device (may fail if none is online)');
  }

  console.log(`[TextBee] Sending SMS to ${formattedPhone}…`);
  console.log(`[TextBee] Payload: ${JSON.stringify(payload)}`);

  let rawResponse = null;
  let textbeeData = null;

  try {
    rawResponse = await fetch('https://api.textbee.dev/api/v1/gateway/send-sms', {
      method:  'POST',
      headers: {
        'x-api-key':    apiKey.trim(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    // Try to parse JSON response body
    const rawText = await rawResponse.text();
    console.log(`[TextBee] HTTP ${rawResponse.status} Response body: ${rawText}`);

    try {
      textbeeData = JSON.parse(rawText);
    } catch (_) {
      textbeeData = { raw: rawText };
    }

    // ── HTTP error (4xx / 5xx) ──────────────────────────────────────────────
    if (!rawResponse.ok) {
      const errMsg = textbeeData?.message
        || textbeeData?.error
        || textbeeData?.raw
        || `HTTP ${rawResponse.status}`;

      console.error(`[TextBee] ❌ API error: ${errMsg}`);

      // Common causes:
      // 401 → wrong API key
      // 403 → plan limit exceeded / device not linked to this key
      // 422 → bad phone number format
      // 429 → rate limited
      const hint = {
        401: 'Check TEXTBEE_API_KEY in Vercel env vars',
        403: 'Device not linked to this API key, or plan limit reached',
        422: `Phone number "${formattedPhone}" rejected by TextBee — ensure E.164 format`,
        429: 'TextBee rate limit hit — try again in a minute'
      }[rawResponse.status] || 'Check TextBee dashboard for details';

      return {
        success:          true,     // OTP still works via preview fallback
        previewMode:      true,
        otpCode:          otp,
        textbeeStatus:    rawResponse.status,
        textbeeResponse:  textbeeData,
        message:          `TextBee error ${rawResponse.status}: ${errMsg}. Hint: ${hint}. Preview OTP: ${otp}`
      };
    }

    // ── HTTP 200/201 — request accepted by TextBee ──────────────────────────
    // NOTE: TextBee delivers async via Android device.
    // A 200 means "we queued it", NOT "the SMS was delivered".
    // If the device is offline or has no SIM, the SMS silently fails.

    const batchId  = textbeeData?.data?.batchId  || textbeeData?.batchId  || null;
    const msgCount = textbeeData?.data?.count     || textbeeData?.count    || null;

    console.log(`✅ [TextBee] SMS queued successfully`);
    console.log(`   → Batch ID  : ${batchId  || '(not returned)'}`);
    console.log(`   → Msg count : ${msgCount || '(not returned)'}`);
    console.log(`   → Recipient : ${formattedPhone}`);
    console.log(`   → OTP       : ${otp}`);

    // Always include deviceId warning if not set
    if (!deviceId || deviceId.trim() === '') {
      console.warn('[TextBee] ⚠️  No TEXTBEE_DEVICE_ID set — if SMS does not arrive, set this in Vercel env vars.');
    }

    return {
      success:         true,
      previewMode:     false,
      batchId:         batchId,
      textbeeResponse: textbeeData,
      message:         `SMS OTP sent via TextBee to ${formattedPhone}` + (batchId ? ` (batch: ${batchId})` : '')
    };

  } catch (networkError) {
    // Fetch itself threw — DNS failure, timeout, etc.
    console.error(`[TextBee] ❌ Network error: ${networkError.message}`);
    return {
      success:     true,
      previewMode: true,
      otpCode:     otp,
      message:     `TextBee unreachable (${networkError.message}). Fallback OTP: ${otp}`
    };
  }
}

/**
 * Standalone connectivity test — call this to diagnose TextBee config
 * without generating a real OTP.
 */
async function testTextBeeConnection() {
  const apiKey   = process.env.TEXTBEE_API_KEY;
  const deviceId = process.env.TEXTBEE_DEVICE_ID;

  const result = {
    apiKeySet:    !!apiKey && apiKey.trim() !== '',
    deviceIdSet:  !!deviceId && deviceId.trim() !== '',
    apiKeyPrefix: apiKey ? apiKey.trim().slice(0, 6) + '…' : '(not set)',
    deviceId:     deviceId || '(not set)',
    devices:      null,
    error:        null
  };

  if (!result.apiKeySet) {
    result.error = 'TEXTBEE_API_KEY is not configured in Vercel environment variables';
    return result;
  }

  try {
    // List registered devices to verify API key is valid
    const res = await fetch('https://api.textbee.dev/api/v1/gateway/devices', {
      headers: { 'x-api-key': apiKey.trim() }
    });
    const text = await res.text();
    console.log(`[TextBee Diagnostic] /devices HTTP ${res.status}: ${text}`);

    if (res.ok) {
      const data = JSON.parse(text);
      result.devices = data?.data || data;
      result.onlineDevices = (result.devices || []).filter(d => d.isOnline || d.online || d.status === 'online');
    } else {
      result.error = `API key rejected (HTTP ${res.status}): ${text}`;
    }
  } catch (err) {
    result.error = `Network error: ${err.message}`;
  }

  return result;
}

module.exports = {
  sendSmsOtp,
  formatE164,
  testTextBeeConnection
};
