/**
 * INBEX — Reports Page Script
 * Handles: AI Insights generation, theme toggle
 */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
    // Theme init
    const saved = localStorage.getItem('inbex-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);

    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const cur  = document.documentElement.getAttribute('data-theme');
            const next = cur === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('inbex-theme', next);
        });
    }
});

/**
 * Load AI-generated insights from /ai/insights
 * Called by the "Generate Insights" button on reports.html
 */
async function loadAiInsights() {
    const btn  = document.getElementById('refresh-insights-btn');
    const list = document.getElementById('ai-insights-list');
    if (!btn || !list) return;

    // Loading state
    btn.disabled = true;
    btn.innerHTML = `<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.8s linear infinite;vertical-align:middle;"></span>&nbsp;Analyzing...`;

    // Skeleton cards
    list.innerHTML = [1, 2, 3].map(() => `
        <div class="insight-card" style="opacity:0.5;">
            <div class="insight-icon-wrap" style="background:var(--bg-input);"></div>
            <div class="insight-content" style="flex:1;">
                <div class="tone-skeleton" style="width:50%;height:14px;border-radius:6px;margin-bottom:8px;"></div>
                <div class="tone-skeleton" style="width:90%;height:11px;border-radius:6px;margin-bottom:4px;"></div>
                <div class="tone-skeleton" style="width:70%;height:11px;border-radius:6px;"></div>
            </div>
        </div>`).join('');

    try {
        // Gather current stats from the stat cards on this page
        const statVals = document.querySelectorAll('.stat-card .stat-value');
        const stats = {
            total_emails:    statVals[0]?.textContent?.trim() || 0,
            automation_rate: statVals[1]?.textContent?.trim() || '—',
            avg_response:    statVals[2]?.textContent?.trim() || '—',
            ai_confidence:   statVals[3]?.textContent?.trim() || '—',
            period:          'Last 30 Days',
        };

        const headers = window.Auth ? window.Auth.getHeaders() : { 'Content-Type': 'application/json' };

        const resp = await fetch('/ai/insights', {
            method:  'POST',
            headers: headers,
            body:    JSON.stringify({ stats }),
        });

        if (!resp.ok) throw new Error(`Server error ${resp.status}`);

        const data = await resp.json();
        const insights = data.insights || [];

        if (!insights.length) throw new Error('No insights were returned.');

        list.innerHTML = insights.map(ins => `
            <div class="insight-card">
                <div class="insight-icon-wrap">${ins.icon || '💡'}</div>
                <div class="insight-content">
                    <h4>${ins.title || 'Insight'}</h4>
                    <p>${ins.body || ''}</p>
                </div>
            </div>`).join('');

        if (window.Toast) Toast.success('AI insights generated successfully!', 'Reports ✨');

    } catch (err) {
        list.innerHTML = `
            <div style="padding:20px;text-align:center;color:#f87171;font-size:0.88rem;">
                ❌ ${err.message}<br/>
                <button class="btn btn-outline small" style="margin-top:12px;" onclick="loadAiInsights()">Retry</button>
            </div>`;
        if (window.Toast) Toast.error(err.message, 'Insights Failed');
        console.error('[AI Insights]', err);
    }

    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> Generate Insights`;
}

window.loadAiInsights = loadAiInsights;
