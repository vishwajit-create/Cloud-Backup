// Dashboard & File Management Logic

let stagedFiles = [];
let userFiles = [];
let userFolders = [];
let trashFiles = [];
let currentFolderId = 'root';
let isStarredFilterActive = false;
let isTrashViewActive = false;
let selectedFileIds = new Set();
let movingFile = { fileId: null, fileName: '' };
let batchMoveMode = false;

function initDashboard() {
  setupDropZone();
  loadUserFolders();
  loadUserFiles();
  loadStats();
  checkDbHealth();
  setInterval(checkDbHealth, 30000); // Check DB health every 30 seconds
}

// Check Database Ping & Health
async function checkDbHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    const badge = document.getElementById('db-health-badge');
    const text = document.getElementById('db-status-text');

    if (data.status === 'online') {
      badge.className = 'hidden sm:inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200';
      text.innerText = `Valkey Cloud: Online (${data.latencyMs}ms)`;
    } else {
      badge.className = 'hidden sm:inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs bg-amber-50 text-amber-700 border border-amber-200';
      text.innerText = 'Valkey: Degraded';
    }
  } catch (err) {
    const text = document.getElementById('db-status-text');
    if (text) text.innerText = 'Valkey: Offline';
  }
}

// Setup Drag & Drop File Upload
function setupDropZone() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  if (!dropZone || !fileInput) return;

  dropZone.onclick = () => fileInput.click();

  fileInput.onchange = (e) => {
    handleFilesSelected(Array.from(e.target.files));
    fileInput.value = ''; // Reset so the same file can be re-selected if removed
  };

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dropzone-active');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dropzone-active');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = Array.from(dt.files);
    handleFilesSelected(files);
  }, false);
}

// Handle Staged Files
function handleFilesSelected(newFiles) {
  if (!newFiles || newFiles.length === 0) return;

  stagedFiles = [...stagedFiles, ...newFiles];
  renderStagedFiles();
}

function renderStagedFiles() {
  const container = document.getElementById('staging-container');
  const list = document.getElementById('staging-list');
  const countSpan = document.getElementById('staging-count');

  if (stagedFiles.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  countSpan.innerText = stagedFiles.length;

  list.innerHTML = stagedFiles.map((file, idx) => `
    <div class="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs">
      <div class="flex items-center gap-2.5 truncate max-w-[80%]">
        <i class="${getFileIconClass(file.name)} text-indigo-500 text-sm"></i>
        <span class="font-medium text-slate-700 truncate">${escapeHtml(file.name)}</span>
        <span class="text-slate-400 text-[11px] font-mono">(${formatBytes(file.size)})</span>
      </div>
      <button type="button" onclick="removeStagedFile(${idx})" class="w-6 h-6 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `).join('');
}

function removeStagedFile(index) {
  stagedFiles.splice(index, 1);
  renderStagedFiles();
}

function clearStagedFiles() {
  stagedFiles = [];
  renderStagedFiles();
}

// Upload Staged Files with Live Progress
function startFileUpload() {
  if (stagedFiles.length === 0) {
    showToast('Please select at least one file to backup', 'warning');
    return;
  }

  const progressContainer = document.getElementById('upload-progress-container');
  const progressBar = document.getElementById('upload-progress-bar');
  const progressText = document.getElementById('upload-progress-percentage');
  const btn = document.getElementById('btn-start-upload');

  const formData = new FormData();
  for (const file of stagedFiles) {
    formData.append('files', file);
  }
  const targetFolder = document.getElementById('upload-target-folder')?.value || currentFolderId || 'root';
  formData.append('folderId', targetFolder);

  progressContainer.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressText.innerText = '0%';
  btn.disabled = true;
  btn.classList.add('opacity-50', 'cursor-not-allowed');

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/files/upload', true);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const percent = Math.round((e.loaded / e.total) * 100);
      progressBar.style.width = percent + '%';
      progressText.innerText = percent + '%';
    }
  };

  xhr.onload = () => {
    btn.disabled = false;
    btn.classList.remove('opacity-50', 'cursor-not-allowed');
    progressContainer.classList.add('hidden');

    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const res = JSON.parse(xhr.responseText);
        showToast(res.message || 'Files backed up successfully to Valkey Redis!', 'success');
        clearStagedFiles();
        loadUserFiles();
        loadUserFolders();
        loadStats();
      } catch (e) {
        showToast('Uploaded successfully', 'success');
      }
    } else {
      let errMsg = 'Upload failed';
      try {
        const errRes = JSON.parse(xhr.responseText);
        errMsg = errRes.message || errMsg;
      } catch (e) {}
      showToast(errMsg, 'error');
    }
  };

  xhr.onerror = () => {
    btn.disabled = false;
    btn.classList.remove('opacity-50', 'cursor-not-allowed');
    progressContainer.classList.add('hidden');
    showToast('Network error while backing up file', 'error');
  };

  xhr.send(formData);
}

// Load Files List
async function loadUserFiles() {
  const loading = document.getElementById('files-loading');
  const empty = document.getElementById('files-empty');
  const grid = document.getElementById('files-grid');

  loading.classList.remove('hidden');
  empty.classList.add('hidden');
  grid.classList.add('hidden');

  try {
    const res = await fetch('/api/files');
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Could not fetch files');
    }

    userFiles = data.files || [];
    filterFiles();

    // Update last sync time
    const lastSync = document.getElementById('stat-last-sync');
    if (lastSync) {
      lastSync.innerText = `Updated at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    loading.classList.add('hidden');
  }
}

// Load Stats
async function loadStats() {
  try {
    const res = await fetch('/api/files/stats');
    const data = await res.json();
    if (res.ok && data.success && data.stats) {
      const s = data.stats;
      document.getElementById('stat-total-files').innerText = s.totalFiles || 0;
      document.getElementById('stat-total-size').innerText = s.totalSizeFormatted || '0 B';

      const quotaEl = document.getElementById('stat-quota-total');
      if (quotaEl) quotaEl.innerText = `/ ${s.quotaFormatted || '500 MB'}`;

      const progressEl = document.getElementById('stat-storage-progress');
      if (progressEl) progressEl.style.width = `${s.usagePercent || 0}%`;

      const trashBadge = document.getElementById('trash-badge-count');
      if (trashBadge) {
        if (s.trashCount > 0) {
          trashBadge.innerText = s.trashCount;
          trashBadge.classList.remove('hidden');
        } else {
          trashBadge.classList.add('hidden');
        }
      }
    }
  } catch (e) {
    console.error('Failed to load stats', e);
  }
}

// Filter and Render Files
function filterFiles() {
  const empty = document.getElementById('files-empty');
  const grid = document.getElementById('files-grid');

  const filtered = getVisibleFilteredFiles();

  if (filtered.length === 0) {
    empty.classList.remove('hidden');
    grid.classList.add('hidden');
    if (isTrashViewActive) {
      empty.querySelector('h4').innerText = 'Trash Bin is empty';
      empty.querySelector('p').innerText = 'No deleted files currently in Trash.';
    } else {
      empty.querySelector('h4').innerText = 'No backup files found';
      empty.querySelector('p').innerText = 'Upload documents or adjust your search filter.';
    }
    return;
  }

  empty.classList.add('hidden');
  grid.classList.remove('hidden');

  grid.innerHTML = filtered.map(file => {
    const iconClass = getFileIconClass(file.originalName);
    const dateFormatted = new Date(file.trashedAt || file.uploadDate).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    if (isTrashViewActive) {
      return `
        <div class="bg-white border border-rose-200/90 hover:shadow-md rounded-2xl p-4 transition-all flex flex-col justify-between">
          <div class="flex items-start justify-between gap-2 mb-3">
            <div class="w-10 h-10 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500 text-lg">
              <i class="${iconClass}"></i>
            </div>
            <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-50 text-rose-600">
              TRASHED
            </span>
          </div>

          <div class="mb-4">
            <h4 class="text-xs font-bold text-slate-800 truncate" title="${escapeHtml(file.originalName)}">
              ${escapeHtml(file.originalName)}
            </h4>
            <div class="flex items-center gap-2 text-[11px] text-slate-400 mt-1 font-mono">
              <span>${formatBytes(file.size)}</span>
              <span>•</span>
              <span class="text-rose-500 font-sans">Trashed ${dateFormatted}</span>
            </div>
          </div>

          <div class="pt-3 border-t border-slate-100 flex items-center gap-2">
            <button onclick="restoreSingleFile('${file.fileId}')" class="flex-1 py-1.5 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5">
              <i class="fa-solid fa-rotate-left text-xs"></i>
              <span>Restore</span>
            </button>
            <button onclick="deletePermanently('${file.fileId}', '${escapeHtml(file.originalName)}')" class="py-1.5 px-3 bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5">
              <i class="fa-solid fa-trash-can text-xs"></i>
              <span>Purge</span>
            </button>
          </div>
        </div>
      `;
    }

    const isSelected = selectedFileIds.has(file.fileId);

    return `
      <div class="group bg-white border ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-md' : 'border-slate-200 hover:border-indigo-300 hover:shadow-md'} rounded-2xl p-4 transition-all flex flex-col justify-between">
        
        <!-- Top File Header -->
        <div class="flex items-start justify-between gap-2 mb-3">
          <div class="flex items-center gap-2.5">
            <input type="checkbox" onchange="toggleSelectFile('${file.fileId}', event)" ${isSelected ? 'checked' : ''} class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer" />
            <div class="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-indigo-600 text-lg group-hover:scale-105 transition">
              <i class="${iconClass}"></i>
            </div>
          </div>
          <div class="flex items-center gap-1.5">
            <button onclick="toggleStar('${file.fileId}')" title="${file.isStarred ? 'Remove from favorites' : 'Mark as favorite'}" class="w-7 h-7 rounded-lg hover:bg-amber-50 flex items-center justify-center transition ${file.isStarred ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'}">
              <i class="${file.isStarred ? 'fa-solid' : 'fa-regular'} fa-star text-sm"></i>
            </button>
            <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              ${escapeHtml(file.extension || 'FILE')}
            </span>
          </div>
        </div>

        <!-- File Name & Meta -->
        <div class="mb-4">
          <h4 class="text-xs font-bold text-slate-800 truncate" title="${escapeHtml(file.originalName)}">
            ${escapeHtml(file.originalName)}
          </h4>
          <div class="flex items-center gap-2 text-[11px] text-slate-400 mt-1 font-mono">
            <span>${formatBytes(file.size)}</span>
            <span>•</span>
            <span>${dateFormatted}</span>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="pt-3 border-t border-slate-100 flex items-center justify-between gap-1">
          <button onclick="previewFile('${file.fileId}', '${escapeHtml(file.originalName)}', '${file.mimeType}', ${file.size})" title="Preview" class="flex-1 py-1.5 px-2 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5">
            <i class="fa-regular fa-eye text-xs"></i>
            <span>View</span>
          </button>

          <button onclick="openShareModal('${file.fileId}', '${escapeHtml(file.originalName)}')" title="Share link with expiry & password" class="w-8 h-8 rounded-lg bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 text-slate-500 flex items-center justify-center transition text-xs">
            <i class="fa-solid fa-share-nodes"></i>
          </button>

          <button onclick="openMoveModal('${file.fileId}', '${escapeHtml(file.originalName)}')" title="Move to folder" class="w-8 h-8 rounded-lg bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 text-slate-500 flex items-center justify-center transition text-xs">
            <i class="fa-solid fa-folder-tree"></i>
          </button>

          <a href="/api/files/${file.fileId}/download" download title="Download file from Valkey" class="w-8 h-8 rounded-lg bg-slate-50 hover:bg-emerald-50 hover:text-emerald-600 text-slate-500 flex items-center justify-center transition text-xs">
            <i class="fa-solid fa-download"></i>
          </a>

          <button onclick="confirmDeleteFile('${file.fileId}', '${escapeHtml(file.originalName)}')" title="Move to Trash" class="w-8 h-8 rounded-lg bg-slate-50 hover:bg-rose-50 hover:text-rose-600 text-slate-500 flex items-center justify-center transition text-xs">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        </div>

      </div>
    `;
  }).join('');
}

// Preview File Modal
function previewFile(fileId, filename, mimeType, size) {
  const modal = document.getElementById('modal-preview');
  const filenameEl = document.getElementById('preview-filename');
  const filesizeEl = document.getElementById('preview-filesize');
  const iconEl = document.getElementById('preview-icon');
  const contentArea = document.getElementById('preview-content-area');
  const downloadBtn = document.getElementById('preview-download-btn');

  filenameEl.innerText = filename;
  filesizeEl.innerText = `(${formatBytes(size)})`;
  iconEl.innerHTML = `<i class="${getFileIconClass(filename)}"></i>`;
  downloadBtn.href = `/api/files/${fileId}/download`;

  const previewUrl = `/api/files/${fileId}/preview`;

  if (mimeType.startsWith('image/')) {
    contentArea.innerHTML = `<img src="${previewUrl}" alt="${filename}" class="max-h-[70vh] max-w-full rounded-xl object-contain shadow-sm" />`;
  } else if (mimeType.startsWith('audio/')) {
    contentArea.innerHTML = `
      <div class="text-center p-8 bg-white rounded-2xl shadow-sm border border-slate-200">
        <i class="fa-solid fa-music text-4xl text-indigo-500 mb-4"></i>
        <audio controls class="w-full max-w-md">
          <source src="${previewUrl}" type="${mimeType}">
          Your browser does not support audio playback.
        </audio>
      </div>`;
  } else if (mimeType.startsWith('video/')) {
    contentArea.innerHTML = `
      <video controls class="max-h-[70vh] max-w-full rounded-xl shadow-sm">
        <source src="${previewUrl}" type="${mimeType}">
        Your browser does not support video playback.
      </video>`;
  } else if (mimeType === 'application/pdf') {
    contentArea.innerHTML = `<iframe src="${previewUrl}" class="w-full h-[70vh] rounded-xl border border-slate-200 bg-white"></iframe>`;
  } else if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('xml')) {
    contentArea.innerHTML = `<div class="p-4 text-center text-slate-400"><i class="fa-solid fa-circle-notch fa-spin text-xl"></i> Loading text...</div>`;
    fetch(previewUrl)
      .then(res => res.text())
      .then(txt => {
        contentArea.innerHTML = `<pre class="w-full h-[70vh] overflow-auto p-4 bg-slate-900 text-slate-100 rounded-xl font-mono text-xs select-text text-left">${escapeHtml(txt.slice(0, 50000))}</pre>`;
      })
      .catch(() => {
        contentArea.innerHTML = `<p class="text-rose-500 text-xs">Could not load text preview.</p>`;
      });
  } else {
    contentArea.innerHTML = `
      <div class="text-center p-8 bg-white rounded-2xl shadow-sm border border-slate-200 max-w-sm">
        <div class="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-4 text-2xl">
          <i class="${getFileIconClass(filename)}"></i>
        </div>
        <p class="font-bold text-slate-800 text-sm mb-1">${escapeHtml(filename)}</p>
        <p class="text-xs text-slate-400 mb-4">This binary file format is safely backed up in Valkey Redis. Download to view.</p>
        <a href="${previewUrl}" download class="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-semibold shadow hover:bg-indigo-700 transition">
          <i class="fa-solid fa-download"></i>
          <span>Download File</span>
        </a>
      </div>`;
  }

  modal.classList.remove('hidden');
}

function closePreviewModal() {
  document.getElementById('modal-preview').classList.add('hidden');
  document.getElementById('preview-content-area').innerHTML = '';
}

// Delete File
async function confirmDeleteFile(fileId, filename) {
  if (!confirm(`Are you sure you want to remove "${filename}" from your Valkey cloud backup?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to delete file');
    }

    showToast(`"${filename}" removed from backup`, 'info');
    loadUserFiles();
    loadStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Helpers
function getFileCategory(ext) {
  ext = (ext || '').toLowerCase();
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  const docExts = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'md'];
  const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];
  const mediaExts = ['mp3', 'wav', 'ogg', 'mp4', 'mov', 'avi', 'mkv', 'webm', 'flac'];

  if (imageExts.includes(ext)) return 'images';
  if (docExts.includes(ext)) return 'documents';
  if (archiveExts.includes(ext)) return 'archives';
  if (mediaExts.includes(ext)) return 'media';
  return 'other';
}

function getFileIconClass(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'pdf': return 'fa-solid fa-file-pdf text-rose-500';
    case 'doc':
    case 'docx': return 'fa-solid fa-file-word text-blue-500';
    case 'xls':
    case 'xlsx':
    case 'csv': return 'fa-solid fa-file-excel text-emerald-500';
    case 'ppt':
    case 'pptx': return 'fa-solid fa-file-powerpoint text-orange-500';
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz': return 'fa-solid fa-file-zipper text-amber-500';
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp':
    case 'svg': return 'fa-solid fa-file-image text-purple-500';
    case 'mp3':
    case 'wav':
    case 'ogg': return 'fa-solid fa-file-audio text-pink-500';
    case 'mp4':
    case 'mov':
    case 'avi':
    case 'webm': return 'fa-solid fa-file-video text-red-500';
    case 'js':
    case 'ts':
    case 'py':
    case 'html':
    case 'css':
    case 'json': return 'fa-solid fa-file-code text-cyan-500';
    default: return 'fa-solid fa-file text-slate-400';
  }
}

function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================
// 🔗 SHAREABLE LINKS FEATURE
// ==========================================

let currentShareFile = { fileId: null, fileName: '' };

function openShareModal(fileId, fileName) {
  currentShareFile = { fileId, fileName };
  document.getElementById('share-modal-filename').innerText = fileName;
  document.getElementById('share-result-container').classList.add('hidden');
  document.getElementById('share-password-toggle').checked = false;
  document.getElementById('share-password-input-group').classList.add('hidden');
  document.getElementById('share-password-input').value = '';
  document.getElementById('share-expiry-select').value = '86400';
  document.getElementById('share-downloads-select').value = '0';
  document.getElementById('modal-share').classList.remove('hidden');

  loadActiveShares(fileId);
}

function openShareFromPreview() {
  const previewFilename = document.getElementById('preview-filename').innerText;
  const file = userFiles.find(f => f.originalName === previewFilename);
  if (file) {
    closePreviewModal();
    openShareModal(file.fileId, file.originalName);
  }
}

function closeShareModal() {
  document.getElementById('modal-share').classList.add('hidden');
  currentShareFile = { fileId: null, fileName: '' };
}

function toggleSharePasswordInput() {
  const isChecked = document.getElementById('share-password-toggle').checked;
  const inputGroup = document.getElementById('share-password-input-group');
  if (isChecked) {
    inputGroup.classList.remove('hidden');
    document.getElementById('share-password-input').focus();
  } else {
    inputGroup.classList.add('hidden');
    document.getElementById('share-password-input').value = '';
  }
}

async function handleCreateShareLink() {
  if (!currentShareFile.fileId) return;

  const btn = document.getElementById('btn-create-share');
  const expiry = document.getElementById('share-expiry-select').value;
  const maxDl = document.getElementById('share-downloads-select').value;
  const hasPwd = document.getElementById('share-password-toggle').checked;
  const pwd = hasPwd ? document.getElementById('share-password-input').value.trim() : '';

  if (hasPwd && !pwd) {
    showToast('Please enter a password or uncheck the password option', 'warning');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Generating...`;

  try {
    const res = await fetch('/api/shares/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId: currentShareFile.fileId,
        expiresIn: parseInt(expiry),
        maxDownloads: parseInt(maxDl),
        password: pwd
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to create share link');
    }

    // Display result
    const resultBox = document.getElementById('share-result-container');
    const resultUrl = document.getElementById('share-result-url');
    const badges = document.getElementById('share-result-badges');

    resultUrl.value = data.shareUrl;
    badges.innerHTML = [
      data.share.hasPassword ? '<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold"><i class="fa-solid fa-lock text-[9px]"></i> Password</span>' : '',
      data.share.maxDownloads > 0 ? `<span class="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">Max ${data.share.maxDownloads} DL</span>` : '',
      `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">${data.share.expiresIn > 0 ? formatExpiryBadge(data.share.expiresIn) : 'No Expiry'}</span>`
    ].filter(Boolean).join(' ');

    resultBox.classList.remove('hidden');
    showToast('Secure share link created!', 'success');

    // Refresh active shares list
    loadActiveShares(currentShareFile.fileId);

  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-link"></i> <span>Create Secure Link</span>`;
  }
}

function formatExpiryBadge(seconds) {
  if (seconds <= 3600) return '1h Expiry';
  if (seconds <= 86400) return '24h Expiry';
  if (seconds <= 259200) return '3d Expiry';
  if (seconds <= 604800) return '7d Expiry';
  return 'Limited Expiry';
}

function copyGeneratedShareLink() {
  const input = document.getElementById('share-result-url');
  copyToClipboard(input.value);
  const copyBtn = document.getElementById('btn-copy-share');
  const copyText = document.getElementById('copy-btn-text');
  copyText.innerText = 'Copied!';
  copyBtn.classList.add('bg-emerald-700');
  setTimeout(() => {
    copyText.innerText = 'Copy';
    copyBtn.classList.remove('bg-emerald-700');
  }, 2000);
}

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text);
  } else {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  }
  showToast('Link copied to clipboard!', 'info');
}

async function loadActiveShares(fileId) {
  const container = document.getElementById('active-shares-list');
  const countEl = document.getElementById('active-shares-count');
  container.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs"><i class="fa-solid fa-circle-notch fa-spin mr-1"></i> Loading active links...</div>`;

  try {
    const res = await fetch(`/api/shares/file/${fileId}`);
    const data = await res.json();

    if (!res.ok || !data.success || !data.shares || data.shares.length === 0) {
      container.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs">No active links for this file</div>`;
      countEl.innerText = '0';
      return;
    }

    countEl.innerText = data.shares.length;
    const origin = window.location.origin;

    container.innerHTML = data.shares.map(s => {
      const shareUrl = `${origin}/share/${s.shareId}`;
      const expiresFormatted = s.expiresAt === 'never' ? 'Never' : new Date(s.expiresAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const dlInfo = s.maxDownloads > 0 ? `${s.downloadsCount}/${s.maxDownloads} downloads` : `${s.downloadsCount} downloads`;

      return `
        <div class="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs flex items-center justify-between gap-2">
          <div class="truncate flex-1">
            <div class="flex items-center gap-1.5">
              <span class="font-mono text-slate-700 font-semibold truncate">${s.shareId}</span>
              ${s.hasPassword ? '<span class="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold"><i class="fa-solid fa-lock text-[8px]"></i> PWD</span>' : ''}
              ${s.maxDownloads > 0 ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">Burn</span>` : ''}
            </div>
            <div class="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1.5">
              <span><i class="fa-solid fa-download text-[9px]"></i> ${dlInfo}</span>
              <span>•</span>
              <span><i class="fa-regular fa-clock text-[9px]"></i> Exp: ${expiresFormatted}</span>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button onclick="copyToClipboard('${shareUrl}')" title="Copy share link" class="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-300 flex items-center justify-center transition text-xs">
              <i class="fa-regular fa-copy"></i>
            </button>
            <button onclick="revokeShare('${s.shareId}', '${fileId}')" title="Revoke this link immediately" class="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-300 hover:bg-rose-50 flex items-center justify-center transition text-xs">
              <i class="fa-regular fa-trash-can"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    container.innerHTML = `<div class="text-center py-4 text-rose-400 text-xs">Error loading active links</div>`;
  }
}

async function revokeShare(shareId, fileId) {
  if (!confirm('Are you sure you want to revoke this share link? Anyone with this link will immediately lose access.')) {
    return;
  }

  try {
    const res = await fetch(`/api/shares/${shareId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to revoke link');
    }
    showToast('Share link revoked successfully', 'info');
    loadActiveShares(fileId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================
// 📁 FOLDERS & ⭐ STARRED FAVORITES FEATURE
// ==========================================

async function loadUserFolders() {
  try {
    const res = await fetch('/api/folders');
    const data = await res.json();
    if (res.ok && data.success && Array.isArray(data.folders)) {
      userFolders = data.folders;
      renderFolders();
      updateUploadFolderSelect();
    }
  } catch (err) {
    console.error('Failed to load folders:', err);
  }
}

function renderFolders() {
  const section = document.getElementById('folders-section');
  const grid = document.getElementById('folders-grid');
  if (!section || !grid) return;

  if (currentFolderId !== 'root' || isStarredFilterActive || userFolders.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  grid.innerHTML = userFolders.map(folder => {
    const c = getFolderColorClasses(folder.color);
    return `
      <div onclick="navigateToFolder('${folder.folderId}')" class="cursor-pointer bg-white border border-slate-200 ${c.hover} hover:shadow-md rounded-2xl p-3.5 transition flex items-center gap-3 group">
        <div class="w-10 h-10 rounded-xl ${c.bg} ${c.text} flex items-center justify-center text-lg group-hover:scale-105 transition shrink-0">
          <i class="fa-solid fa-folder"></i>
        </div>
        <div class="truncate flex-1">
          <h5 class="text-xs font-bold text-slate-800 truncate" title="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</h5>
          <span class="text-[10px] text-slate-400 font-medium">${folder.fileCount || 0} file${(folder.fileCount === 1) ? '' : 's'}</span>
        </div>
      </div>
    `;
  }).join('');
}

function getFolderColorClasses(color) {
  switch (color) {
    case 'emerald': return { bg: 'bg-emerald-50', text: 'text-emerald-600', hover: 'hover:border-emerald-300' };
    case 'amber': return { bg: 'bg-amber-50', text: 'text-amber-600', hover: 'hover:border-amber-300' };
    case 'rose': return { bg: 'bg-rose-50', text: 'text-rose-600', hover: 'hover:border-rose-300' };
    case 'purple': return { bg: 'bg-purple-50', text: 'text-purple-600', hover: 'hover:border-purple-300' };
    case 'blue': return { bg: 'bg-blue-50', text: 'text-blue-600', hover: 'hover:border-blue-300' };
    default: return { bg: 'bg-indigo-50', text: 'text-indigo-600', hover: 'hover:border-indigo-300' };
  }
}

function navigateToFolder(folderId) {
  currentFolderId = folderId;
  const sep = document.getElementById('breadcrumb-separator');
  const currentBadge = document.getElementById('breadcrumb-current-folder');
  const currentName = document.getElementById('breadcrumb-folder-name');
  const actionsBar = document.getElementById('folder-actions-bar');

  if (folderId === 'root') {
    sep?.classList.add('hidden');
    currentBadge?.classList.add('hidden');
    actionsBar?.classList.add('hidden');
  } else {
    const f = userFolders.find(x => x.folderId === folderId);
    if (f) {
      currentName.innerText = f.name;
      sep?.classList.remove('hidden');
      currentBadge?.classList.remove('hidden');
      actionsBar?.classList.remove('hidden');
    }
  }

  updateUploadFolderSelect();
  renderFolders();
  filterFiles();
}

function updateUploadFolderSelect() {
  const select = document.getElementById('upload-target-folder');
  if (!select) return;

  const options = [
    `<option value="root">📁 Home (Root)</option>`,
    ...userFolders.map(f => `<option value="${f.folderId}" ${currentFolderId === f.folderId ? 'selected' : ''}>📁 ${escapeHtml(f.name)}</option>`)
  ];
  select.innerHTML = options.join('');
  if (currentFolderId && currentFolderId !== 'root') {
    select.value = currentFolderId;
  }
}

function toggleStarredFilter() {
  isStarredFilterActive = !isStarredFilterActive;
  const btn = document.getElementById('btn-filter-starred');
  const icon = document.getElementById('filter-star-icon');

  if (isStarredFilterActive) {
    btn.classList.add('bg-amber-100', 'border-amber-300', 'text-amber-800');
    btn.classList.remove('bg-slate-50', 'border-slate-200', 'text-slate-600');
    icon.className = 'fa-solid fa-star text-amber-500';
  } else {
    btn.classList.remove('bg-amber-100', 'border-amber-300', 'text-amber-800');
    btn.classList.add('bg-slate-50', 'border-slate-200', 'text-slate-600');
    icon.className = 'fa-regular fa-star text-amber-500';
  }

  renderFolders();
  filterFiles();
}

async function toggleStar(fileId) {
  const file = userFiles.find(f => f.fileId === fileId);
  if (!file) return;

  // Optimistic update
  file.isStarred = !file.isStarred;
  filterFiles();

  try {
    const res = await fetch(`/api/files/${fileId}/star`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to update favorite status');
    }
    showToast(data.message || (file.isStarred ? 'Added to Starred' : 'Removed from Starred'), 'info');
  } catch (err) {
    // Revert optimistic update
    file.isStarred = !file.isStarred;
    filterFiles();
    showToast(err.message, 'error');
  }
}

// Folder Modals
function openCreateFolderModal() {
  document.getElementById('input-folder-name').value = '';
  document.getElementById('modal-folder-create').classList.remove('hidden');
  document.getElementById('input-folder-name').focus();
}

function closeCreateFolderModal() {
  document.getElementById('modal-folder-create').classList.add('hidden');
}

async function handleCreateFolder() {
  const name = document.getElementById('input-folder-name').value.trim();
  const color = document.querySelector('input[name="folder-color"]:checked')?.value || 'indigo';

  if (!name) return;

  const btn = document.getElementById('btn-save-folder');
  btn.disabled = true;
  btn.innerText = 'Creating...';

  try {
    const res = await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to create folder');
    }

    showToast(`Folder "${data.folder.name}" created!`, 'success');
    closeCreateFolderModal();
    await loadUserFolders();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Create Folder';
  }
}

function openRenameCurrentFolderModal() {
  const f = userFolders.find(x => x.folderId === currentFolderId);
  if (!f) return;
  document.getElementById('input-rename-folder-name').value = f.name;
  document.getElementById('modal-folder-rename').classList.remove('hidden');
  document.getElementById('input-rename-folder-name').focus();
}

function closeRenameFolderModal() {
  document.getElementById('modal-folder-rename').classList.add('hidden');
}

async function handleRenameFolder() {
  const newName = document.getElementById('input-rename-folder-name').value.trim();
  if (!newName) return;

  try {
    const res = await fetch(`/api/folders/${currentFolderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to rename folder');
    }

    showToast('Folder renamed successfully', 'success');
    closeRenameFolderModal();
    await loadUserFolders();
    navigateToFolder(currentFolderId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function confirmDeleteCurrentFolder() {
  const f = userFolders.find(x => x.folderId === currentFolderId);
  if (!f) return;

  if (!confirm(`Delete folder "${f.name}"? Any files inside will be safely moved to Home.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/folders/${currentFolderId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to delete folder');
    }

    showToast(data.message || 'Folder deleted', 'info');
    navigateToFolder('root');
    await Promise.all([loadUserFolders(), loadUserFiles()]);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Move File Modal
function openMoveModal(fileId, fileName) {
  movingFile = { fileId, fileName };
  document.getElementById('move-file-name').innerText = fileName;

  const currentFile = userFiles.find(f => f.fileId === fileId);
  const currentFId = currentFile?.folderId || 'root';

  const container = document.getElementById('move-folder-options');
  const destinations = [
    { folderId: 'root', name: 'Home (Root)', icon: 'fa-house', isCurrent: currentFId === 'root' },
    ...userFolders.map(f => ({
      folderId: f.folderId,
      name: f.name,
      icon: 'fa-folder',
      color: f.color,
      isCurrent: currentFId === f.folderId
    }))
  ];

  container.innerHTML = destinations.map(d => `
    <div onclick="handleMoveFile('${d.folderId}')" class="p-3 rounded-xl border ${d.isCurrent ? 'border-indigo-300 bg-indigo-50/50 cursor-default' : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50 cursor-pointer'} transition flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <i class="fa-solid ${d.icon} ${d.isCurrent ? 'text-indigo-600' : 'text-slate-400'} text-base"></i>
        <span class="text-xs font-semibold ${d.isCurrent ? 'text-indigo-900' : 'text-slate-700'}">${escapeHtml(d.name)}</span>
      </div>
      ${d.isCurrent ? '<span class="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Current</span>' : '<span class="text-xs text-indigo-600 font-semibold hover:underline">Move Here →</span>'}
    </div>
  `).join('');

  document.getElementById('modal-file-move').classList.remove('hidden');
}

function closeMoveModal() {
  document.getElementById('modal-file-move').classList.add('hidden');
  movingFile = { fileId: null, fileName: '' };
}

async function handleMoveFile(targetFolderId) {
  if (batchMoveMode) {
    try {
      const res = await fetch('/api/files/batch/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: Array.from(selectedFileIds), folderId: targetFolderId })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to move files');
      }

      showToast(data.message || 'Files moved successfully', 'success');
      closeMoveModal();
      clearSelectedFiles();
      await Promise.all([loadUserFolders(), loadUserFiles()]);
    } catch (err) {
      showToast(err.message, 'error');
    }
    return;
  }

  if (!movingFile.fileId) return;

  const currentFile = userFiles.find(f => f.fileId === movingFile.fileId);
  if (currentFile && (currentFile.folderId || 'root') === targetFolderId) {
    closeMoveModal();
    return;
  }

  try {
    const res = await fetch(`/api/files/${movingFile.fileId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId: targetFolderId })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to move file');
    }

    showToast(data.message || 'File moved successfully', 'success');
    closeMoveModal();
    await Promise.all([loadUserFolders(), loadUserFiles()]);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function refreshDashboardData() {
  await Promise.all([loadStats(), loadUserFolders(), loadUserFiles()]);
  showToast('Dashboard updated', 'info');
}

// ==========================================
// 📦 MULTI-SELECT & BATCH ACTIONS
// ==========================================

function toggleSelectFile(fileId, event) {
  if (event) event.stopPropagation();
  if (selectedFileIds.has(fileId)) {
    selectedFileIds.delete(fileId);
  } else {
    selectedFileIds.add(fileId);
  }
  updateBatchUI();
  filterFiles();
}

function toggleSelectAllFiles() {
  const visibleFiles = getVisibleFilteredFiles();
  if (visibleFiles.length === 0) return;

  const allSelected = visibleFiles.every(f => selectedFileIds.has(f.fileId));
  if (allSelected) {
    visibleFiles.forEach(f => selectedFileIds.delete(f.fileId));
  } else {
    visibleFiles.forEach(f => selectedFileIds.add(f.fileId));
  }
  updateBatchUI();
  filterFiles();
}

function clearSelectedFiles() {
  selectedFileIds.clear();
  updateBatchUI();
  filterFiles();
}

function updateBatchUI() {
  const bar = document.getElementById('batch-action-bar');
  const countSpan = document.getElementById('batch-selected-count');
  const selectAllIcon = document.getElementById('select-all-icon');
  const selectAllText = document.getElementById('select-all-text');

  const count = selectedFileIds.size;
  if (count > 0) {
    bar?.classList.remove('hidden');
    if (countSpan) countSpan.innerText = `${count} file${count === 1 ? '' : 's'}`;
    if (selectAllText) selectAllText.innerText = `${count} selected`;
    if (selectAllIcon) selectAllIcon.className = 'fa-solid fa-square-check text-indigo-600';
  } else {
    bar?.classList.add('hidden');
    if (selectAllText) selectAllText.innerText = 'Select';
    if (selectAllIcon) selectAllIcon.className = 'fa-regular fa-square-check';
  }
}

function getVisibleFilteredFiles() {
  const searchQuery = document.getElementById('input-search-files').value.toLowerCase().trim();
  const category = document.getElementById('select-filter-category').value;

  const pool = isTrashViewActive ? trashFiles : userFiles;

  return pool.filter(file => {
    const matchesSearch = file.originalName.toLowerCase().includes(searchQuery);
    if (!matchesSearch) return false;

    if (category !== 'all' && getFileCategory(file.extension) !== category) {
      return false;
    }

    if (isTrashViewActive) return true;

    if (isStarredFilterActive) {
      return file.isStarred === true;
    }

    const fileFolder = file.folderId || 'root';
    return fileFolder === currentFolderId;
  });
}

function handleBatchDownloadZip() {
  if (selectedFileIds.size === 0) return;
  const ids = Array.from(selectedFileIds).join(',');
  window.location.href = `/api/files/batch/download-zip?ids=${encodeURIComponent(ids)}`;
  showToast('ZIP archive is generating and downloading...', 'info');
  clearSelectedFiles();
}

function handleBatchOpenMoveModal() {
  if (selectedFileIds.size === 0) return;
  batchMoveMode = true;
  movingFile = { fileId: 'batch', fileName: `${selectedFileIds.size} files` };
  document.getElementById('move-file-name').innerText = `${selectedFileIds.size} selected files`;

  const container = document.getElementById('move-folder-options');
  const destinations = [
    { folderId: 'root', name: 'Home (Root)', icon: 'fa-house', isCurrent: false },
    ...userFolders.map(f => ({
      folderId: f.folderId,
      name: f.name,
      icon: 'fa-folder',
      color: f.color,
      isCurrent: false
    }))
  ];

  container.innerHTML = destinations.map(d => `
    <div onclick="handleMoveFile('${d.folderId}')" class="p-3 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-slate-50 cursor-pointer transition flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <i class="fa-solid ${d.icon} text-slate-400 text-base"></i>
        <span class="text-xs font-semibold text-slate-700">${escapeHtml(d.name)}</span>
      </div>
      <span class="text-xs text-indigo-600 font-semibold hover:underline">Move Here →</span>
    </div>
  `).join('');

  document.getElementById('modal-file-move').classList.remove('hidden');
}

async function handleBatchTrashFiles() {
  if (selectedFileIds.size === 0) return;
  if (!confirm(`Move ${selectedFileIds.size} files to Trash?`)) return;

  try {
    const res = await fetch('/api/files/batch/trash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileIds: Array.from(selectedFileIds) })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Batch trash failed');

    showToast(data.message || `${selectedFileIds.size} files moved to Trash`, 'info');
    clearSelectedFiles();
    await Promise.all([loadStats(), loadUserFolders(), loadUserFiles()]);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================
// 🗑️ TRASH VIEW & MANAGEMENT
// ==========================================

async function toggleTrashView(forceState) {
  isTrashViewActive = (typeof forceState === 'boolean') ? forceState : !isTrashViewActive;

  const normalBreadcrumbs = document.getElementById('normal-breadcrumbs');
  const trashHeaderBar = document.getElementById('trash-header-bar');
  const foldersSection = document.getElementById('folders-section');
  const btnTrash = document.getElementById('btn-view-trash');

  if (isTrashViewActive) {
    normalBreadcrumbs?.classList.add('hidden');
    trashHeaderBar?.classList.remove('hidden');
    foldersSection?.classList.add('hidden');
    btnTrash?.classList.add('bg-rose-100', 'border-rose-300', 'text-rose-800');

    try {
      const res = await fetch('/api/files/trash');
      const data = await res.json();
      trashFiles = (res.ok && data.success && Array.isArray(data.files)) ? data.files : [];
    } catch (e) {
      trashFiles = [];
    }
  } else {
    normalBreadcrumbs?.classList.remove('hidden');
    trashHeaderBar?.classList.add('hidden');
    btnTrash?.classList.remove('bg-rose-100', 'border-rose-300', 'text-rose-800');
    renderFolders();
  }

  clearSelectedFiles();
  filterFiles();
}

async function restoreSingleFile(fileId) {
  try {
    const res = await fetch(`/api/files/${fileId}/restore`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Failed to restore file');

    showToast('File restored to vault', 'success');
    await Promise.all([loadStats(), loadUserFiles()]);
    if (isTrashViewActive) {
      await toggleTrashView(true);
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deletePermanently(fileId, filename) {
  if (!confirm(`Permanently delete "${filename}"? This action CANNOT be undone and data is removed forever.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/files/${fileId}/permanent`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Permanent delete failed');

    showToast('File permanently deleted', 'info');
    await loadStats();
    if (isTrashViewActive) {
      await toggleTrashView(true);
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleEmptyTrash() {
  if (!confirm('Are you sure you want to permanently purge all files in Trash? This CANNOT be undone.')) {
    return;
  }

  try {
    const res = await fetch('/api/files/trash/empty', { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Failed to empty trash');

    showToast(data.message || 'Trash emptied', 'info');
    await loadStats();
    await toggleTrashView(true);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function confirmDeleteFile(fileId, filename) {
  if (!confirm(`Move "${filename}" to Trash? You can restore it later.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Failed to delete');
    showToast(`"${filename}" moved to Trash`, 'info');
    await Promise.all([loadStats(), loadUserFolders(), loadUserFiles()]);
  } catch (err) {
    showToast(err.message, 'error');
  }
}
