const http = require('http');

const PORT = 3000;
let userCookie = '';
let testFileId = '';
const fileContent = 'SECRET CLOUDVAULT DATA: ' + Date.now() + ' - Test Shareable Download Links';

function apiRequest(method, path, body = null, cookie = '', isRaw = false) {
  return new Promise((resolve, reject) => {
    let postData = body;
    const headers = {};

    if (body && !isRaw && typeof body === 'object') {
      postData = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (cookie) headers['Cookie'] = cookie;
    if (postData) headers['Content-Length'] = Buffer.isBuffer(postData) ? postData.length : Buffer.byteLength(postData);

    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        method: method,
        path: path,
        headers: headers
      },
      (res) => {
        let setCookie = res.headers['set-cookie'];
        let resCookie = setCookie ? setCookie.map(c => c.split(';')[0]).join('; ') : '';
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const rawBuffer = Buffer.concat(chunks);
          let parsed;
          try {
            parsed = JSON.parse(rawBuffer.toString('utf-8'));
          } catch (e) {
            parsed = { raw: rawBuffer.toString('utf-8') };
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            cookie: resCookie,
            body: parsed,
            rawBuffer
          });
        });
      }
    );
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function createMultipartFormData(boundary, fieldName, filename, fileContent, contentType) {
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, Buffer.from(fileContent), tail]);
}

async function runShareTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING COMPREHENSIVE SHAREABLE LINKS FEATURE TESTS');
  console.log('======================================================\n');

  const timestamp = Date.now().toString().slice(-6);
  const testEmail = `shareuser_${timestamp}@vault.local`;
  const testMobile = `+9197${timestamp}88`;

  // 1. Sign up a new user to own the files
  console.log('[STEP 1] Registering test user for file ownership...');
  const signupReq = await apiRequest('POST', '/api/auth/request-otp', {
    type: 'email',
    identifier: testEmail,
    mode: 'signup',
    name: 'Share Tester User',
    email: testEmail,
    mobile: testMobile
  });

  if (!signupReq.body.success || !signupReq.body.previewOtp) {
    throw new Error('Failed to request signup OTP: ' + JSON.stringify(signupReq.body));
  }

  const signupVerify = await apiRequest('POST', '/api/auth/verify-otp', {
    type: 'email',
    identifier: testEmail,
    code: signupReq.body.previewOtp,
    mode: 'signup'
  });

  if (!signupVerify.body.success || !signupVerify.cookie) {
    throw new Error('Failed to complete signup: ' + JSON.stringify(signupVerify.body));
  }
  userCookie = signupVerify.cookie;
  console.log('✅ User registered & authenticated. Cookie acquired.');

  // 2. Upload a test file to Valkey
  console.log('\n[STEP 2] Uploading a test file to Valkey...');
  const boundary = '----WebKitFormBoundaryShareTest' + timestamp;
  const formData = createMultipartFormData(boundary, 'files', 'shareable_secret_doc.txt', fileContent, 'text/plain');

  const uploadRes = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      method: 'POST',
      path: '/api/files/upload',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': formData.length,
        'Cookie': userCookie
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf-8')) });
      });
    });
    req.on('error', reject);
    req.write(formData);
    req.end();
  });

  if (!uploadRes.body.success || !uploadRes.body.files || uploadRes.body.files.length === 0) {
    throw new Error('Upload failed: ' + JSON.stringify(uploadRes.body));
  }
  testFileId = uploadRes.body.files[0].fileId;
  console.log(`✅ File uploaded successfully. File ID: ${testFileId}`);

  // 3. TEST: Public Share Link (No password, 24h expiry)
  console.log('\n[TEST 3] Creating standard public share link (no password)...');
  const createShareRes = await apiRequest('POST', '/api/shares/create', {
    fileId: testFileId,
    expiresIn: 86400,
    maxDownloads: 0,
    password: ''
  }, userCookie);

  console.log('Create Share Response:', createShareRes.body);
  if (!createShareRes.body.success || !createShareRes.body.share.shareId) {
    throw new Error('Failed to create share link: ' + JSON.stringify(createShareRes.body));
  }
  const publicShareId = createShareRes.body.share.shareId;
  console.log(`✅ Share link created: ${createShareRes.body.shareUrl}`);

  // 3a. Public info check
  const infoRes = await apiRequest('GET', `/api/shares/public/${publicShareId}`);
  if (!infoRes.body.success || infoRes.body.share.hasPassword !== false || infoRes.body.share.originalName !== 'shareable_secret_doc.txt') {
    throw new Error('Share info endpoint mismatch: ' + JSON.stringify(infoRes.body));
  }
  console.log('✅ PASS: Public metadata retrieved correctly (hasPassword: false).');

  // 3b. Public download check
  const dlRes = await apiRequest('GET', `/api/shares/public/${publicShareId}/download`);
  if (dlRes.status !== 200 || dlRes.rawBuffer.toString('utf-8') !== fileContent) {
    throw new Error('Public download content did not match: ' + dlRes.rawBuffer.toString('utf-8'));
  }
  console.log('✅ PASS: Public file downloaded with full binary integrity!');

  // 4. TEST: Password Protected Share Link
  console.log('\n[TEST 4] Creating Password-Protected share link...');
  const secretPassword = 'MySecretVaultPassword123!';
  const pwdShareRes = await apiRequest('POST', '/api/shares/create', {
    fileId: testFileId,
    expiresIn: 3600,
    maxDownloads: 0,
    password: secretPassword
  }, userCookie);

  if (!pwdShareRes.body.success) {
    throw new Error('Failed to create password protected share: ' + JSON.stringify(pwdShareRes.body));
  }
  const pwdShareId = pwdShareRes.body.share.shareId;
  console.log(`✅ Password protected share created: ${pwdShareId}`);

  // 4a. Public info returns hasPassword = true, hides password hash
  const pwdInfo = await apiRequest('GET', `/api/shares/public/${pwdShareId}`);
  if (!pwdInfo.body.share.hasPassword || pwdInfo.body.share.passwordHash) {
    throw new Error('Password info security leak or missing flag: ' + JSON.stringify(pwdInfo.body));
  }
  console.log('✅ PASS: Share metadata correctly flags password protection and hides hash.');

  // 4b. Download without password -> MUST FAIL (401)
  console.log('[TEST 4b] Attempting download without password...');
  const noPwdDl = await apiRequest('GET', `/api/shares/public/${pwdShareId}/download`);
  if (noPwdDl.status === 401) {
    console.log('✅ PASS: Unauthorized access blocked without password (HTTP 401)!');
  } else {
    throw new Error('Download without password should have failed 401, got: ' + noPwdDl.status);
  }

  // 4c. Verify wrong password -> MUST FAIL
  console.log('[TEST 4c] Verifying incorrect password...');
  const wrongVerify = await apiRequest('POST', `/api/shares/public/${pwdShareId}/verify`, { password: 'wrong' });
  if (wrongVerify.status === 401) {
    console.log('✅ PASS: Wrong password rejected (HTTP 401)!');
  } else {
    throw new Error('Wrong password was not rejected: ' + JSON.stringify(wrongVerify.body));
  }

  // 4d. Verify correct password -> MUST SUCCEED
  console.log('[TEST 4d] Verifying correct password...');
  const rightVerify = await apiRequest('POST', `/api/shares/public/${pwdShareId}/verify`, { password: secretPassword });
  if (rightVerify.status === 200 && (rightVerify.body.verified || rightVerify.body.success)) {
    console.log('✅ PASS: Correct password successfully verified (HTTP 200)!');
  } else {
    throw new Error('Correct password failed verification: ' + JSON.stringify(rightVerify.body));
  }

  // 4e. Download with correct password query param
  console.log('[TEST 4e] Downloading with verified password...');
  const pwdDl = await apiRequest('GET', `/api/shares/public/${pwdShareId}/download?pwd=${encodeURIComponent(secretPassword)}`);
  if (pwdDl.status === 200 && pwdDl.rawBuffer.toString('utf-8') === fileContent) {
    console.log('✅ PASS: File unlocked and downloaded successfully with password!');
  } else {
    throw new Error('Password download failed: ' + pwdDl.status);
  }

  // 5. TEST: Download Limit / Burn-After-Reading (maxDownloads = 1)
  console.log('\n[TEST 5] Testing Download Limit / Burn-After-Reading (maxDownloads = 1)...');
  const burnShareRes = await apiRequest('POST', '/api/shares/create', {
    fileId: testFileId,
    expiresIn: 86400,
    maxDownloads: 1,
    password: ''
  }, userCookie);

  const burnShareId = burnShareRes.body.share.shareId;
  console.log(`✅ Burn-after-1-download share link created: ${burnShareId}`);

  // Download 1 (Should succeed)
  console.log('[TEST 5a] First download (1 of 1 allowed)...');
  const dl1 = await apiRequest('GET', `/api/shares/public/${burnShareId}/download`);
  if (dl1.status === 200) {
    console.log('✅ PASS: 1st download succeeded.');
  } else {
    throw new Error('1st download failed: ' + dl1.status);
  }

  // Download 2 (Must fail because limit is exhausted)
  console.log('[TEST 5b] Second download (Exceeding max downloads)...');
  const dl2 = await apiRequest('GET', `/api/shares/public/${burnShareId}/download`);
  if (dl2.status === 410 || dl2.status === 404) {
    console.log(`✅ PASS: 2nd download blocked properly (HTTP ${dl2.status}: ${dl2.body.message})!`);
  } else {
    throw new Error('2nd download should have been blocked, got: ' + dl2.status);
  }

  // 6. TEST: List Active Shares for File
  console.log('\n[TEST 6] Listing active shares for file...');
  const listSharesRes = await apiRequest('GET', `/api/shares/file/${testFileId}`, null, userCookie);
  if (!listSharesRes.body.success || !Array.isArray(listSharesRes.body.shares)) {
    throw new Error('Failed to list file shares: ' + JSON.stringify(listSharesRes.body));
  }
  console.log(`✅ PASS: Retrieved ${listSharesRes.body.shares.length} active share link(s) for file.`);

  // 7. TEST: Revoking a Share Link
  console.log('\n[TEST 7] Revoking public share link...');
  const revokeRes = await apiRequest('DELETE', `/api/shares/${publicShareId}`, null, userCookie);
  if (!revokeRes.body.success) {
    throw new Error('Failed to revoke share link: ' + JSON.stringify(revokeRes.body));
  }
  console.log('✅ Revoke API returned success.');

  // Check public endpoint -> must now return 404
  const revokedCheck = await apiRequest('GET', `/api/shares/public/${publicShareId}`);
  if (revokedCheck.status === 404) {
    console.log('✅ PASS: Revoked link is immediately inaccessible (HTTP 404)!');
  } else {
    throw new Error('Revoked link is still accessible: ' + revokedCheck.status);
  }

  // 8. TEST: Public Landing Page HTML serves properly
  console.log('\n[TEST 8] Checking public landing page route /share/:shareId...');
  const htmlRes = await apiRequest('GET', `/share/${pwdShareId}`);
  if (htmlRes.status === 200 && htmlRes.rawBuffer.toString('utf-8').includes('Secure Shared File')) {
    console.log('✅ PASS: Public share landing page served with 200 OK and CloudVault branding!');
  } else {
    throw new Error('Failed to serve share.html: ' + htmlRes.status);
  }

  console.log('\n======================================================');
  console.log('🎉 ALL FEATURE #1 (SHAREABLE LINKS) TESTS PASSED 100%!');
  console.log('======================================================\n');
}

runShareTests().catch((err) => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
