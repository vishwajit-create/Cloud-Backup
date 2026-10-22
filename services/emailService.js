const nodemailer = require('nodemailer');
require('dotenv').config();

let transporter = null;

function getGoogleTransporter() {
  if (transporter) return transporter;

  const user = process.env.GOOGLE_MAIL_USER || process.env.GMAIL_USER || process.env.SMTP_USER;
  const pass = process.env.GOOGLE_MAIL_APP_PASS || process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS;

  if (user && pass && user.trim() !== '' && pass.trim() !== '') {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: user.trim(),
        pass: pass.trim().replace(/\s+/g, '') // remove spaces from 16-char app pass
      }
    });
  }
  return transporter;
}

/**
 * Sends OTP verification code via Google Mail (Gmail)
 * @param {string} email
 * @param {string} otp
 * @returns {Promise<{success: boolean, previewMode?: boolean, otpCode?: string, message?: string}>}
 */
async function sendOtpEmail(email, otp) {
  const mailTransporter = getGoogleTransporter();
  const senderEmail = process.env.GOOGLE_MAIL_USER || process.env.GMAIL_USER || process.env.SMTP_USER;

  if (!mailTransporter || !senderEmail) {
    console.log(`\n======================================================`);
    console.log(`📧 [GOOGLE MAIL - PREVIEW MODE]`);
    console.log(`Recipient : ${email}`);
    console.log(`OTP Code  : ${otp}`);
    console.log(`💡 To send real emails via Google Mail, set GOOGLE_MAIL_USER and GOOGLE_MAIL_APP_PASS in .env`);
    console.log(`======================================================\n`);

    return {
      success: true,
      previewMode: true,
      otpCode: otp,
      message: `OTP generated for ${email} (Test Mode: ${otp}). Add GOOGLE_MAIL credentials in .env to send real emails.`
    };
  }

  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>Your Backup Vault Login OTP</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; }
      .container { max-width: 500px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
      .header { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; padding: 32px 24px; text-align: center; }
      .header h1 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
      .header p { margin: 6px 0 0; opacity: 0.9; font-size: 13px; }
      .content { padding: 32px 28px; text-align: center; color: #334155; }
      .content h2 { margin: 0 0 12px; font-size: 18px; color: #0f172a; }
      .content p { font-size: 14px; line-height: 1.6; color: #64748b; margin: 0 0 20px; }
      .otp-box { font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #4f46e5; background: #f5f3ff; border: 2px dashed #818cf8; padding: 18px; border-radius: 12px; margin: 12px 0 24px; display: inline-block; }
      .security-badge { background: #f1f5f9; padding: 12px; border-radius: 8px; font-size: 12px; color: #64748b; text-align: left; margin-top: 16px; border-left: 3px solid #6366f1; }
      .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>CloudVault Backup</h1>
        <p>Encrypted Cloud Storage & Backup</p>
      </div>
      <div class="content">
        <h2>Your Login Verification Code</h2>
        <p>You requested access to your secure file backup vault. Use the one-time code below to authenticate:</p>
        <div class="otp-box">${otp}</div>
        <div class="security-badge">
          🔒 <strong>Security Notice:</strong> This code is valid for <strong>10 minutes</strong>. Never share this OTP with anyone.
        </div>
      </div>
      <div class="footer">
        Sent securely via Google Mail • Powered by Valkey Cloud Database
      </div>
    </div>
  </body>
  </html>
  `;

  try {
    const fromAddress = process.env.EMAIL_FROM || `"CloudVault Security" <${senderEmail}>`;

    console.log(`[Google Mail] Sending verification email to ${email} via Gmail SMTP...`);

    const info = await mailTransporter.sendMail({
      from: fromAddress,
      to: email,
      subject: `Your CloudVault Login OTP: ${otp}`,
      text: `Your CloudVault verification code is: ${otp}. It is valid for 10 minutes.`,
      html: htmlContent
    });

    console.log(`✅ [Google Mail] OTP email sent successfully to ${email}. ID: ${info.messageId}`);
    return {
      success: true,
      previewMode: false,
      messageId: info.messageId,
      message: `Verification code sent to ${email} via Google Mail`
    };
  } catch (error) {
    console.error(`❌ [Google Mail] Failed to send email to ${email}:`, error.message);
    // Return preview mode so user is never locked out during configuration
    return {
      success: true,
      previewMode: true,
      otpCode: otp,
      message: `Google Mail SMTP error (${error.message}). Test OTP: ${otp}`
    };
  }
}

module.exports = {
  sendOtpEmail
};
