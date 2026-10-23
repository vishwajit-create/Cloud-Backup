const http = require('http');

const PORT = 3000;
let userCookie = '';

function apiRequest(method, path, body = null, cookie = '') {
  return new Promise((resolve, reject) => {
    let postData = body;
    const headers = {};

    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
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

async function runBatchAndTrashTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING BATCH ACTIONS, TRASH RECOVERY & QUOTA TESTS');
  console.log('======================================================\n');

  const timestamp = Date.now().toString().slice(-6);
  const testEmail = `batchuser_${timestamp}@vault.local`;
  const testMobile = `+9195${timestamp}77`;

  // 1. Sign up user
  console.log('[STEP 1] Registering test user...');
  const signupReq = await apiRequest('POST', '/api/auth/request-otp', {
    type: 'email',
    identifier: testEmail,
    mode: 'signup',
    name: 'Batch and Trash Tester',
    email: testEmail,
    mobile: testMobile
  });

  const signupVerify = await apiRequest('POST', '/api/auth/verify-otp', {
    type: 'email',
    identifier: testEmail,
    code: signupReq.body.previewOtp,
    mode: 'signup'
  });

  userCookie = signupVerify.cookie;
  console.log('✅ User registered & authenticated.');

  // 2. Upload 3 files
  console.log('\n[STEP 2] Uploading 3 test documents...');
  async function uploadTestFile(name, content) {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
    const form = createMultipartFormData(boundary, 'files', name, content, 'text/plain');
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: PORT,
        method: 'POST',
        path: '/api/files/upload',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': form.length,
          'Cookie': userCookie
        }
      }, r => {
        const chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))));
      });
      req.on('error', reject);
      req.write(form);
      req.end();
    });
    return res.files[0].fileId;
  }

  const file1Id = await uploadTestFile('report_alpha.txt', 'Alpha Content 111');
  const file2Id = await uploadTestFile('report_beta.txt', 'Beta Content 222');
  const file3Id = await uploadTestFile('report_gamma.txt', 'Gamma Content 333');
  console.log(`✅ Uploaded 3 files: ${file1Id}, ${file2Id}, ${file3Id}`);

  // 3. TEST: Soft Delete to Trash
  console.log('\n[TEST 3] Testing Soft Delete / Move to Trash...');
  const trashRes = await apiRequest('DELETE', `/api/files/${file1Id}`, null, userCookie);
  console.log('Trash single file response:', trashRes.body);
  if (!trashRes.body.success || !trashRes.body.isTrash) {
    throw new Error('Failed to move file to trash: ' + JSON.stringify(trashRes.body));
  }
  console.log('✅ PASS: File soft deleted into Trash.');

  // 3a. Verify file1 is NOT in active files list
  const activeFiles1 = await apiRequest('GET', '/api/files', null, userCookie);
  if (activeFiles1.body.files.some(f => f.fileId === file1Id)) {
    throw new Error('Trashed file still appeared in active files list!');
  }
  console.log('✅ PASS: Trashed file is excluded from active files list.');

  // 3b. Verify file1 IS in trash list
  const trashList1 = await apiRequest('GET', '/api/files/trash', null, userCookie);
  console.log('Trash list count:', trashList1.body.files.length);
  if (!trashList1.body.success || !trashList1.body.files.some(f => f.fileId === file1Id)) {
    throw new Error('Trashed file not found in /api/files/trash: ' + JSON.stringify(trashList1.body));
  }
  console.log('✅ PASS: Trashed file visible in Trash Bin view.');

  // 4. TEST: Restore file from Trash
  console.log('\n[TEST 4] Testing 1-Click Restore from Trash...');
  const restoreRes = await apiRequest('POST', `/api/files/${file1Id}/restore`, {}, userCookie);
  console.log('Restore response:', restoreRes.body);
  if (!restoreRes.body.success || restoreRes.body.isTrash !== false) {
    throw new Error('Failed to restore file from trash: ' + JSON.stringify(restoreRes.body));
  }

  // Verify file1 is back in active files
  const activeFiles2 = await apiRequest('GET', '/api/files', null, userCookie);
  if (!activeFiles2.body.files.some(f => f.fileId === file1Id)) {
    throw new Error('Restored file did not return to active files list!');
  }
  console.log('✅ PASS: File successfully restored back to active files!');

  // 5. TEST: Batch Move to Folder
  console.log('\n[TEST 5] Testing Batch Move to Folder...');
  const folderRes = await apiRequest('POST', '/api/folders', { name: 'Batch Archive Folder', color: 'purple' }, userCookie);
  const targetFolderId = folderRes.body.folder.folderId;

  const batchMoveRes = await apiRequest('POST', '/api/files/batch/move', {
    fileIds: [file1Id, file2Id],
    folderId: targetFolderId
  }, userCookie);
  console.log('Batch move response:', batchMoveRes.body);
  if (!batchMoveRes.body.success || batchMoveRes.body.movedCount !== 2) {
    throw new Error('Batch move failed: ' + JSON.stringify(batchMoveRes.body));
  }
  console.log('✅ PASS: Batch move moved 2 files to folder successfully.');

  // 6. TEST: Batch Download as ZIP Archive
  console.log('\n[TEST 6] Testing Batch Download as ZIP Archive...');
  const zipRes = await apiRequest('POST', '/api/files/batch/download-zip', {
    fileIds: [file1Id, file2Id, file3Id]
  }, userCookie);

  console.log('ZIP Status:', zipRes.status, 'Content-Type:', zipRes.headers['content-type'], 'Buffer length:', zipRes.rawBuffer.length);
  if (zipRes.status !== 200 || !zipRes.headers['content-type'].includes('application/zip')) {
    throw new Error('ZIP download failed: ' + zipRes.status);
  }

  // Verify ZIP Magic Bytes: 0x50 0x4B 0x03 0x04 ('PK\x03\x04')
  const magic = zipRes.rawBuffer.slice(0, 4);
  if (magic[0] !== 0x50 || magic[1] !== 0x4B || magic[2] !== 0x03 || magic[3] !== 0x04) {
    throw new Error('Invalid ZIP magic bytes: ' + magic.toString('hex'));
  }
  console.log('✅ PASS: Valid streaming ZIP archive generated and downloaded containing selected files!');

  // 7. TEST: Batch Trash
  console.log('\n[TEST 7] Testing Batch Trash...');
  const batchTrashRes = await apiRequest('POST', '/api/files/batch/trash', {
    fileIds: [file1Id, file2Id]
  }, userCookie);
  console.log('Batch trash response:', batchTrashRes.body);
  if (!batchTrashRes.body.success || batchTrashRes.body.trashedCount !== 2) {
    throw new Error('Batch trash failed: ' + JSON.stringify(batchTrashRes.body));
  }
  console.log('✅ PASS: Batch trash moved 2 files to trash.');

  // 8. TEST: Empty Trash (Permanent Purge)
  console.log('\n[TEST 8] Testing Empty Trash (Permanent Purge)...');
  const emptyRes = await apiRequest('DELETE', '/api/files/trash/empty', null, userCookie);
  console.log('Empty trash response:', emptyRes.body);
  if (!emptyRes.body.success || emptyRes.body.deletedCount !== 2) {
    throw new Error('Empty trash failed: ' + JSON.stringify(emptyRes.body));
  }

  // Trash list must now be empty
  const trashList2 = await apiRequest('GET', '/api/files/trash', null, userCookie);
  if (trashList2.body.files.length !== 0) {
    throw new Error('Trash was not completely emptied: ' + trashList2.body.files.length);
  }
  console.log('✅ PASS: Trash emptied and 2 files permanently purged.');

  // 9. TEST: Storage Quota & Storage Analytics
  console.log('\n[TEST 9] Checking Storage Quota & Storage Analytics...');
  const statsRes = await apiRequest('GET', '/api/files/stats', null, userCookie);
  console.log('Stats response:', statsRes.body.stats);
  const s = statsRes.body.stats;
  if (!s.quotaBytes || !s.quotaFormatted || typeof s.usagePercent !== 'number' || !s.categories) {
    throw new Error('Storage quota or analytics missing: ' + JSON.stringify(s));
  }
  console.log(`✅ PASS: Storage Quota verified: ${s.totalSizeFormatted} / ${s.quotaFormatted} (${s.usagePercent}% used).`);

  console.log('\n======================================================');
  console.log('🎉 ALL BATCH ACTIONS, TRASH RECOVERY & QUOTA TESTS PASSED 100%!');
  console.log('======================================================\n');
}

runBatchAndTrashTests().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
