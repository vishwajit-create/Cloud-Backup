# CloudVault - File Backup & Cloud Storage

A modern file backup web application backed by **Valkey / Redis Cloud** (TLS over port 21513) with **TextBee SMS** for mobile login and **Google Mail (Gmail)** for email OTP.

---

## 🌟 Key Features

1. **Authentication Options**:
   - **Google Mail OTP**: Users enter their email and receive a branded 6-digit OTP code directly in their inbox via Google Mail SMTP.
   - **TextBee Mobile SMS**: Users enter their mobile number (E.164 format) and receive an instant SMS OTP delivered via the TextBee Gateway (`api.textbee.dev`).
   - Profile links and displays both **Mobile Number** and **Email Address**.

2. **Valkey / Redis Cloud Database Backup**:
   - Files are backed up directly into the Valkey Cloud database (`rediss://default:...@valkey-38ec22fb-innocentyadav100-c4e4.j.aivencloud.com:21513`).
   - Binary buffer chunks and file metadata are saved with TLS encryption.

3. **File Management**:
   - Multi-file drag-and-drop upload with live progress bar.
   - In-browser file preview (Images, PDFs, Audio, Video, Text/Code).
   - Instant file download and deletion from backup.
   - Real-time search, category filtering, and storage analytics.

---

## ⚙️ Configuration (`.env`)

Edit `file-backup-app/.env` to configure your TextBee and Google Mail credentials:

```env
PORT=3000
REDIS_URL=rediss://default:YOUR_VALKEY_PASSWORD@valkey-38ec22fb-innocentyadav100-c4e4.j.aivencloud.com:21513

# ==============================================================
# 📱 TEXTBEE SMS CONFIGURATION (https://textbee.dev)
# ==============================================================
TEXTBEE_API_KEY=your_textbee_api_key_here
TEXTBEE_DEVICE_ID=your_device_id_here  # Optional

# ==============================================================
# 📧 GOOGLE MAIL CONFIGURATION (Gmail SMTP)
# ==============================================================
GOOGLE_MAIL_USER=your_email@gmail.com
GOOGLE_MAIL_APP_PASS=your_16_char_google_app_password
EMAIL_FROM="CloudVault Security" <your_email@gmail.com>
```

> **Development Mode:**  
> If `TEXTBEE_API_KEY` or `GOOGLE_MAIL_APP_PASS` are left empty, the application runs in dev preview mode: the OTP is printed to the console and displayed in a click-to-fill banner on screen. Once you insert your API key and App Password, real SMS and emails will be dispatched automatically.

---

## 🚀 Running Locally

```bash
cd file-backup-app
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## ⚡ Deploying to Vercel

1. Push your repository to GitHub (or use [https://github.com/vishwajit-create/Cloud-Backup](https://github.com/vishwajit-create/Cloud-Backup)).
2. Log in to [Vercel](https://vercel.com) and click **"Add New..."** -> **"Project"**.
3. Import the `Cloud-Backup` repository.
4. Keep the Framework Preset as **Other** (Vercel automatically detects `vercel.json`).
5. In **Environment Variables**, add:
   - `REDIS_URL`: `rediss://default:YOUR_PASSWORD@valkey-38ec22fb-innocentyadav100-c4e4.j.aivencloud.com:21513`
   - `TEXTBEE_API_KEY`: *(Your TextBee API Key)*
   - `GOOGLE_MAIL_USER`: *(Your Gmail Address)*
   - `GOOGLE_MAIL_APP_PASS`: *(Your 16-char Google App Password)*
6. Click **Deploy**! Your site is live on your `.vercel.app` URL.
