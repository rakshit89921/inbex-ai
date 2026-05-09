/**
 * INBEX — AI Router Service
 * Unified gateway to OpenRouter.ai — one API key, multiple best-in-class models.
 *
 * Models used:
 *   - Google Gemma 3 27B   → summarization (fast & cheap)
 *   - NVIDIA Nemotron 49B  → smart replies & priority scoring (conversational)
 *   - OpenAI GPT-4o        → email compose & drafting (highest quality)
 *   - Qwen3 Coder 480B     → inbox chat & classification fallback (deep reasoning)
 */
'use strict';

const config = require('../config');

const OR_URL  = config.openRouterBaseUrl + '/chat/completions';
const OR_KEY  = config.openRouterApiKey;
const SITE_URL  = config.openRouterSiteUrl;
const SITE_NAME = config.openRouterSiteName;

// ─────────────────────────────────────────────
//  Core fetch helper
// ─────────────────────────────────────────────
async function callOpenRouter(model, messages, options = {}) {
    if (!OR_KEY || OR_KEY.includes('your-key-here')) {
        console.warn('\n[AI DEV MODE] ⚠️  OPENROUTER_API_KEY not configured. Returning fallback response.');
        return 'Dev Mode: AI features require an OpenRouter API key in .env';
    }

    const body = {
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens:  options.max_tokens  ?? 1024,
        top_p:       options.top_p       ?? 1,
        stream:      false,
    };

    const res = await fetch(OR_URL, {
        method: 'POST',
        headers: {
            'Authorization':  `Bearer ${OR_KEY}`,
            'Content-Type':   'application/json',
            'HTTP-Referer':   SITE_URL,
            'X-Title':        SITE_NAME,
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`OpenRouter error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenRouter returned an empty response.');

    return content.trim();
}

// ─────────────────────────────────────────────
//  1. Summarize — Google Gemma 3 27B (fast)
// ─────────────────────────────────────────────
async function summarize(emailText) {
    const messages = [
        {
            role: 'system',
            content: `You are an email summarization expert. Create a concise, plain-text flashcard-style summary.
Rules:
- Maximum 5 bullet points
- Each bullet starts with an emoji that fits the point
- No markdown headers, no HTML, no code blocks
- Focus on: who sent it, what they want, any deadlines or action items
- Keep each bullet under 20 words`,
        },
        {
            role: 'user',
            content: `Summarize this email:\n\n${emailText.slice(0, 3000)}`,
        },
    ];

    return callOpenRouter(config.models.summarize, messages, {
        temperature: 0.3,
        max_tokens: 400,
    });
}

// ─────────────────────────────────────────────
//  2. Smart Reply — NVIDIA Nemotron (conversational)
//     Returns 3 tone variants: Formal, Friendly, Brief
// ─────────────────────────────────────────────
async function smartReply(emailText, senderName = '') {
    const messages = [
        {
            role: 'system',
            content: `You are an email reply generator. Given an email, you must produce exactly 3 reply variants in this JSON format:

{
  "formal": "Full formal reply text here...",
  "friendly": "Casual and warm reply text here...",
  "brief": "Short 1-2 sentence reply here."
}

Rules:
- Respond ONLY with valid JSON, no extra text
- formal: Professional tone, full sentences, proper sign-off
- friendly: Warm, approachable, uses first names if known
- brief: Get straight to the point, max 2 sentences
- All replies should be complete and ready to send
- If a sender name is provided, address them appropriately`,
        },
        {
            role: 'user',
            content: `Sender: ${senderName || 'Unknown'}\n\nEmail:\n${emailText.slice(0, 2500)}`,
        },
    ];

    const raw = await callOpenRouter(config.models.smartReply, messages, {
        temperature: 0.75,
        max_tokens: 1000,
    });

    // Extract JSON safely
    try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found');
        return JSON.parse(jsonMatch[0]);
    } catch {
        // Fallback: return raw text as brief
        return {
            formal:   raw,
            friendly: raw,
            brief:    raw.split('\n')[0] || raw.slice(0, 150),
        };
    }
}

// ─────────────────────────────────────────────
//  3. Priority Score — NVIDIA Nemotron
//     Returns { score: 0-100, reason: string, level: 'high'|'medium'|'low' }
// ─────────────────────────────────────────────
async function priorityScore(emailText, sender = '', subject = '') {
    const messages = [
        {
            role: 'system',
            content: `You are an email priority analyzer. Analyze the email and return a JSON object:

{
  "score": <integer 0-100>,
  "level": "<high|medium|low>",
  "reason": "<one sentence explaining the priority>"
}

Scoring guide:
- 80-100 (high): Deadlines today/tomorrow, urgent requests, financial matters, legal, from manager/CEO
- 40-79 (medium): Meetings, project updates, replies needed within a week
- 0-39 (low): Newsletters, FYI emails, no action required, spam-adjacent

Respond ONLY with valid JSON.`,
        },
        {
            role: 'user',
            content: `From: ${sender}\nSubject: ${subject}\n\nBody:\n${emailText.slice(0, 1500)}`,
        },
    ];

    const raw = await callOpenRouter(config.models.priorityScore, messages, {
        temperature: 0.2,
        max_tokens: 200,
    });

    try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found');
        const parsed = JSON.parse(jsonMatch[0]);
        return {
            score:  Math.max(0, Math.min(100, parseInt(parsed.score) || 30)),
            level:  ['high', 'medium', 'low'].includes(parsed.level) ? parsed.level : 'medium',
            reason: parsed.reason || 'Standard email',
        };
    } catch {
        return { score: 30, level: 'low', reason: 'Could not analyze priority.' };
    }
}

// ─────────────────────────────────────────────
//  4. Compose — OpenAI GPT-4o (highest quality drafting)
//     Returns { subject: string, body: string }
// ─────────────────────────────────────────────
async function compose(prompt, recipientName = '', recipientEmail = '') {
    const messages = [
        {
            role: 'system',
            content: `You are a professional email writer. Generate a complete, polished email based on the user's prompt.
Return ONLY this JSON format:
{
  "subject": "Email subject line here",
  "body": "Full email body here with proper greeting, content, and sign-off"
}

Rules:
- Subject line should be clear and specific
- Body should be professional, well-structured, and concise
- Include appropriate greeting (use recipient name if provided)
- Sign off as "Best regards,\\n[Your Name]"
- Respond ONLY with valid JSON`,
        },
        {
            role: 'user',
            content: `Recipient: ${recipientName || recipientEmail || 'the recipient'}\n\nWrite an email about: ${prompt}`,
        },
    ];

    const raw = await callOpenRouter(config.models.compose, messages, {
        temperature: 0.7,
        max_tokens: 800,
    });

    try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found');
        return JSON.parse(jsonMatch[0]);
    } catch {
        return {
            subject: 'Email',
            body: raw,
        };
    }
}

// ─────────────────────────────────────────────
//  5. Inbox Chat — Qwen3 Coder 480B (deep reasoning)
//     Natural language questions about emails
// ─────────────────────────────────────────────
async function inboxChat(userQuestion, emailContext = []) {
    // Build context from recent emails
    const contextStr = emailContext.slice(0, 10).map((e, i) =>
        `[Email ${i + 1}] From: ${e.from || 'Unknown'} | Category: ${e.category || '?'} | Subject: ${e.subject || '(no subject)'} | Date: ${e.date || '?'}`
    ).join('\n');

    const messages = [
        {
            role: 'system',
            content: `You are an intelligent email assistant for INBEX. You help users understand and manage their inbox.
You have access to a summary of the user's recent emails (provided below).

Inbox Context:
${contextStr || 'No emails loaded yet.'}

Rules:
- Answer the user's question based on their inbox context
- Be concise and direct
- If you can't answer from the context, say so honestly
- Format lists with bullet points for readability
- Keep responses under 200 words`,
        },
        {
            role: 'user',
            content: userQuestion,
        },
    ];

    return callOpenRouter(config.models.chat, messages, {
        temperature: 0.5,
        max_tokens: 500,
    });
}

// ─────────────────────────────────────────────
//  6. Generate Insights — Google Gemma 3 27B
//     Weekly pattern analysis from email stats
// ─────────────────────────────────────────────
async function generateInsights(stats = {}) {
    const statsStr = JSON.stringify(stats, null, 2);

    const messages = [
        {
            role: 'system',
            content: `You are an email analytics expert. Analyze the user's email statistics and generate 3 actionable insights.

Return ONLY this JSON format:
[
  { "icon": "📈", "title": "Insight Title", "body": "One or two sentence insight." },
  { "icon": "⏰", "title": "Insight Title", "body": "One or two sentence insight." },
  { "icon": "💡", "title": "Insight Title", "body": "One or two sentence insight." }
]

Focus on: patterns, peak times, category trends, automation opportunities, or time-saving suggestions.
Respond ONLY with valid JSON array.`,
        },
        {
            role: 'user',
            content: `Here are my email stats for this week:\n${statsStr}`,
        },
    ];

    const raw = await callOpenRouter(config.models.insights, messages, {
        temperature: 0.6,
        max_tokens: 600,
    });

    try {
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('No JSON array found');
        return JSON.parse(jsonMatch[0]);
    } catch {
        return [
            { icon: '📊', title: 'Analytics Ready', body: 'Your email data is being analyzed. Check back after more emails are processed.' },
            { icon: '⚡', title: 'Automation Active', body: 'Your automations are running and saving you time every day.' },
            { icon: '💡', title: 'Pro Tip', body: 'Use the Classify page to process emails faster with AI assistance.' },
        ];
    }
}

// ─────────────────────────────────────────────
//  7. AI Classifier Fallback — Qwen3 480B
//     Called when keyword confidence is < 0.4
// ─────────────────────────────────────────────
async function classifyWithAI(emailText, sender = '') {
    const messages = [
        {
            role: 'system',
            content: `You are an email classifier. Classify the email into exactly ONE of these categories:
HR, Work, Finance, Personal, Spam

Return ONLY this JSON:
{ "category": "<category>", "confidence": <0.0-1.0>, "reason": "<brief reason>" }

Rules:
- HR: leave requests, payroll, recruitment, employee policies
- Work: meetings, projects, deadlines, team collaboration
- Finance: invoices, payments, budgets, banking, expenses
- Personal: friends, family, social events, non-work matters
- Spam: promotional, marketing, unsolicited, scams`,
        },
        {
            role: 'user',
            content: `From: ${sender}\n\nEmail:\n${emailText.slice(0, 1500)}`,
        },
    ];

    const raw = await callOpenRouter(config.models.classify, messages, {
        temperature: 0.1,
        max_tokens: 150,
    });

    try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found');
        const parsed = JSON.parse(jsonMatch[0]);
        const validCats = ['HR', 'Work', 'Finance', 'Personal', 'Spam'];
        return {
            category:   validCats.includes(parsed.category) ? parsed.category : 'Work',
            confidence: parseFloat(parsed.confidence) || 0.5,
            reason:     parsed.reason || '',
        };
    } catch {
        return { category: 'Work', confidence: 0.3, reason: 'Fallback classification.' };
    }
}

// ─────────────────────────────────────────────
//  Health check: is OpenRouter configured?
// ─────────────────────────────────────────────
function isConfigured() {
    return !!config.openRouterApiKey;
}

module.exports = {
    summarize,
    smartReply,
    priorityScore,
    compose,
    inboxChat,
    generateInsights,
    classifyWithAI,
    isConfigured,
    callOpenRouter,
};
