'use strict';

/**
 * OPA AI ASSISTANT ROUTES (Phase 2-4: chat, knowledge grounding, context)
 *
 * All routes require an authenticated session. The feature fails CLOSED and
 * degrades GRACEFULLY: when the provider is disabled or unreachable, chat
 * answers with a friendly "unavailable" message (HTTP 200) instead of an
 * error — the Portal itself keeps working and no configuration detail leaks.
 *
 * Trust boundaries:
 *   - role comes from req.user (session), never from the client body
 *   - page context is validated server-side (module must exist in registry;
 *     availableActions and unknown fields are dropped)
 *   - model output is untrusted: parsed defensively, answer length-capped,
 *     actions filtered against the OPA_NAV_ALLOWLIST
 *   - conversations are user-owned; anyone else's id answers 404
 *
 * Privacy: audit records carry counts and the module only — never message
 * content. No client or clinical data is ever sent to the model beyond what
 * the user themselves types (and the prompt instructs the model not to
 * repeat identifying details).
 */

const express = require('express');
const router = express.Router();

const db = require('./database');
const { pool } = require('./database');
const { requireAuth } = require('./permissions');
const provider = require('./opa-provider');
const { searchOpaKnowledge, validateContext } = require('./opa-knowledge');
const { buildSystemPrompt, OPA_NAV_ALLOWLIST } = require('./opa-prompt');
const log = require('./logger').createLogger('opa');

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const orgOf = (req) => req.user?.organisation_id || null;

const UNAVAILABLE_DISABLED = "Opa's AI service isn't available right now. You can still use the Portal normally.";
const UNAVAILABLE_ERROR = "I couldn't reach my knowledge service just now. Please try again in a moment.";

const MAX_MESSAGE_CHARS = 2000;
const MAX_ANSWER_CHARS = 6000;
const MAX_FALLBACK_CHARS = 4000;
const MAX_ACTIONS = 2;
const MAX_ACTION_LABEL = 40;
const HISTORY_TURNS = 12;

// ── Gate ─────────────────────────────────────────────────────────────────────

router.use('/api/opa', requireAuth);

// Async-handler guard (Express 4: an unhandled rejection would hang the request).
const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('opa route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

// ── Per-user chat rate limit — 20 requests per 5 minutes ─────────────────────
// Mirrors the in-memory pattern in auth.js (Map + periodic prune; resets on
// restart, which is acceptable at this deployment size).

const OPA_CHAT_WINDOW_MS = 5 * 60 * 1000;
const OPA_CHAT_MAX = 20;
const _chatAttempts = new Map(); // userId → { count, resetAt }

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _chatAttempts) {
    if (entry.resetAt <= now) _chatAttempts.delete(key);
  }
}, 10 * 60 * 1000).unref();

function chatRateLimit(req, res, next) {
  const key = req.user?.id || 'anonymous';
  const now = Date.now();
  let entry = _chatAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + OPA_CHAT_WINDOW_MS };
    _chatAttempts.set(key, entry);
  }
  entry.count++;
  if (entry.count > OPA_CHAT_MAX) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: 'rate_limited',
      answer: 'Please wait a moment before sending more messages.',
    });
  }
  next();
}

/** Test helper: clear the rate-limit window between tests. */
function _resetOpaRateLimit() { _chatAttempts.clear(); }

// ── Model-output handling (untrusted) ────────────────────────────────────────

/** Strip ```json fences the model may wrap its JSON in, then parse. */
function parseModelText(raw) {
  const text = String(raw || '').trim();
  let candidate = text;
  const fence = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) candidate = fence[1].trim();
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object' && typeof parsed.answer === 'string') {
      return { answer: parsed.answer, actions: parsed.actions, confidence: parsed.confidence };
    }
  } catch (_) { /* fall through to plain-text fallback */ }
  return { answer: text.slice(0, MAX_FALLBACK_CHARS), actions: [] };
}

/** Filter model-proposed actions against the navigation allowlist. */
function sanitiseActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((a) => a && typeof a === 'object' && a.type === 'NAVIGATE'
      && typeof a.target === 'string' && OPA_NAV_ALLOWLIST[a.target])
    .slice(0, MAX_ACTIONS)
    .map((a) => ({
      type: 'NAVIGATE',
      target: a.target,
      label: String(a.label || OPA_NAV_ALLOWLIST[a.target].label).slice(0, MAX_ACTION_LABEL),
    }));
}

// ── POST /api/opa/chat ───────────────────────────────────────────────────────

router.post('/api/opa/chat', chatRateLimit, safe(async (req, res) => {
  // Graceful degrade before anything else — no config details leak.
  if (!provider.isEnabled()) {
    return res.json({ status: 'unavailable', answer: UNAVAILABLE_DISABLED });
  }

  const body = req.body || {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message || message.length > MAX_MESSAGE_CHARS) {
    return res.status(400).json({
      error: 'invalid_message',
      answer: `Please send a message between 1 and ${MAX_MESSAGE_CHARS} characters.`,
    });
  }

  // Conversation ownership — someone else's id is indistinguishable from absent.
  let conversation = null;
  if (body.conversationId !== undefined && body.conversationId !== null) {
    if (!isUuid(body.conversationId)) return res.status(404).json({ error: 'Conversation not found' });
    const { rows } = await pool.query(
      'SELECT * FROM opa_conversations WHERE id = $1 AND user_id = $2',
      [body.conversationId, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Conversation not found' });
    conversation = rows[0];
  }

  // Role from the session, never the client. Context validated server-side.
  const ctx = await validateContext(pool, body.context);
  const knowledge = await searchOpaKnowledge(pool, {
    query: message,
    route: ctx.route,
    module: ctx.module,
    role: req.user.role,
    limit: 6,
  });

  // Conversation history (oldest → newest) for continuity.
  let history = [];
  if (conversation) {
    const { rows } = await pool.query(
      `SELECT role, content FROM opa_messages
        WHERE conversation_id = $1 ORDER BY id DESC LIMIT ${HISTORY_TURNS}`,
      [conversation.id]);
    history = rows.reverse().map((r) => ({ role: r.role, content: r.content }));
  }

  const system = buildSystemPrompt({ user: req.user, context: ctx, knowledge });

  let modelText;
  try {
    const result = await provider.generateOpaResponse({
      system,
      messages: [...history, { role: 'user', content: message }],
    });
    modelText = result.text;
  } catch (err) {
    // Sanitised provider failure → graceful, friendly, HTTP 200.
    return res.json({ status: 'unavailable', answer: UNAVAILABLE_ERROR });
  }

  const parsed = parseModelText(modelText);
  const answer = String(parsed.answer || '').slice(0, MAX_ANSWER_CHARS);
  const actions = sanitiseActions(parsed.actions);
  const sources = knowledge.map((k) => ({ type: 'application', id: k.id, title: k.feature }));

  // Persist the exchange (create the thread on first message).
  if (!conversation) {
    const { rows } = await pool.query(
      `INSERT INTO opa_conversations (user_id, organisation_id, title)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.user.id, orgOf(req), message.slice(0, 60)]);
    conversation = rows[0];
  } else {
    await pool.query('UPDATE opa_conversations SET updated_at = NOW() WHERE id = $1', [conversation.id]);
  }
  await pool.query(
    `INSERT INTO opa_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
    [conversation.id, message]);
  await pool.query(
    `INSERT INTO opa_messages (conversation_id, role, content, sources, actions)
     VALUES ($1, 'assistant', $2, $3, $4)`,
    [conversation.id, answer, JSON.stringify(sources), JSON.stringify(actions)]);

  // Audit: counts and module only — NEVER message content.
  await db.logAuditEvent({
    actorUserId: req.user.id,
    action: 'opa.chat',
    targetType: 'opa_conversation',
    targetId: conversation.id,
    metadata: { module: ctx.module, knowledgeCount: knowledge.length, actionCount: actions.length },
    ipAddress: req.ip,
    organisationId: orgOf(req),
  }).catch(() => {});

  res.json({
    conversationId: conversation.id,
    answer,
    actions,
    sources,
    status: knowledge.length ? 'grounded' : 'limited',
  });
}));

// ── Conversation continuity ──────────────────────────────────────────────────

router.get('/api/opa/conversations', safe(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, updated_at FROM opa_conversations
      WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 10`,
    [req.user.id]);
  res.json({ conversations: rows });
}));

router.get('/api/opa/conversations/:id', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Conversation not found' });
  const { rows } = await pool.query(
    'SELECT id, title, updated_at FROM opa_conversations WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Conversation not found' });
  const conversation = rows[0];
  const { rows: messages } = await pool.query(
    `SELECT id, role, content, sources, actions, created_at
       FROM opa_messages WHERE conversation_id = $1 ORDER BY id`,
    [conversation.id]);
  res.json({ conversation, messages });
}));

// ── Config + suggestions ─────────────────────────────────────────────────────

router.get('/api/opa/config', safe(async (req, res) => {
  res.json({ enabled: provider.isEnabled() });
}));

// Suggestion chips per module. `roles` limits a chip to those roles; chips
// without `roles` are for everyone. Kept as config here (single source, not
// scattered hard-coding); the frontend has a local fallback copy.
const OPA_SUGGESTIONS = {
  calendar: [
    { text: 'How do I schedule an appointment?' },
    { text: 'How does the Master Scheduler work?', roles: ['owner', 'admin'] },
    { text: 'How do Outlook calendars sync?' },
    { text: "Why isn't an appointment showing?" },
  ],
  resources: [
    { text: 'Where are the Opal policies?' },
    { text: 'How do learning paths work?' },
    { text: 'How do I record CPD from a resource?' },
    { text: 'How do I submit a resource for review?' },
  ],
  book: [
    { text: 'How do I create an appointment?' },
    { text: 'What do the booking types mean?' },
  ],
  profile: [
    { text: 'How do I connect Outlook?' },
    { text: 'Where do I upload my documents?' },
    { text: 'How do I request leave?' },
  ],
  accounting: [
    { text: 'Explain this dashboard', roles: ['owner'] },
    { text: 'How are invoice candidates created?', roles: ['owner'] },
    { text: 'How do I check the Xero connection?', roles: ['owner'] },
  ],
  settings: [
    { text: 'How do I change my working hours?' },
    { text: 'How do I connect Outlook?' },
    { text: 'How do I invite a therapist?', roles: ['owner', 'admin'] },
  ],
  default: [
    { text: 'How does this page work?' },
    { text: 'Show me around Opal Portal' },
    { text: 'Where are our policies?' },
  ],
};

router.get('/api/opa/suggestions', safe(async (req, res) => {
  const module = String(req.query.module || '').slice(0, 60);
  const chips = OPA_SUGGESTIONS[module] || OPA_SUGGESTIONS.default;
  const role = req.user.role;
  res.json({
    suggestions: chips
      .filter((c) => !c.roles || c.roles.includes(role))
      .map((c) => c.text),
  });
}));

module.exports = router;
module.exports._resetOpaRateLimit = _resetOpaRateLimit;
