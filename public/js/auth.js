// Auth State & Management
let currentAuthType = 'email'; // 'email' or 'mobile'
let pendingIdentifier = '';
let currentUser = null;
let resendTimer = null;
let resendCountdown = 60;

// Toast Notification
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'pointer-events-auto p-4 rounded-xl shadow-lg border text-xs sm:text-sm font-medium flex items-center justify-between gap-3 transform transition-all duration-300 fade-in';

  let icon = 'fa-solid fa-circle-info';
  let colors = 'bg-slate-900 text-white border-slate-800';

  if (type === 'success') {
    colors = 'bg-emerald-600 text-white border-emerald-500';
    icon = 'fa-solid fa-circle-check';
  } else if (type === 'error') {
    colors = 'bg-rose-600 text-white border-rose-500';
    icon = 'fa-solid fa-circle-exclamation';
  } else if (type === 'warning') {
    colors = 'bg-amber-500 text-white border-amber-400';
    icon = 'fa-solid fa-triangle-exclamation';
  }

  toast.className += ` ${colors}`;
  toast.innerHTML = `
    <div class="flex items-center gap-2.5">
      <i class="${icon} text-base"></i>
      <span>${message}</span>
    </div>
    <button onclick="this.parentElement.remove()" class="text-white/80 hover:text-white text-xs">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-x-4');
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// Tab Switching
document.addEventListener('DOMContentLoaded', () => {
  const tabEmail = document.getElementById('tab-email');
  const tabMobile = document.getElementById('tab-mobile');
  const fieldEmail = document.getElementById('field-email-container');
  const fieldMobile = document.getElementById('field-mobile-container');
  const extraLinkLabel = document.getElementById('extra-link-label');
  const extraLinkInput = document.getElementById('extra-link-input');

  if (tabEmail && tabMobile) {
    tabEmail.addEventListener('click', () => {
      currentAuthType = 'email';
      tabEmail.className = 'flex-1 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-white text-indigo-600 shadow-sm transition-all flex items-center justify-center gap-2';
      tabMobile.className = 'flex-1 py-2 text-xs sm:text-sm font-semibold rounded-lg text-slate-500 hover:text-slate-800 transition-all flex items-center justify-center gap-2';
      fieldEmail.classList.remove('hidden');
      fieldMobile.classList.add('hidden');
      if (extraLinkLabel) extraLinkLabel.innerText = 'Link Mobile Number (Optional)';
      if (extraLinkInput) extraLinkInput.placeholder = 'e.g. +91 9876543210';
    });

    tabMobile.addEventListener('click', () => {
      currentAuthType = 'mobile';
      tabMobile.className = 'flex-1 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-white text-indigo-600 shadow-sm transition-all flex items-center justify-center gap-2';
      tabEmail.className = 'flex-1 py-2 text-xs sm:text-sm font-semibold rounded-lg text-slate-500 hover:text-slate-800 transition-all flex items-center justify-center gap-2';
      fieldMobile.classList.remove('hidden');
      fieldEmail.classList.add('hidden');
      if (extraLinkLabel) extraLinkLabel.innerText = 'Link Email Address (Optional)';
      if (extraLinkInput) extraLinkInput.placeholder = 'e.g. user@example.com';
    });
  }

  // Check existing session
  checkAuthSession();
});

// Request OTP
async function handleRequestOtp() {
  const btn = document.getElementById('btn-send-otp');
  const inputEmail = document.getElementById('input-email');
  const inputMobile = document.getElementById('input-mobile');

  const identifier = currentAuthType === 'email' ? inputEmail.value.trim() : inputMobile.value.trim();

  if (!identifier) {
    showToast(`Please enter your ${currentAuthType === 'email' ? 'email address' : 'mobile number'}`, 'warning');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin text-sm"></i> <span>Sending OTP...</span>`;

  try {
    const res = await fetch('/api/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: currentAuthType, identifier })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to send OTP code');
    }

    pendingIdentifier = identifier;
    showToast(data.message || 'OTP verification code sent!', 'success');

    // Move to step 2: OTP screen
    document.getElementById('auth-step-input').classList.add('hidden');
    document.getElementById('auth-step-otp').classList.remove('hidden');
    document.getElementById('display-target-identifier').innerText = pendingIdentifier;

    // Handle preview OTP banner if in dev / preview mode
    const previewBanner = document.getElementById('preview-otp-banner');
    const previewValue = document.getElementById('preview-otp-value');
    if (data.previewOtp) {
      previewValue.innerText = data.previewOtp;
      previewValue.onclick = () => {
        document.getElementById('input-otp').value = data.previewOtp;
      };
      previewBanner.classList.remove('hidden');
    } else {
      previewBanner.classList.add('hidden');
    }

    document.getElementById('input-otp').value = '';
    document.getElementById('input-otp').focus();

    // Start resend countdown
    startResendTimer();

  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>Send Verification Code</span> <i class="fa-solid fa-arrow-right text-xs"></i>`;
  }
}

// Resend OTP
async function handleResendOtp() {
  if (resendCountdown > 0) return;
  await handleRequestOtp();
}

function startResendTimer() {
  clearInterval(resendTimer);
  resendCountdown = 60;
  const resendBtn = document.getElementById('btn-resend-otp');

  resendTimer = setInterval(() => {
    resendCountdown--;
    if (resendCountdown <= 0) {
      clearInterval(resendTimer);
      resendBtn.innerText = 'Resend Code';
      resendBtn.classList.remove('text-slate-400', 'cursor-not-allowed');
      resendBtn.classList.add('text-indigo-600', 'hover:text-indigo-800');
    } else {
      resendBtn.innerText = `Resend in ${resendCountdown}s`;
      resendBtn.classList.add('text-slate-400', 'cursor-not-allowed');
      resendBtn.classList.remove('text-indigo-600', 'hover:text-indigo-800');
    }
  }, 1000);
}

// Back to Step 1
function backToStepInput() {
  clearInterval(resendTimer);
  document.getElementById('auth-step-otp').classList.add('hidden');
  document.getElementById('auth-step-input').classList.remove('hidden');
}

// Verify OTP
async function handleVerifyOtp() {
  const code = document.getElementById('input-otp').value.trim();
  const extraVal = document.getElementById('extra-link-input')?.value.trim() || '';

  if (!code || code.length !== 6) {
    showToast('Please enter the 6-digit verification code', 'warning');
    return;
  }

  const btn = document.getElementById('btn-verify-otp');
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin text-sm"></i> <span>Verifying...</span>`;

  const extraDetails = {};
  if (currentAuthType === 'email' && extraVal) {
    extraDetails.mobile = extraVal;
  } else if (currentAuthType === 'mobile' && extraVal) {
    extraDetails.email = extraVal;
  }

  try {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: currentAuthType,
        identifier: pendingIdentifier,
        code,
        extraDetails
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Verification failed');
    }

    showToast('Login successful! Welcome to your vault.', 'success');
    currentUser = data.user;
    updateUserInterface(currentUser);

  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-lock-open text-xs"></i> <span>Verify & Access Vault</span>`;
  }
}

// Check if user already has active session
async function checkAuthSession() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.user) {
        currentUser = data.user;
        updateUserInterface(currentUser);
      }
    }
  } catch (e) {
    console.log('No active session');
  }
}

// Update UI based on logged in user
function updateUserInterface(user) {
  if (!user) {
    document.getElementById('auth-section').classList.remove('hidden');
    document.getElementById('dashboard-section').classList.add('hidden');
    return;
  }

  document.getElementById('auth-section').classList.add('hidden');
  document.getElementById('dashboard-section').classList.remove('hidden');

  // Display contact info
  const primaryText = user.email || user.mobile || 'User';
  const secondaryText = user.mobile ? `Phone: ${user.mobile}` : (user.email ? `Email: ${user.email}` : 'No phone linked');

  document.getElementById('user-display-primary').innerText = primaryText;
  document.getElementById('user-display-secondary').innerText = secondaryText;

  const initials = (user.name || primaryText).slice(0, 2).toUpperCase();
  document.getElementById('user-initials').innerText = initials;

  // Initialize Dashboard
  if (typeof initDashboard === 'function') {
    initDashboard();
  }
}

// Profile Modal Management
function openProfileModal() {
  if (!currentUser) return;
  document.getElementById('profile-input-name').value = currentUser.name || '';
  document.getElementById('profile-input-email').value = currentUser.email || '';
  document.getElementById('profile-input-mobile').value = currentUser.mobile || '';
  document.getElementById('modal-profile').classList.remove('hidden');
}

function closeProfileModal() {
  document.getElementById('modal-profile').classList.add('hidden');
}

// Update profile submit
async function handleUpdateProfile() {
  const name = document.getElementById('profile-input-name').value.trim();
  const email = document.getElementById('profile-input-email').value.trim();
  const mobile = document.getElementById('profile-input-mobile').value.trim();

  try {
    const res = await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, mobile })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Failed to update profile');
    }

    currentUser = data.user;
    updateUserInterface(currentUser);
    closeProfileModal();
    showToast('Profile updated successfully!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Logout
async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    console.error(e);
  }
  currentUser = null;
  location.reload();
}
