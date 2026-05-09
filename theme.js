/**
 * INBEX — Global Theme Engine  v1.0
 * ─────────────────────────────────────────────────────────────────
 * Provides persistent dark/light mode across all pages.
 *
 * Usage (add to every HTML page before closing </body>):
 *   <script src="theme.js"></script>
 *
 * The script:
 *  1. Reads saved theme from localStorage ('inbex-theme': 'dark'|'light')
 *  2. Falls back to OS preference via prefers-color-scheme
 *  3. Applies data-theme attribute to <html> immediately (no flash)
 *  4. Wires up any element with id="theme-toggle" as a click toggle
 *  5. Syncs theme preference to the backend /settings/preference endpoint
 *     (if the user is logged in via window.Auth)
 *  6. Dispatches a 'themechange' CustomEvent on document when theme changes
 * ─────────────────────────────────────────────────────────────────
 */
'use strict';

(function InbexThemeEngine() {

    /* ── Constants ──────────────────────────────────────────── */
    const STORAGE_KEY  = 'inbex-theme';
    const THEMES       = ['dark', 'light'];
    const DEFAULT      = 'dark';
    const API_PREF_URL = '/settings/preference';

    /* ── Read saved / OS preference ─────────────────────────── */
    function getSystemTheme() {
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    function getSavedTheme() {
        const saved = localStorage.getItem(STORAGE_KEY);
        return THEMES.includes(saved) ? saved : null;
    }

    function resolveTheme() {
        return getSavedTheme() || getSystemTheme() || DEFAULT;
    }

    /* ── Apply theme to <html> ───────────────────────────────── */
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        updateToggleButton(theme);
        dispatchChangeEvent(theme);
    }

    /* ── Persist to localStorage + backend ───────────────────── */
    function persistTheme(theme) {
        localStorage.setItem(STORAGE_KEY, theme);

        // Sync to backend if logged in (non-blocking)
        try {
            if (window.Auth && window.Auth.isAuthenticated && window.Auth.isAuthenticated()) {
                fetch(API_PREF_URL, {
                    method:  'PUT',
                    headers: window.Auth.getHeaders(),
                    body:    JSON.stringify({ key: 'theme', value: theme }),
                }).catch(() => { /* silent — theme works offline */ });
            }
        } catch (_) { /* silent */ }
    }

    /* ── Toggle ──────────────────────────────────────────────── */
    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') || DEFAULT;
        const next    = current === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        persistTheme(next);
    }

    /* ── Update toggle button icon/label ─────────────────────── */
    function updateToggleButton(theme) {
        const btn = document.getElementById('theme-toggle');
        if (!btn) return;

        const isDark = theme === 'dark';

        // SVG icons injected into the button
        const moonSVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
        const sunSVG  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;

        // Only replace content if it looks like an icon-only button (no significant text)
        const hasText = btn.dataset.themeLabel === 'true';
        if (!hasText) {
            btn.innerHTML = isDark ? moonSVG : sunSVG;
        }

        btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
        btn.setAttribute('title',      isDark ? 'Switch to light mode' : 'Switch to dark mode');
        btn.setAttribute('data-theme-current', theme);
    }

    /* ── Dispatch event so other scripts can react ───────────── */
    function dispatchChangeEvent(theme) {
        document.dispatchEvent(new CustomEvent('themechange', {
            detail: { theme },
            bubbles: true,
        }));
    }

    /* ── Watch OS preference change in real-time ─────────────── */
    function watchSystemTheme() {
        const mq = window.matchMedia('(prefers-color-scheme: light)');
        mq.addEventListener('change', (e) => {
            // Only react if user hasn't explicitly set a preference
            if (!getSavedTheme()) {
                const next = e.matches ? 'light' : 'dark';
                applyTheme(next);
            }
        });
    }

    /* ── Wire up toggle button (may not exist yet in DOM) ────── */
    function wireToggleButton() {
        const btn = document.getElementById('theme-toggle');
        if (btn && !btn.dataset.themeWired) {
            btn.addEventListener('click', toggleTheme);
            btn.dataset.themeWired = 'true';
            updateToggleButton(resolveTheme());
        }
    }

    /* ── INIT — runs immediately to prevent flash ────────────── */
    function init() {
        const theme = resolveTheme();

        // Apply before paint to avoid flash of wrong theme
        document.documentElement.setAttribute('data-theme', theme);

        // Wire up once DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                wireToggleButton();
                watchSystemTheme();
            });
        } else {
            wireToggleButton();
            watchSystemTheme();
        }
    }

    /* ── Public API ──────────────────────────────────────────── */
    window.InbexTheme = {
        /** Get the current active theme ('dark' or 'light') */
        get: () => document.documentElement.getAttribute('data-theme') || DEFAULT,

        /** Set theme programmatically */
        set: (theme) => {
            if (!THEMES.includes(theme)) return;
            applyTheme(theme);
            persistTheme(theme);
        },

        /** Toggle between dark and light */
        toggle: toggleTheme,

        /** Returns true if current theme is dark */
        isDark: () => (document.documentElement.getAttribute('data-theme') || DEFAULT) === 'dark',
    };

    // Run
    init();

})();
