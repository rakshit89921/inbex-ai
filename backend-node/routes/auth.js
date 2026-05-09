/**
 * INBEX — Auth Router
 * POST /auth/send-otp      — Step 1: validate form data, email OTP
 * POST /auth/verify-otp    — Step 2: verify OTP, create account, return JWT
 * POST /auth/login         — Login and get JWT
 * GET  /auth/me            — Get current user (protected)
 * GET  /auth/google        — Google OAuth Sign-In
 * GET  /auth/google/callback — Google OAuth callback
 */
'use strict';

const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { google } = require('googleapis');
const { Resend } = require('resend');
const config = require('../config');
const { run, get } = require('../database');
const requireAuth = require('../middleware/auth');

const router = Router();

// ── In-memory OTP store: email → { otp, name, password, expiresAt } ──
const otpStore = new Map();
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Clean up expired OTPs every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [email, data] of otpStore.entries()) {
        if (now > data.expiresAt) otpStore.delete(email);
    }
}, 5 * 60 * 1000);

// ── Resend client ──
const resend = new Resend(config.resendApiKey);

/**
 * Check whether Resend is properly configured (not a placeholder key).
 */
function isResendConfigured() {
    const key = config.resendApiKey || '';
    return key.startsWith('re_') && !key.includes('your-resend-api-key');
}

/**
 * Generate a cryptographically random 6-digit OTP.
 */
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send the OTP email via Resend (falls back to console log in dev mode).
 * Returns the OTP string in dev mode so the caller can include it in the response.
 */
async function sendOTPEmail(toEmail, name, otp) {
    if (!isResendConfigured()) {
        // DEV MODE — log OTP to console and skip email
        console.warn(`\n[OTP DEV MODE] ⚠️  RESEND_API_KEY not configured.`);
        console.warn(`[OTP DEV MODE] 📧  To: ${toEmail} | Name: ${name}`);
        console.warn(`[OTP DEV MODE] 🔑  OTP Code: ${otp}\n`);
        return { devMode: true };
    }

    const { error } = await resend.emails.send({
        from: config.resendFrom,
        to:   [toEmail],
        subject: 'Your INBEX verification code',
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
</head>
<body style="margin:0;padding:0;background:#040714;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#040714;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#0d1117 0%,#161b27 100%);border-radius:16px;border:1px solid rgba(99,102,241,0.2);overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6366f1,#a855f7);padding:32px;text-align:center;">
              <span style="font-size:28px;font-weight:800;color:white;letter-spacing:-0.5px;">INBEX</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 36px 32px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f1f5f9;">Verify your email</h1>
              <p style="margin:0 0 28px;font-size:15px;color:#94a3b8;line-height:1.6;">
                Hi ${name}, use the code below to complete your INBEX sign-up.
                It expires in <strong style="color:#c4b5fd;">10 minutes</strong>.
              </p>
              <!-- OTP Box -->
              <div style="background:rgba(99,102,241,0.1);border:2px solid rgba(99,102,241,0.3);border-radius:12px;padding:28px;text-align:center;margin-bottom:28px;">
                <span style="font-size:42px;font-weight:800;letter-spacing:16px;color:#a78bfa;font-variant-numeric:tabular-nums;">${otp}</span>
              </div>
              <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;">
                If you didn't request this, you can safely ignore this email. Someone may have mistyped their address.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 36px;border-top:1px solid rgba(255,255,255,0.06);">
              <p style="margin:0;font-size:12px;color:#475569;text-align:center;">
                © 2026 INBEX Technologies, Inc. &nbsp;·&nbsp; This is an automated message.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    });

    if (error) {
        console.error('[OTP] Resend error:', error);
        throw new Error('Failed to send verification email. Please try again.');
    }
    return { devMode: false };
}

/**
 * Send the password-reset OTP email via Resend (falls back to console log in dev mode).
 */
async function sendResetOTPEmail(toEmail, name, otp) {
    if (!isResendConfigured()) {
        console.warn(`\n[RESET OTP DEV MODE] ⚠️  RESEND_API_KEY not configured.`);
        console.warn(`[RESET OTP DEV MODE] 📧  To: ${toEmail} | Name: ${name}`);
        console.warn(`[RESET OTP DEV MODE] 🔑  Reset OTP Code: ${otp}\n`);
        return { devMode: true };
    }

    const { error } = await resend.emails.send({
        from:    config.resendFrom,
        to:      [toEmail],
        subject: 'Reset your INBEX password',
        html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#040714;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#040714;padding:40px 0;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#0d1117,#161b27);border-radius:16px;border:1px solid rgba(99,102,241,0.2);overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#6366f1,#a855f7);padding:32px;text-align:center;">
          <span style="font-size:28px;font-weight:800;color:white;">INBEX</span>
        </td></tr>
        <tr><td style="padding:40px 36px 32px;">
          <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f1f5f9;">Reset your password</h1>
          <p style="margin:0 0 28px;font-size:15px;color:#94a3b8;line-height:1.6;">
            Hi ${name}, use the code below to reset your INBEX password.
            It expires in <strong style="color:#c4b5fd;">10 minutes</strong>.
          </p>
          <div style="background:rgba(99,102,241,0.1);border:2px solid rgba(99,102,241,0.3);border-radius:12px;padding:28px;text-align:center;margin-bottom:28px;">
            <span style="font-size:42px;font-weight:800;letter-spacing:16px;color:#a78bfa;font-variant-numeric:tabular-nums;">${otp}</span>
          </div>
          <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </td></tr>
        <tr><td style="padding:20px 36px;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="margin:0;font-size:12px;color:#475569;text-align:center;">© 2026 INBEX Technologies, Inc.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
    });

    if (error) {
        console.error('[Reset OTP] Resend error:', error);
        throw new Error('Failed to send reset email.');
    }
    return { devMode: false };
}

// ── POST /auth/send-otp — Step 1 ──
router.post('/auth/send-otp', async (req, res) => {
    const { name, email, password } = req.body;

    // Validation
    if (!name || name.trim().length < 2) {
        return res.status(422).json({ detail: 'Name must be at least 2 characters.' });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(422).json({ detail: 'A valid email is required.' });
    }
    if (!password || password.length < 8) {
        return res.status(422).json({ detail: 'Password must be at least 8 characters.' });
    }

    // Check uniqueness
    const existing = get('SELECT id FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    if (existing) {
        return res.status(409).json({ detail: 'An account with this email already exists.' });
    }

    // Generate & store OTP
    const otp = generateOTP();
    const normalizedEmail = email.trim().toLowerCase();

    otpStore.set(normalizedEmail, {
        otp,
        name: name.trim(),
        password,
        expiresAt: Date.now() + OTP_TTL_MS,
    });

    console.log(`[OTP] Generated for ${normalizedEmail}: ${otp}`);

    try {
        const result = await sendOTPEmail(normalizedEmail, name.trim(), otp);
        const response = { message: 'OTP sent. Check your email.' };
        // In dev mode, include the OTP in the response so you can test without Resend
        if (result.devMode) {
            response.devMode  = true;
            response.devOtp   = otp;
            response.message  = 'DEV MODE: Resend not configured. OTP is included in this response and logged to server console.';
        }
        return res.json(response);
    } catch (err) {
        otpStore.delete(normalizedEmail);
        return res.status(500).json({ detail: err.message });
    }
});

// ── POST /auth/verify-otp — Step 2 ──
router.post('/auth/verify-otp', (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(422).json({ detail: 'Email and OTP are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const record = otpStore.get(normalizedEmail);

    if (!record) {
        return res.status(400).json({ detail: 'No OTP found for this email. Please request a new one.' });
    }

    if (Date.now() > record.expiresAt) {
        otpStore.delete(normalizedEmail);
        return res.status(400).json({ detail: 'OTP has expired. Please request a new one.' });
    }

    if (record.otp !== otp.trim()) {
        return res.status(400).json({ detail: 'Invalid OTP. Please try again.' });
    }

    // OTP valid — consume it
    otpStore.delete(normalizedEmail);

    // Create user
    const id = uuidv4();
    const hashedPassword = bcrypt.hashSync(record.password, 10);
    const now = new Date().toISOString();

    run(
        'INSERT INTO users (id, name, email, hashed_password, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
        [id, record.name, normalizedEmail, hashedPassword, now]
    );

    // Issue JWT
    const token = jwt.sign(
        { sub: id, email: normalizedEmail },
        config.secretKey,
        { algorithm: config.algorithm, expiresIn: `${config.accessTokenExpireMinutes}m` }
    );

    const user = get('SELECT * FROM users WHERE id = ?', [id]);
    console.log(`[Auth] ✅ New user verified and created: ${normalizedEmail}`);

    return res.status(201).json({
        access_token: token,
        token_type: 'bearer',
        user: formatUser(user),
    });
});

// ── POST /auth/login ──
router.post('/auth/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(422).json({ detail: 'Email and password are required.' });
    }

    const user = get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);

    if (!user || !bcrypt.compareSync(password, user.hashed_password)) {
        return res.status(401).json({
            detail: 'Incorrect email or password.',
        });
    }

    if (!user.is_active) {
        return res.status(403).json({ detail: 'Account is disabled. Please contact support.' });
    }

    const token = jwt.sign(
        { sub: user.id, email: user.email },
        config.secretKey,
        { algorithm: config.algorithm, expiresIn: `${config.accessTokenExpireMinutes}m` }
    );

    return res.json({
        access_token: token,
        token_type: 'bearer',
        user: formatUser(user),
    });
});

// ── GET /auth/me ──
router.get('/auth/me', requireAuth, (req, res) => {
    return res.json(formatUser(req.user));
});

// ── GET /auth/google — Initiate Google Sign-In ──
router.get('/auth/google', (req, res) => {
    const oauth2Client = new google.auth.OAuth2(
        config.googleClientId,
        config.googleClientSecret,
        config.googleRedirectUri.replace('/auth/google/callback', '') + '/auth/google/callback'
    );

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['openid', 'email', 'profile'],
        prompt: 'select_account',
    });

    return res.redirect(authUrl);
});

// ── GET /auth/google/callback — Handle Google OAuth callback ──
router.get('/auth/google/callback', async (req, res, next) => {
    const { code, state } = req.query;
    if (!code) {
        return res.status(400).send('Missing authorization code.');
    }
    // Gmail connect flow passes userId as state — let gmail.js handle it
    if (state) {
        return next('router');
    }

    try {
        const oauth2Client = new google.auth.OAuth2(
            config.googleClientId,
            config.googleClientSecret,
            config.googleRedirectUri.replace('/auth/google/callback', '') + '/auth/google/callback'
        );

        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Get user profile from Google
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const { data: profile } = await oauth2.userinfo.get();

        const email = profile.email.toLowerCase();
        const name = profile.name || email.split('@')[0];

        // Find or create user
        let user = get('SELECT * FROM users WHERE email = ?', [email]);

        if (!user) {
            const id = uuidv4();
            const now = new Date().toISOString();
            const randomPw = bcrypt.hashSync(uuidv4(), 10);
            run(
                'INSERT INTO users (id, name, email, hashed_password, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
                [id, name, email, randomPw, now]
            );
            user = get('SELECT * FROM users WHERE id = ?', [id]);
            console.log(`[Auth] ✅ New Google user created: ${email}`);
        } else {
            console.log(`[Auth] ✅ Google user signed in: ${email}`);
        }

        // Issue JWT
        const token = jwt.sign(
            { sub: user.id, email: user.email },
            config.secretKey,
            { algorithm: config.algorithm, expiresIn: `${config.accessTokenExpireMinutes}m` }
        );

        const userData = formatUser(user);

        return res.send(`
<!DOCTYPE html>
<html><head><title>Signing in...</title></head>
<body style="background:#040714;color:white;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
<div style="text-align:center;">
    <h2>✅ Signed in as ${name}</h2>
    <p style="opacity:0.6;">Redirecting to dashboard...</p>
</div>
<script>
    localStorage.setItem('inbex-token', ${JSON.stringify(token)});
    localStorage.setItem('inbex-user', ${JSON.stringify(JSON.stringify(userData))});
    localStorage.setItem('inbexAuth', 'true');
    setTimeout(function() { window.location.href = '/dashboard.html'; }, 1000);
</script>
</body></html>
        `);
    } catch (err) {
        console.error('[Auth] Google callback error:', err);
        return res.redirect(`/index.html?error=${encodeURIComponent('Google sign-in failed: ' + err.message)}`);
    }
});

// ── Helper ──
function formatUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        is_active: !!user.is_active,
        created_at: user.created_at,
    };
}

/* ══════════════════════════════════════════
   FORGOT PASSWORD — 3-step OTP flow
   POST /auth/forgot-password     → send OTP to email
   POST /auth/verify-reset-otp    → verify OTP, return reset token
   POST /auth/reset-password      → use reset token to set new password
══════════════════════════════════════════ */

// In-memory store: email → { otp, expiresAt }
const resetOtpStore = new Map();
// In-memory store: resetToken → { email, expiresAt }
const resetTokenStore = new Map();
const RESET_OTP_TTL_MS   = 10 * 60 * 1000; // 10 min
const RESET_TOKEN_TTL_MS =  5 * 60 * 1000; // 5 min

// Clean up expired entries every 5 min
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of resetOtpStore.entries())   if (now > v.expiresAt) resetOtpStore.delete(k);
    for (const [k, v] of resetTokenStore.entries())  if (now > v.expiresAt) resetTokenStore.delete(k);
}, 5 * 60 * 1000);

// ── POST /auth/forgot-password ──
router.post('/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(422).json({ detail: 'A valid email is required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = get('SELECT id, name FROM users WHERE email = ?', [normalizedEmail]);

    // Always return success to prevent email enumeration
    if (!user) {
        return res.json({ message: 'If this email exists, a reset code has been sent.' });
    }

    const otp = generateOTP();
    resetOtpStore.set(normalizedEmail, { otp, expiresAt: Date.now() + RESET_OTP_TTL_MS });
    console.log(`[Reset] OTP for ${normalizedEmail}: ${otp}`);

    try {
        const result = await sendResetOTPEmail(normalizedEmail, user.name, otp);
        const response = { message: 'If this email exists, a reset code has been sent.' };
        if (result.devMode) {
            response.devMode = true;
            response.devOtp  = otp;
            response.message = 'DEV MODE: Resend not configured. OTP is included in this response and logged to server console.';
        }
        return res.json(response);
    } catch (err) {
        resetOtpStore.delete(normalizedEmail);
        return res.status(500).json({ detail: 'Failed to send reset email. Please try again.' });
    }
});

// ── POST /auth/verify-reset-otp ──
router.post('/auth/verify-reset-otp', (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(422).json({ detail: 'Email and OTP are required.' });

    const normalizedEmail = email.trim().toLowerCase();
    const record = resetOtpStore.get(normalizedEmail);

    if (!record)                    return res.status(400).json({ detail: 'No reset code found. Please request a new one.' });
    if (Date.now() > record.expiresAt) { resetOtpStore.delete(normalizedEmail); return res.status(400).json({ detail: 'Code has expired. Please request a new one.' }); }
    if (record.otp !== otp.trim())  return res.status(400).json({ detail: 'Invalid code. Please try again.' });

    // Consume OTP and issue short-lived reset token
    resetOtpStore.delete(normalizedEmail);
    const resetToken = uuidv4();
    resetTokenStore.set(resetToken, { email: normalizedEmail, expiresAt: Date.now() + RESET_TOKEN_TTL_MS });

    return res.json({ reset_token: resetToken });
});

// ── POST /auth/reset-password ──
router.post('/auth/reset-password', (req, res) => {
    const { reset_token, new_password } = req.body;
    if (!reset_token || !new_password) return res.status(422).json({ detail: 'Reset token and new password are required.' });
    if (new_password.length < 8) return res.status(422).json({ detail: 'Password must be at least 8 characters.' });

    const record = resetTokenStore.get(reset_token);
    if (!record)                    return res.status(400).json({ detail: 'Invalid or expired reset token. Please start over.' });
    if (Date.now() > record.expiresAt) { resetTokenStore.delete(reset_token); return res.status(400).json({ detail: 'Reset token has expired. Please start over.' }); }

    resetTokenStore.delete(reset_token);

    const hashed = bcrypt.hashSync(new_password, 10);
    run('UPDATE users SET hashed_password = ? WHERE email = ?', [hashed, record.email]);

    console.log(`[Auth] ✅ Password reset for: ${record.email}`);
    return res.json({ message: 'Password reset successfully. You can now log in.' });
});

module.exports = router;
