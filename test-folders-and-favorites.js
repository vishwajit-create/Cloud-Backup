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

function createMultipartFormData(boundary, fieldName, filename, fileContent, contentType, extraFields = {}) {
  let chunks = [];
  for (const [key, val] of Object.entries(extraFields)) {
    chunks.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
      `${val}\r\n`
    ));
  }

  chunks.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`
  ));
  chunks.push(Buffer.from(fileContent));
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  return Buffer.concat(chunks);
}

async function runFolderAndFavoriteTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING FOLDERS & STARRED FAVORITES FEATURE TESTS');
  console.log('======================================================\n');

  const timestamp = Date.now().toString().slice(-6);
  const testEmail = `orguser_${timestamp}@vault.local`;
  const testMobile = `+9196${timestamp}99`;

  // 1. Sign up user
  console.log('[STEP 1] Registering test user...');
  const signupReq = await apiRequest('POST', '/api/auth/request-otp', {
    type: 'email',
    identifier: testEmail,
    mode: 'signup',
    name: 'Organization Tester',
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

  // 2. Create Folder 1: "Work Projects"
  console.log('\n[TEST 2] Creating Folder 1 ("Work Projects")...');
  const f1Res = await apiRequest('POST', '/api/folders', {
    name: 'Work Projects',
    color: 'indigo'
  }, userCookie);

  console.log('Folder 1 Response:', f1Res.body);
  if (!f1Res.body.success || !f1Res.body.folder || f1Res.body.folder.name !== 'Work Projects') {
    throw new Error('Failed to create folder 1: ' + JSON.stringify(f1Res.body));
  }
  const folder1Id = f1Res.body.folder.folderId;
  console.log(`✅ Folder 1 created with ID: ${folder1Id}`);

  // 3. Create Folder 2: "Financial Documents"
  console.log('\n[TEST 3] Creating Folder 2 ("Financial Documents")...');
  const f2Res = await apiRequest('POST', '/api/folders', {
    name: 'Financial Documents',
    color: 'emerald'
  }, userCookie);

  if (!f2Res.body.success || !f2Res.body.folder) {
    throw new Error('Failed to create folder 2: ' + JSON.stringify(f2Res.body));
  }
  const folder2Id = f2Res.body.folder.folderId;
  console.log(`✅ Folder 2 created with ID: ${folder2Id}`);

  // 4. List folders
  console.log('\n[TEST 4] Listing user folders...');
  const listFolders = await apiRequest('GET', '/api/folders', null, userCookie);
  console.log('Folders list:', listFolders.body.folders);
  if (!listFolders.body.success || listFolders.body.folders.length !== 2) {
    throw new Error('Expected 2 folders, got: ' + JSON.stringify(listFolders.body));
  }
  console.log('✅ PASS: Folders list retrieved correctly.');

  // 5. Rename Folder 1: "Work Projects" -> "Client Deliverables"
  console.log('\n[TEST 5] Renaming Folder 1 to "Client Deliverables"...');
  const renameRes = await apiRequest('PATCH', `/api/folders/${folder1Id}`, {
    name: 'Client Deliverables'
  }, userCookie);

  if (!renameRes.body.success || renameRes.body.folder.name !== 'Client Deliverables') {
    throw new Error('Failed to rename folder: ' + JSON.stringify(renameRes.body));
  }
  console.log('✅ PASS: Folder renamed successfully.');

  // 6. Upload File directly into "Client Deliverables"
  console.log('\n[TEST 6] Uploading File A directly into folder "Client Deliverables"...');
  const boundaryA = '----WebKitFormBoundaryFolderA' + timestamp;
  const formA = createMultipartFormData(
    boundaryA,
    'files',
    'project_proposal.pdf',
    'Sample PDF Proposal Content',
    'application/pdf',
    { folderId: folder1Id }
  );

  const uploadARes = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      method: 'POST',
      path: '/api/files/upload',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundaryA}`,
        'Content-Length': formA.length,
        'Cookie': userCookie
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf-8')) }));
    });
    req.on('error', reject);
    req.write(formA);
    req.end();
  });

  if (!uploadARes.body.success || uploadARes.body.files[0].folderId !== folder1Id) {
    throw new Error('File A upload to folder failed: ' + JSON.stringify(uploadARes.body));
  }
  const fileAId = uploadARes.body.files[0].fileId;
  console.log(`✅ File A uploaded to folder: ${fileAId}`);

  // 7. Upload File B and File C to Root
  console.log('\n[TEST 7] Uploading File B to Root...');
  const boundaryB = '----WebKitFormBoundaryFolderB' + timestamp;
  const formB = createMultipartFormData(
    boundaryB,
    'files',
    'personal_notes.txt',
    'Secret personal notes content',
    'text/plain'
  );

  const uploadBRes = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      method: 'POST',
      path: '/api/files/upload',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundaryB}`,
        'Content-Length': formB.length,
        'Cookie': userCookie
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf-8')) }));
    });
    req.on('error', reject);
    req.write(formB);
    req.end();
  });

  const fileBId = uploadBRes.body.files[0].fileId;
  console.log(`✅ File B uploaded to root: ${fileBId}`);

  // 8. Star File B (Favorites)
  console.log('\n[TEST 8] Starring File B as Favorite...');
  const starRes = await apiRequest('POST', `/api/files/${fileBId}/star`, {}, userCookie);
  console.log('Star response:', starRes.body);
  if (!starRes.body.success || starRes.body.isStarred !== true) {
    throw new Error('Failed to star file B: ' + JSON.stringify(starRes.body));
  }
  console.log('✅ PASS: File B successfully marked as Starred favorite!');

  // Verify in files list that File B has isStarred = true
  const listFiles1 = await apiRequest('GET', '/api/files', null, userCookie);
  const foundFileB = listFiles1.body.files.find(f => f.fileId === fileBId);
  if (!foundFileB || !foundFileB.isStarred) {
    throw new Error('File B isStarred flag missing in list: ' + JSON.stringify(foundFileB));
  }
  console.log('✅ PASS: isStarred flag verified in user files list.');

  // 9. Move File B from Root into "Client Deliverables" folder
  console.log('\n[TEST 9] Moving File B into "Client Deliverables" folder...');
  const moveRes = await apiRequest('POST', `/api/files/${fileBId}/move`, { folderId: folder1Id }, userCookie);
  console.log('Move response:', moveRes.body);
  if (!moveRes.body.success || moveRes.body.folderId !== folder1Id) {
    throw new Error('Failed to move file B: ' + JSON.stringify(moveRes.body));
  }
  console.log('✅ PASS: File B successfully moved into folder!');

  // Check folder details -> fileCount must now be 2 (File A + File B)
  const f1Details = await apiRequest('GET', `/api/folders/${folder1Id}`, null, userCookie);
  console.log('Folder 1 Details after move:', f1Details.body.folder);
  if (f1Details.body.folder.fileCount !== 2) {
    throw new Error('Expected fileCount = 2, got: ' + f1Details.body.folder.fileCount);
  }
  console.log('✅ PASS: Folder fileCount correctly updated to 2.');

  // 10. Toggle unstar File B
  console.log('\n[TEST 10] Toggling unstar for File B...');
  const unstarRes = await apiRequest('POST', `/api/files/${fileBId}/star`, {}, userCookie);
  if (!unstarRes.body.success || unstarRes.body.isStarred !== false) {
    throw new Error('Failed to unstar file B: ' + JSON.stringify(unstarRes.body));
  }
  console.log('✅ PASS: File B successfully unstarred!');

  // 11. Delete Folder (Safe Deletion: Files moved back to Home/root)
  console.log('\n[TEST 11] Safely deleting folder "Client Deliverables" (files should move to Home)...');
  const deleteFolderRes = await apiRequest('DELETE', `/api/folders/${folder1Id}`, null, userCookie);
  console.log('Delete Folder response:', deleteFolderRes.body);
  if (!deleteFolderRes.body.success || deleteFolderRes.body.movedFilesCount !== 2) {
    throw new Error('Folder delete failed: ' + JSON.stringify(deleteFolderRes.body));
  }
  console.log('✅ PASS: Folder deleted, 2 files safely relocated to Home!');

  // Verify files are still in user's vault with folderId = 'root'
  const listFiles2 = await apiRequest('GET', '/api/files', null, userCookie);
  const remainingFileA = listFiles2.body.files.find(f => f.fileId === fileAId);
  const remainingFileB = listFiles2.body.files.find(f => f.fileId === fileBId);

  if (!remainingFileA || remainingFileA.folderId !== 'root' || !remainingFileB || remainingFileB.folderId !== 'root') {
    throw new Error('Files were lost or folderId was not reset to root after folder deletion!');
  }
  console.log('✅ PASS: All files preserved and returned to root folder with complete data integrity!');

  console.log('\n======================================================');
  console.log('🎉 ALL FOLDERS & STARRED FAVORITES TESTS PASSED 100%!');
  console.log('======================================================\n');
}

runFolderAndFavoriteTests().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
