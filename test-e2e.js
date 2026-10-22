const http = require('http');

const PORT = 3000;
let cookie = '';
let uploadedFileId = '';

function request(method, path, data = null, headers = {}, isFormData = false) {
  return new Promise((resolve, reject) => {
    let postData = data;
    if (data && !isFormData && typeof data === 'object') {
      postData = JSON.stringify(data);
      headers['Content-Type'] = 'application/json';
    }

    if (cookie) {
      headers['Cookie'] = cookie;
    }

    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        method: method,
        path: path,
        headers: headers
      },
      (res) => {
        const setCookieHeader = res.headers['set-cookie'];
        if (setCookieHeader) {
          cookie = setCookieHeader.map(c => c.split(';')[0]).join('; ');
        }

        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const bodyBuffer = Buffer.concat(chunks);
          let body = bodyBuffer.toString('utf-8');
          try {
            body = JSON.parse(body);
          } catch (e) {}
          resolve({ status: res.statusCode, headers: res.headers, body, rawBuffer: bodyBuffer });
        });
      }
    );

    req.on('error', reject);

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

// Multipart form-data builder for testing file upload
function createMultipartFormData(boundary, fieldName, filename, fileContent, contentType) {
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, Buffer.from(fileContent), tail]);
}

async function runTests() {
  console.log('--- Starting End-to-End API Integration Tests ---');

  // 1. Health check
  console.log('\n[1] Testing /api/health...');
  const healthRes = await request('GET', '/api/health');
  console.log('Health response:', healthRes.body);
  if (healthRes.status !== 200 || !healthRes.body.connected) {
    throw new Error('Health check failed: DB not connected');
  }

  // 2. Request OTP via email
  console.log('\n[2] Testing Request OTP via Email...');
  const testEmail = 'backup_tester@vault.local';
  const reqOtpRes = await request('POST', '/api/auth/request-otp', {
    type: 'email',
    identifier: testEmail
  });
  console.log('Request OTP response:', reqOtpRes.body);
  if (!reqOtpRes.body.success || !reqOtpRes.body.previewOtp) {
    throw new Error('Failed to request OTP');
  }
  const otpCode = reqOtpRes.body.previewOtp;

  // 3. Verify OTP
  console.log('\n[3] Testing Verify OTP...');
  const verifyRes = await request('POST', '/api/auth/verify-otp', {
    type: 'email',
    identifier: testEmail,
    code: otpCode,
    extraDetails: { mobile: '+1 234 567 8900' }
  });
  console.log('Verify OTP response:', verifyRes.body);
  if (!verifyRes.body.success || !verifyRes.body.token) {
    throw new Error('Verify OTP failed');
  }

  // 4. Check /api/auth/me
  console.log('\n[4] Testing /api/auth/me session...');
  const meRes = await request('GET', '/api/auth/me');
  console.log('User profile:', meRes.body);
  if (!meRes.body.success || meRes.body.user.email !== testEmail) {
    throw new Error('Get user profile failed');
  }

  // 5. Test File Upload to Valkey Cloud
  console.log('\n[5] Testing File Upload (backed up into Valkey)...');
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const sampleFileContent = 'Hello Valkey Cloud! This is critical backup document created at ' + new Date().toISOString();
  const formData = createMultipartFormData(boundary, 'files', 'important_backup.txt', sampleFileContent, 'text/plain');

  const uploadRes = await request('POST', '/api/files/upload', formData, {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': formData.length
  }, true);

  console.log('Upload response:', uploadRes.body);
  if (!uploadRes.body.success || !uploadRes.body.files || uploadRes.body.files.length === 0) {
    throw new Error('File upload failed');
  }
  uploadedFileId = uploadRes.body.files[0].fileId;
  console.log('Uploaded File ID:', uploadedFileId);

  // 6. Test List Files
  console.log('\n[6] Testing List User Files...');
  const listRes = await request('GET', '/api/files');
  console.log('User files count:', listRes.body.files?.length);
  const found = listRes.body.files.find(f => f.fileId === uploadedFileId);
  if (!found) throw new Error('Uploaded file not listed');

  // 7. Test Download File from Valkey
  console.log('\n[7] Testing Download File from Valkey...');
  const downloadRes = await request('GET', `/api/files/${uploadedFileId}/download`);
  const downloadedText = downloadRes.rawBuffer.toString('utf-8');
  console.log('Downloaded Content Match:', downloadedText === sampleFileContent ? 'YES (Exact Match!)' : 'NO');
  if (downloadedText !== sampleFileContent) {
    throw new Error('Downloaded file does not match uploaded file');
  }

  // 8. Test Stats
  console.log('\n[8] Testing /api/files/stats...');
  const statsRes = await request('GET', '/api/files/stats');
  console.log('Stats response:', statsRes.body);
  if (!statsRes.body.success || statsRes.body.stats.totalFiles < 1) {
    throw new Error('Stats did not reflect uploaded file');
  }

  // 9. Test Mobile OTP flow
  console.log('\n[9] Testing Mobile Number OTP Request & Verify...');
  const testMobile = '+919988776655';
  const mobileOtpRes = await request('POST', '/api/auth/request-otp', {
    type: 'mobile',
    identifier: testMobile
  });
  console.log('Mobile OTP response:', mobileOtpRes.body);
  const mobileVerifyRes = await request('POST', '/api/auth/verify-otp', {
    type: 'mobile',
    identifier: testMobile,
    code: mobileOtpRes.body.previewOtp,
    extraDetails: { email: 'mobile_user@backup.com' }
  });
  console.log('Mobile user authenticated:', mobileVerifyRes.body.user);
  if (!mobileVerifyRes.body.success) {
    throw new Error('Mobile login verification failed');
  }

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! The Valkey Cloud file backup and auth system is fully functional.');
}

module.exports = { runTests };
