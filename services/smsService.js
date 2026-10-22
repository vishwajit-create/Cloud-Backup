require('dotenv').config();

/**
 * TextBee SMS Gateway Service
 * Documentation: https://textbee.dev
 */

/**
 * Formats phone number into E.164 standard (e.g., +919876543210)
 */
function formatE164(phone) {
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned.startsWith('+')) {
    // If no leading +, prepend +
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

/**
 * Sends OTP SMS via TextBee Gateway API
 * @param {string} mobileNumber
 * @param {string} otp
 * @returns {Promise<{success: boolean, previewMode?: boolean, otpCode?: string, message?: string}>}
 */
async function sendSmsOtp(mobileNumber, otp) {
  const apiKey = process.env.TEXTBEE_API_KEY;
  const deviceId = process.env.TEXTBEE_DEVICE_ID;
  const formattedPhone = formatE164(mobileNumber);

  const messageText = `Your CloudVault verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`;

  // If no API key is set, use preview/test mode
  if (!apiKey || apiKey.trim() === '') {
    console.log(`\n======================================================`);
    console.log(`📱 [TEXTBEE SMS - PREVIEW MODE]`);
    console.log(`Recipient : ${formattedPhone}`);
    console.log(`OTP Code  : ${otp}`);
    console.log(`Message   : "${messageText}"`);
    console.log(`💡 To send live SMS via TextBee, set TEXTBEE_API_KEY in .env`);
    console.log(`======================================================\n`);

    return {
      success: true,
      previewMode: true,
      otpCode: otp,
      message: `SMS OTP generated for ${formattedPhone} (Test Mode: ${otp}). Add TEXTBEE_API_KEY to send real SMS.`
    };
  }

  // Live send via TextBee API
  try {
    const payload = {
      recipients: [formattedPhone],
      message: messageText
    };

    if (deviceId && deviceId.trim() !== '') {
      payload.deviceId = deviceId.trim();
    }

    console.log(`[TextBee] Sending SMS to ${formattedPhone} via TextBee API...`);

    const response = await fetch('https://api.textbee.dev/api/v1/gateway/send-sms', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey.trim(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const responseData = await response.json().catch(() => null);

    if (!response.ok) {
      console.error(`[TextBee] Gateway error (${response.status}):`, responseData);
      // Fallback so user can still test/login if TextBee API error occurs
      return {
        success: true,
        previewMode: true,
        otpCode: otp,
        message: `TextBee error (${responseData?.message || response.statusText}). Test OTP: ${otp}`
      };
    }

    console.log(`✅ [TextBee] SMS dispatched successfully to ${formattedPhone}`, responseData);
    return {
      success: true,
      previewMode: false,
      message: `SMS successfully sent via TextBee to ${formattedPhone}`
    };

  } catch (error) {
    console.error(`❌ [TextBee] Network/Call error:`, error.message);
    return {
      success: true,
      previewMode: true,
      otpCode: otp,
      message: `TextBee network issue (${error.message}). Test OTP: ${otp}`
    };
  }
}

module.exports = {
  sendSmsOtp,
  formatE164
};
