/**
 * INBEX — Settings Router
 * PUT    /settings/profile       — Update user profile
 * PUT    /settings/password      — Change password
 * DELETE /settings/account       — Permanently delete account
 * PUT    /settings/preference    — Upsert a user preference (theme, ai_tone, etc.)
 * GET    /settings/preferences   — Get all user preferences as key→value map
 * GET    /settings/preference/:key — Get a single preference value
 */
'use strict';

const { Router } = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { run, get, all } = require('../database');
const requireAuth = require('../middleware/auth');

const router = Router();

// Allowed preference keys (whitelist to prevent abuse)
const ALLOWED_PREFS = new Set([
    'theme',           // 'dark' | 'light'
    'ai_tone',         // 'formal' | 'friendly' | 'brief'
    'notifications',   // 'true' | 'false'
    'compact_view',    // 'true' | 'false'
    'language',        // 'en' | etc.
    'dashboard_layout',// 'default' | 'compact'
]);

router.put('/settings/profile', requireAuth, (req, res) => {
    const { name } = req.body;
    if (!name || name.trim().length < 2) return res.status(422).json({ detail: 'Name must be at least 2 characters.' });
    run('UPDATE users SET name = ? WHERE id = ?', [name.trim(), req.user.id]);
    const updated = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    return res.json({ id: updated.id, name: updated.name, email: updated.email, is_active: !!updated.is_active, created_at: updated.created_at });
});

router.put('/settings/password', requireAuth, (req, res) => {
    const { current_password, new_password } = req.body;
    if (!current_password || current_password.length < 8) return res.status(422).json({ detail: 'Current password is required (min 8 chars).' });
    if (!new_password || new_password.length < 8) return res.status(422).json({ detail: 'New password must be at least 8 characters.' });
    if (!bcrypt.compareSync(current_password, req.user.hashed_password)) return res.status(400).json({ detail: 'Current password is incorrect.' });
    run('UPDATE users SET hashed_password = ? WHERE id = ?', [bcrypt.hashSync(new_password, 10), req.user.id]);
    return res.status(204).send();
});

// ── DELETE /settings/account ──
router.delete('/settings/account', requireAuth, (req, res) => {
    const { password } = req.body;

    if (!password) {
        return res.status(422).json({ detail: 'Password confirmation is required.' });
    }

    // Re-verify password before deletion
    if (!bcrypt.compareSync(password, req.user.hashed_password)) {
        return res.status(401).json({ detail: 'Incorrect password. Account not deleted.' });
    }

    // Delete user — cascades to all related data
    run('DELETE FROM users WHERE id = ?', [req.user.id]);

    console.log(`[Settings] 🗑️  Account permanently deleted: ${req.user.email}`);
    return res.status(200).json({ message: 'Account permanently deleted.' });
});

// ── PUT /settings/preference — upsert a single key-value preference ──
router.put('/settings/preference', requireAuth, (req, res) => {
    const { key, value } = req.body;

    if (!key || typeof key !== 'string') {
        return res.status(422).json({ detail: 'Preference key is required.' });
    }
    if (value === undefined || value === null) {
        return res.status(422).json({ detail: 'Preference value is required.' });
    }
    if (!ALLOWED_PREFS.has(key)) {
        return res.status(422).json({ detail: `Unknown preference key: "${key}". Allowed: ${[...ALLOWED_PREFS].join(', ')}.` });
    }

    const strValue = String(value);

    // Upsert: update if exists, insert if new
    const existing = get(
        'SELECT id FROM user_preferences WHERE user_id = ? AND pref_key = ?',
        [req.user.id, key]
    );

    if (existing) {
        run(
            'UPDATE user_preferences SET pref_value = ?, updated_at = datetime(\'now\') WHERE user_id = ? AND pref_key = ?',
            [strValue, req.user.id, key]
        );
    } else {
        run(
            'INSERT INTO user_preferences (id, user_id, pref_key, pref_value) VALUES (?, ?, ?, ?)',
            [uuidv4(), req.user.id, key, strValue]
        );
    }

    console.log(`[Settings] ✏️  Pref updated: user=${req.user.email} key=${key} value=${strValue}`);
    return res.json({ key, value: strValue });
});

// ── GET /settings/preferences — fetch all preferences as { key: value } map ──
router.get('/settings/preferences', requireAuth, (req, res) => {
    const rows = all(
        'SELECT pref_key, pref_value FROM user_preferences WHERE user_id = ?',
        [req.user.id]
    );

    // Convert row array to flat object: { theme: 'dark', ai_tone: 'formal', ... }
    const prefs = {};
    for (const row of rows) {
        prefs[row.pref_key] = row.pref_value;
    }

    return res.json(prefs);
});

// ── GET /settings/preference/:key — fetch a single preference value ──
router.get('/settings/preference/:key', requireAuth, (req, res) => {
    const { key } = req.params;

    if (!ALLOWED_PREFS.has(key)) {
        return res.status(422).json({ detail: `Unknown preference key: "${key}".` });
    }

    const row = get(
        'SELECT pref_value FROM user_preferences WHERE user_id = ? AND pref_key = ?',
        [req.user.id, key]
    );

    if (!row) {
        return res.status(404).json({ detail: `Preference "${key}" not set.` });
    }

    return res.json({ key, value: row.pref_value });
});

module.exports = router;
