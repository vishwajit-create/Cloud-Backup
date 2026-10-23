const http = require('http');

const PORT = 3000;

function apiRequest(method, path, body = null, cookie = '') {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers['Cookie'] = cookie;
    if (postData) headers['Content-Length'] = Buffer.byteLength(postData);

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
          let parsed;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          } catch (e) {
            parsed = { raw: Buffer.concat(chunks).toString('utf-8') };
          }
          resolve({ status: res.statusCode, cookie: resCookie, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runSignupTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING SIGNUP & DUPLICATE REGISTRATION PREVENTION TESTS');
  console.log('======================================================\n');

  const timestamp = Date.now().toString().slice(-6);
  const testEmail = `testuser_${timestamp}@vault.local`;
  const testMobile = `+9198${timestamp}12`;

  // TEST 1: Unregistered user tries to LOGIN -> Should FAIL
  console.log('[TEST 1] Login attempt with unregistered email...');
  const unregLogin = await apiRequest('POST', '/api/auth/request-otp', {
    type: 'email',
    identifier: testEmail,
    mode: 'login'
  });
  console.log('Status:', unregLogin.status, 'Response:', unregLogin.body);
  if (unregLogin.status === 400 && unregLogin.body.message.includes('Please sign up first')) {
    console.log('✅ PASS: Login correctly blocked for unregistered email!');
  } else {
    throw new Error('FAIL: Unregistered login was not blocked properly: ' + JSON.stringify(unregLogin.body));
  }

  // TEST 2: Valid SIGN UP for new user
  console.log('\n[TEST 2] Sign up new user with Email + Mobile...');
  const signupReq = await apiRequest('POST', '/api/auth/request-otp', {
    type: 'email',
    identifier: testEmail,
    mode: 'signup',
    name: 'Test New User',
    email: testEmail,
    mobile: testMobile
  });
  console.log('Signup OTP request:', signupReq.body);
  if (!signupReq.body.success || !signupReq.body.previewOtp) {
    throw new Error('FAIL: Signup OTP request failed: ' + JSON.stringify(signupReq.body));
  }
  const signupOtp = signupReq.body.previewOtp;

  // Complete signup verification
  const signupVerify = await apiRequest('POST', '/api/auth/verify-otp', {
    type: 'email',
    identifier: testEmail,
    code: signupOtp,
    mode: 'signup'
  });
  console.log('Signup Verify response:', signupVerify.body);
  if (!signupVerify.body.success || !signupVerify.body.user || !signupVerify.body.user.id) {
    throw new Error('FAIL: Signup verification failed: ' + JSON.stringify(signupVerify.body));
  }
  console.log('✅ PASS: New user successfully registered and signed up!');

  // TEST 3: Duplicate SIGN UP with SAME EMAIL -> MUST FAIL
  console.log('\n[TEST 3] Duplicate signup attempt with the SAME registered email...');
  const dupEmailSignup = await apiRequest('POST', '/api/auth/request-otp', {
    type: 'email',
    identifier: testEmail,
    mode: 'signup',
    name: 'Attacker Impersonator',
    email: testEmail,
    mobile: '+919999900000'
  });
  console.log('Duplicate Email Signup response:', dupEmailSignup.body);
  if (dupEmailSignup.status === 400 && dupEmailSignup.body.message.includes('already exists')) {
    console.log('✅ PASS: Duplicate registration with registered EMAIL successfully BLOCKED!');
  } else {
    throw new Error('FAIL: Duplicate email registration was NOT blocked: ' + JSON.stringify(dupEmailSignup.body));
  }

  // TEST 4: Duplicate SIGN UP with SAME MOBILE -> MUST FAIL
  console.log('\n[TEST 4] Duplicate signup attempt with the SAME registered mobile number...');
  const dupMobileSignup = await apiRequest('POST', '/api/auth/request-otp', {
    type: 'mobile',
    identifier: testMobile,
    mode: 'signup',
    name: 'Another User',
    email: `another_${Date.now()}@domain.local`,
    mobile: testMobile
  });
  console.log('Duplicate Mobile Signup response:', dupMobileSignup.body);
  if (dupMobileSignup.status === 400 && dupMobileSignup.body.message.includes('already exists')) {
    console.log('✅ PASS: Duplicate registration with registered MOBILE successfully BLOCKED!');
  } else {
    throw new Error('FAIL: Duplicate mobile registration was NOT blocked: ' + JSON.stringify(dupMobileSignup.body));
  }

  // TEST 5: Legitimate LOGIN with the registered email -> Should SUCCEED
  console.log('\n[TEST 5] Legitimate login with newly registered email...');
  const loginReq = await apiRequest('POST', '/api/auth/request-otp', {
    type: 'email',
    identifier: testEmail,
    mode: 'login'
  });
  console.log('Login OTP request:', loginReq.body);
  if (!loginReq.body.success || !loginReq.body.previewOtp) {
    throw new Error('FAIL: Login OTP request failed for registered user: ' + JSON.stringify(loginReq.body));
  }
  const loginVerify = await apiRequest('POST', '/api/auth/verify-otp', {
    type: 'email',
    identifier: testEmail,
    code: loginReq.body.previewOtp,
    mode: 'login'
  });
  console.log('Login Verify response:', loginVerify.body);
  if (loginVerify.body.success && loginVerify.body.user.email === testEmail) {
    console.log('✅ PASS: Registered user logged in seamlessly!');
  } else {
    throw new Error('FAIL: Login verification failed: ' + JSON.stringify(loginVerify.body));
  }

  console.log('\n======================================================');
  console.log('🎉 ALL SIGNUP & ANTI-DUPLICATE TESTS PASSED 100%!');
  console.log('======================================================\n');
}

if (require.main === module) {
  runSignupTests().catch(err => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
  });
}

module.exports = { runSignupTests };
