/**
 * INBEX — Login Page Script  v2.0
 * Handles: password visibility, form validation,
 *          loading state, toast notifications, blob parallax
 */

'use strict';

/* =====================================================
   DOM References
===================================================== */
// Auto-redirect if already logged in
if (window.Auth && window.Auth.isAuthenticated()) {
    window.location.href = 'dashboard.html';
}

const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const toggleBtn = document.getElementById('toggle-password');
const submitBtn = document.getElementById('submit-btn');
const googleBtn = document.getElementById('google-btn');
const forgotLink = document.getElementById('forgot-link');

const emailGroup = document.getElementById('email-group');
const passwordGroup = document.getElementById('password-group');
const emailError = document.getElementById('email-error');
const passwordError = document.getElementById('password-error');

const iconEyeOpen = toggleBtn.querySelector('.icon-eye-open');
const iconEyeClosed = toggleBtn.querySelector('.icon-eye-closed');

/* =====================================================
   1. SHOW / HIDE PASSWORD
===================================================== */
toggleBtn.addEventListener('click', () => {
    const isHidden = passwordInput.type === 'password';
    passwordInput.type = isHidden ? 'text' : 'password';
    toggleBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
    toggleBtn.setAttribute('aria-pressed', isHidden ? 'true' : 'false');
    iconEyeOpen.style.display = isHidden ? 'none' : 'block';
    iconEyeClosed.style.display = isHidden ? 'block' : 'none';
});

/* =====================================================
   2. VALIDATION HELPERS
===================================================== */
function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function setFieldError(group, errorEl, message) {
    if (message) {
        group.classList.add('has-error');
        errorEl.textContent = message;
    } else {
        group.classList.remove('has-error');
        errorEl.textContent = '';
    }
}

function clearOnInput(input, group, errorEl) {
    input.addEventListener('input', () => {
        if (group.classList.contains('has-error')) {
            setFieldError(group, errorEl, null);
        }
    });
}

clearOnInput(emailInput, emailGroup, emailError);
clearOnInput(passwordInput, passwordGroup, passwordError);

function validateForm() {
    let valid = true;

    const email = emailInput.value.trim();
    if (!email) {
        setFieldError(emailGroup, emailError, 'Email address is required.');
        valid = false;
    } else if (!isValidEmail(email)) {
        setFieldError(emailGroup, emailError, 'Please enter a valid email address.');
        valid = false;
    } else {
        setFieldError(emailGroup, emailError, null);
    }

    const pw = passwordInput.value;
    if (!pw) {
        setFieldError(passwordGroup, passwordError, 'Password is required.');
        valid = false;
    } else if (pw.length < 8) {
        setFieldError(passwordGroup, passwordError, 'Password must be at least 8 characters.');
        valid = false;
    } else {
        setFieldError(passwordGroup, passwordError, null);
    }

    return valid;
}

const API_BASE = '';

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!validateForm()) {
        const firstError = loginForm.querySelector('.has-error .input-field');
        if (firstError) shakeElement(firstError);
        return;
    }

    setLoading(true);

    try {
        const resp = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: emailInput.value.trim(),
                password: passwordInput.value
            }),
        });

        const result = await resp.json();

        if (!resp.ok) {
            throw new Error(result.detail || 'Invalid email or password.');
        }

        // Store session via Auth helper if available, else localStorage
        if (window.Auth) {
            window.Auth.setSession(result.access_token, result.user);
        } else {
            localStorage.setItem('inbex-token', result.access_token);
            localStorage.setItem('inbex-user', JSON.stringify(result.user));
            localStorage.setItem('inbexAuth', 'true');
        }

        showToast('Signed in successfully!', 'success');
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 800);

    } catch (err) {
        showToast(err.message || 'Something went wrong. Please try again.', 'error');
    } finally {
        setLoading(false);
    }
});

function setLoading(on) {
    submitBtn.classList.toggle('loading', on);
    submitBtn.disabled = on;
    emailInput.disabled = on;
    passwordInput.disabled = on;
}

/* =====================================================
   4. GOOGLE SSO — Redirects to backend OAuth
===================================================== */
googleBtn.addEventListener('click', () => {
    showToast('Redirecting to Google…', 'info');
    window.location.href = `${API_BASE}/auth/google`;
});

/* =====================================================
   5. FORGOT PASSWORD — 3-step flow
===================================================== */

// State
let fpResetToken = null;
let fpEmail      = null;
let fpCountdownTimer = null;

// All panels (loginForm already declared at top of file)
const fpStep1    = document.getElementById('fp-step-1');
const fpStep2    = document.getElementById('fp-step-2');
const fpStep3    = document.getElementById('fp-step-3');

function showPanel(panel) {
    [loginForm, fpStep1, fpStep2, fpStep3].forEach(p => { if (p) p.hidden = true; });
    if (panel) panel.hidden = false;
}

// "Forgot password?" link → Step 1
forgotLink.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('fp-email').value = emailInput.value || '';
    document.getElementById('fp-email-error').textContent = '';
    showPanel(fpStep1);
    setTimeout(() => document.getElementById('fp-email').focus(), 80);
});

// Step 1 — Back
document.getElementById('fp-back-1').addEventListener('click', () => {
    showPanel(loginForm);
});

// Step 1 — Send OTP
document.getElementById('fp-send-btn').addEventListener('click', async () => {
    const email = document.getElementById('fp-email').value.trim();
    const errEl = document.getElementById('fp-email-error');
    const btn   = document.getElementById('fp-send-btn');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errEl.textContent = 'Please enter a valid email address.';
        return;
    }
    errEl.textContent = '';
    btn.classList.add('loading'); btn.disabled = true;

    try {
        const resp = await fetch(`${API_BASE}/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || 'Failed to send reset code.');

        fpEmail = email;
        document.getElementById('fp-email-display').textContent = email;

        // Reset OTP digits
        document.querySelectorAll('#fp-otp-inputs .otp-digit').forEach(d => {
            d.value = ''; d.classList.remove('filled', 'otp-shake');
        });
        document.getElementById('fp-otp-error').textContent = '';

        showPanel(fpStep2);
        fpStartCountdown(30);
        setTimeout(() => document.getElementById('fp-d1').focus(), 80);

        // DEV MODE: auto-fill OTP digits if backend returned the code
        if (data.devMode && data.devOtp) {
            showToast('⚠️ DEV MODE: OTP auto-filled from response (Resend not configured).', 'info', 6000);
            const digits = data.devOtp.split('');
            fpDigits.forEach((d, i) => {
                d.value = digits[i] || '';
                d.classList.toggle('filled', !!digits[i]);
            });
        } else {
            showToast('Reset code sent! Check your inbox.', 'success');
        }

    } catch (err) {
        errEl.textContent = err.message;
    } finally {
        btn.classList.remove('loading'); btn.disabled = false;
    }
});

// Allow Enter key on fp-email input
document.getElementById('fp-email').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('fp-send-btn').click();
});

// Step 2 — Back
document.getElementById('fp-back-2').addEventListener('click', () => {
    fpClearCountdown();
    showPanel(fpStep1);
});

// Step 2 — OTP digit inputs (auto-advance + paste)
const fpDigits = Array.from(document.querySelectorAll('#fp-otp-inputs .otp-digit'));
fpDigits.forEach((input, idx) => {
    input.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g, '');
        e.target.value = val ? val[val.length - 1] : '';
        if (val) {
            input.classList.add('filled');
            if (idx < fpDigits.length - 1) fpDigits[idx + 1].focus();
            else { input.blur(); fpSubmitOTP(); }
        } else {
            input.classList.remove('filled');
        }
        document.getElementById('fp-otp-error').textContent = '';
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && idx > 0) {
            fpDigits[idx - 1].focus();
            fpDigits[idx - 1].value = '';
            fpDigits[idx - 1].classList.remove('filled');
        }
    });
    input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        if (pasted.length >= 6) {
            fpDigits.forEach((d, i) => { d.value = pasted[i] || ''; d.classList.toggle('filled', !!pasted[i]); });
            fpDigits[5].focus();
        }
    });
});

// Step 2 — Verify OTP
document.getElementById('fp-verify-btn').addEventListener('click', fpSubmitOTP);

async function fpSubmitOTP() {
    const otp   = fpDigits.map(d => d.value).join('');
    const errEl = document.getElementById('fp-otp-error');
    const btn   = document.getElementById('fp-verify-btn');

    if (otp.length < 6) {
        errEl.textContent = 'Please enter all 6 digits.';
        fpShakeDigits();
        return;
    }
    errEl.textContent = '';
    btn.classList.add('loading'); btn.disabled = true;

    try {
        const resp = await fetch(`${API_BASE}/auth/verify-reset-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: fpEmail, otp }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || 'Invalid code.');

        fpResetToken = data.reset_token;
        fpClearCountdown();
        document.getElementById('fp-new-pw').value = '';
        document.getElementById('fp-confirm-pw').value = '';
        document.getElementById('fp-pw-error').textContent = '';
        showPanel(fpStep3);
        setTimeout(() => document.getElementById('fp-new-pw').focus(), 80);

    } catch (err) {
        errEl.textContent = err.message;
        fpShakeDigits();
    } finally {
        btn.classList.remove('loading'); btn.disabled = false;
    }
}

function fpShakeDigits() {
    fpDigits.forEach(d => {
        d.classList.remove('otp-shake');
        void d.offsetWidth;
        d.classList.add('otp-shake');
    });
    setTimeout(() => fpDigits.forEach(d => d.classList.remove('otp-shake')), 400);
}

// Step 2 — Resend
document.getElementById('fp-resend-btn').addEventListener('click', async () => {
    document.getElementById('fp-resend-btn').disabled = true;
    fpDigits.forEach(d => { d.value = ''; d.classList.remove('filled'); });
    document.getElementById('fp-otp-error').textContent = '';

    try {
        const resp = await fetch(`${API_BASE}/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: fpEmail }),
        });
        if (!resp.ok) throw new Error('Failed to resend.');
        showToast('New code sent!', 'success');
        fpStartCountdown(30);
        fpDigits[0].focus();
    } catch {
        document.getElementById('fp-resend-btn').disabled = false;
        showToast('Could not resend code. Try again.', 'error');
    }
});

function fpStartCountdown(secs) {
    const btn = document.getElementById('fp-resend-btn');
    const cd  = document.getElementById('fp-countdown');
    btn.disabled = true;
    let remaining = secs;
    cd.textContent = `(${remaining}s)`;
    cd.hidden = false;
    fpCountdownTimer = setInterval(() => {
        remaining--;
        cd.textContent = `(${remaining}s)`;
        if (remaining <= 0) {
            clearInterval(fpCountdownTimer);
            btn.disabled = false;
            cd.hidden = true;
        }
    }, 1000);
}

function fpClearCountdown() {
    if (fpCountdownTimer) { clearInterval(fpCountdownTimer); fpCountdownTimer = null; }
}

// Step 3 — Reset Password
document.getElementById('fp-reset-btn').addEventListener('click', async () => {
    const newPw  = document.getElementById('fp-new-pw').value;
    const cfmPw  = document.getElementById('fp-confirm-pw').value;
    const errEl  = document.getElementById('fp-pw-error');
    const btn    = document.getElementById('fp-reset-btn');

    if (!newPw || newPw.length < 8) {
        errEl.textContent = 'Password must be at least 8 characters.';
        return;
    }
    if (newPw !== cfmPw) {
        errEl.textContent = "Passwords don't match.";
        return;
    }
    errEl.textContent = '';
    btn.classList.add('loading'); btn.disabled = true;

    try {
        const resp = await fetch(`${API_BASE}/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reset_token: fpResetToken, new_password: newPw }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.detail || 'Reset failed.');

        showToast('Password reset! You can now sign in.', 'success');
        fpResetToken = null;
        fpEmail = null;
        showPanel(loginForm);

    } catch (err) {
        errEl.textContent = err.message;
    } finally {
        btn.classList.remove('loading'); btn.disabled = false;
    }
});

/* =====================================================
   6. TOAST NOTIFICATION
===================================================== */
let toastTimeout = null;

function showToast(message, type = 'info', duration = 3600) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    if (toastTimeout) clearTimeout(toastTimeout);

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `<span class="toast-dot" aria-hidden="true"></span><span>${message}</span>`;
    document.body.appendChild(el);

    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));

    toastTimeout = setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 450);
    }, duration);
}

/* =====================================================
   7. SHAKE ANIMATION
===================================================== */
function shakeElement(el) {
    if (!el.animate) return;
    el.animate(
        [
            { transform: 'translateX(0)' },
            { transform: 'translateX(-7px)' },
            { transform: 'translateX(7px)' },
            { transform: 'translateX(-4px)' },
            { transform: 'translateX(4px)' },
            { transform: 'translateX(0)' },
        ],
        { duration: 340, easing: 'ease-out' }
    );
}

/* =====================================================
   8. PREMIUM BLOB PARALLAX (Lerp + rAF)
===================================================== */
const premiumBlobs = document.querySelectorAll('.premium-blob');

let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
let currentX = window.innerWidth / 2;
let currentY = window.innerHeight / 2;

document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
});

function animateBlobs() {
    // Smooth lerp (easing factor ~0.05 for natural motion)
    currentX += (mouseX - currentX) * 0.05;
    currentY += (mouseY - currentY) * 0.05;

    // Calculate displacement from center
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;

    // Normalize roughly -1 to 1 based on screen size
    const dx = (currentX - cx) / cx;
    const dy = (currentY - cy) / cy;

    premiumBlobs.forEach((blob, i) => {
        // Range of movement (e.g. 50px - 150px maximum displacement)
        const range = 60 + (i * 30);

        const moveX = dx * range;
        const moveY = dy * range;

        // Reverse dir for middle blob to add parallax depth
        const dir = i % 2 === 0 ? 1 : -0.6;

        blob.style.transform = `translate(${moveX * dir}px, ${moveY * dir}px)`;
    });

    requestAnimationFrame(animateBlobs);
}

// Start loop
animateBlobs();

/* =====================================================
   9. KEYBOARD FLOW — Enter on email → focus password
===================================================== */
emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); passwordInput.focus(); }
});
