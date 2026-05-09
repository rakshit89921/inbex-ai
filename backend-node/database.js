/**
 * INBEX — Database Engine (SQLite via sql.js)
 * Pure JavaScript SQLite — no native compilation needed.
 * Data persists to inbex.db on disk.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'inbex.db');

let db = null;

/**
 * Initialize the database. Must be called (and awaited) before any queries.
 */
async function initDatabase() {
    const SQL = await initSqlJs();

    // Load existing DB from disk if it exists
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // Enable foreign keys
    db.run('PRAGMA foreign_keys = ON;');

    return db;
}

/**
 * Save the in-memory database to disk.
 * Call this after any write operation.
 */
function saveDatabase() {
    if (!db) return;
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
}

/**
 * Create all tables if they don't exist.
 */
function createAllTables() {
    if (!db) throw new Error('Database not initialized. Call initDatabase() first.');

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            email           TEXT NOT NULL UNIQUE,
            hashed_password TEXT NOT NULL,
            is_active       INTEGER DEFAULT 1,
            created_at      TEXT DEFAULT (datetime('now'))
        )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);

    db.run(`
        CREATE TABLE IF NOT EXISTS email_logs (
            id                  TEXT PRIMARY KEY,
            user_id             TEXT NOT NULL,
            email_text          TEXT NOT NULL,
            predicted_category  TEXT NOT NULL,
            confidence          REAL NOT NULL,
            reply_sent          INTEGER DEFAULT 0,
            workflow_triggered  INTEGER DEFAULT 0,
            suggested_reply     TEXT,
            created_at          TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_email_logs_user_id ON email_logs(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_email_logs_category ON email_logs(predicted_category)`);

    db.run(`
        CREATE TABLE IF NOT EXISTS workflows (
            id                TEXT PRIMARY KEY,
            user_id           TEXT NOT NULL,
            name              TEXT NOT NULL,
            trigger_category  TEXT NOT NULL,
            action            TEXT NOT NULL,
            action_detail     TEXT,
            is_active         INTEGER DEFAULT 1,
            run_count         INTEGER DEFAULT 0,
            created_at        TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_workflows_user_id ON workflows(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_workflows_category ON workflows(trigger_category)`);

    db.run(`
        CREATE TABLE IF NOT EXISTS gmail_tokens (
            user_id         TEXT PRIMARY KEY,
            access_token    TEXT,
            refresh_token   TEXT,
            token_expiry    TEXT,
            gmail_email     TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS email_automations (
            id               TEXT PRIMARY KEY,
            user_id          TEXT NOT NULL,
            name             TEXT NOT NULL,
            recipient_email  TEXT NOT NULL,
            subject          TEXT NOT NULL,
            body             TEXT NOT NULL,
            send_time        TEXT NOT NULL,
            timezone         TEXT NOT NULL,
            is_active        INTEGER DEFAULT 1,
            run_count        INTEGER DEFAULT 0,
            last_run_at      TEXT,
            last_attempt_at  TEXT,
            last_error       TEXT,
            created_at       TEXT DEFAULT (datetime('now')),
            updated_at       TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_email_automations_user_id ON email_automations(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_email_automations_active ON email_automations(is_active)`);

    // ── Snoozed Emails ─────────────────────────────────────────────────────
    // Tracks emails the user has snoozed for a later reminder.
    // snooze_until is ISO8601 datetime; status: 'snoozed' | 'reminded' | 'dismissed'
    db.run(`
        CREATE TABLE IF NOT EXISTS snoozed_emails (
            id              TEXT PRIMARY KEY,
            user_id         TEXT NOT NULL,
            email_id        TEXT NOT NULL,
            email_subject   TEXT,
            email_from      TEXT,
            snooze_until    TEXT NOT NULL,
            note            TEXT,
            status          TEXT DEFAULT 'snoozed',
            created_at      TEXT DEFAULT (datetime('now')),
            updated_at      TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_snoozed_emails_user_id  ON snoozed_emails(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_snoozed_emails_until    ON snoozed_emails(snooze_until)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_snoozed_emails_status   ON snoozed_emails(status)`);

    // ── User Preferences ───────────────────────────────────────────────────
    // Generic key-value store per user for UI and AI preferences.
    // Examples: theme='dark', ai_tone='formal', notifications='true'
    db.run(`
        CREATE TABLE IF NOT EXISTS user_preferences (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL,
            pref_key    TEXT NOT NULL,
            pref_value  TEXT NOT NULL,
            updated_at  TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, pref_key)
        )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_user_prefs_user_id ON user_preferences(user_id)`);

    saveDatabase();
}

/**
 * Run a SQL statement that doesn't return rows (INSERT, UPDATE, DELETE).
 * @param {string} sql
 * @param {any[]} params
 */
function run(sql, params = []) {
    if (!db) throw new Error('Database not initialized.');
    db.run(sql, params);
    saveDatabase();
}

/**
 * Query a single row. Returns an object or undefined.
 * @param {string} sql
 * @param {any[]} params
 * @returns {object|undefined}
 */
function get(sql, params = []) {
    if (!db) throw new Error('Database not initialized.');
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
    }
    stmt.free();
    return undefined;
}

/**
 * Query all matching rows. Returns an array of objects.
 * @param {string} sql
 * @param {any[]} params
 * @returns {object[]}
 */
function all(sql, params = []) {
    if (!db) throw new Error('Database not initialized.');
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

/**
 * Get the database instance directly.
 */
function getDb() {
    return db;
}

module.exports = { initDatabase, createAllTables, run, get, all, getDb, saveDatabase };
