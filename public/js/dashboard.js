// Dashboard & File Management Logic

let stagedFiles = [];
let userFiles = [];

function initDashboard() {
  setupDropZone();
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
      document.getElementById('stat-total-files').innerText = data.stats.totalFiles || 0;
      document.getElementById('stat-total-size').innerText = data.stats.totalSizeFormatted || '0 B';
    }
  } catch (e) {
    console.error('Failed to load stats', e);
  }
}

// Filter and Render Files
function filterFiles() {
  const searchQuery = document.getElementById('input-search-files').value.toLowerCase().trim();
  const category = document.getElementById('select-filter-category').value;

  const empty = document.getElementById('files-empty');
  const grid = document.getElementById('files-grid');

  const filtered = userFiles.filter(file => {
    const matchesSearch = file.originalName.toLowerCase().includes(searchQuery);
    if (!matchesSearch) return false;

    if (category === 'all') return true;
    return getFileCategory(file.extension) === category;
  });

  if (filtered.length === 0) {
    empty.classList.remove('hidden');
    grid.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.classList.remove('hidden');

  grid.innerHTML = filtered.map(file => {
    const iconClass = getFileIconClass(file.originalName);
    const dateFormatted = new Date(file.uploadDate).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    return `
      <div class="group bg-white border border-slate-200 hover:border-indigo-300 hover:shadow-md rounded-2xl p-4 transition-all flex flex-col justify-between">
        
        <!-- Top File Header -->
        <div class="flex items-start justify-between gap-2 mb-3">
          <div class="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-indigo-600 text-lg group-hover:scale-105 transition">
            <i class="${iconClass}"></i>
          </div>
          <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            ${escapeHtml(file.extension || 'FILE')}
          </span>
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

          <a href="/api/files/${file.fileId}/download" download title="Download file from Valkey" class="w-8 h-8 rounded-lg bg-slate-50 hover:bg-emerald-50 hover:text-emerald-600 text-slate-500 flex items-center justify-center transition text-xs">
            <i class="fa-solid fa-download"></i>
          </a>

          <button onclick="confirmDeleteFile('${file.fileId}', '${escapeHtml(file.originalName)}')" title="Delete from backup" class="w-8 h-8 rounded-lg bg-slate-50 hover:bg-rose-50 hover:text-rose-600 text-slate-500 flex items-center justify-center transition text-xs">
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
