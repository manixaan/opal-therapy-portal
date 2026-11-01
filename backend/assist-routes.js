'use strict';

/**
 * OPAL ASSIST — the practice-wide assistant's API.
 *
 *   GET    /api/assist/config                 is it on, for this person
 *   POST   /api/assist/check                  check-before-send: tokens in, list of what was hidden — NO model call
 *   POST   /api/assist/chat                   one reply (JSON)
 *   POST   /api/assist/chat/stream            one reply as server-sent events
 *   GET    /api/assist/clients                the caller's clients, for the side-panel picker
 *   GET    /api/assist/conversations          the caller's recent threads (?client=<ref>|general)
 *   GET    /api/assist/conversations/:id      one thread, tokenised turns
 *   DELETE /api/assist/conversations/:id      forget a thread now
 *
 * The one rule everything else serves: THE MODEL NEVER SEES A NAME OR A
 * CONTACT DETAIL. The browser runs /check, shows the person what will be
 * hidden, and sends the tokenised text; the chat routes re-run the guard
 * (assist-deidentify.assertClean) and refuse with 422 if anything the
 * practice knows about is still in the clear. What is stored is only what
 * the model was shown. The browser puts the names back for display and
 * keeps that map itself.
 *
 * CLIENT CHATS (migration 084). A chat may be dedicated to one client the
 * caller may see (splose-caseload scoping). The conversation stores only the
 * directory ref; the client is always [CLIENT_1], and the server adds that
 * assignment to `known` itself, so the client's name is tokenised and
 * guarded even if the browser forgot to send it. If the directory cannot
 * resolve the client's name right now, a client chat refuses (503) rather
 * than send text it cannot check — fail closed.
 *
 * Every role except read_only may use it (it is the practice's own AI).
 * Rate limit 30 messages / 5 min per person, in-process like Opa's.
 */

const express = require('express');
const db = require('./database');
const { requireAuth } = require('./permissions');
const { entraBearerAuth } = require('./assist/entra-auth');
const provider = require('./assist/assist-provider');
const deid = require('./assist/assist-deidentify');
const { buildSystemPrompt, SURFACES } = require('./assist/assist-prompt');
const directory = require('./assist/identity-directory');
const caseload = require('./splose-caseload');

const router = express.Router();
const pool = db.pool;

const MAX_MESSAGE_CHARS = 12000;
const MAX_SELECTION_CHARS = 20000;
const MAX_ANSWER_CHARS = 16000;
const HISTORY_TURNS = 16;
const RETENTION_DAYS = 30;

const BLOCKED_ANSWER = 'Opal Assist could not help with that message — a safety check declined it. Please reword and try again, or write it yourself.';
const UNAVAILABLE = 'Opal Assist is not available right now. Please try again in a moment.';
const DISABLED = 'Opal Assist is not switched on for this portal yet.';

// Two ways in: the portal session cookie (web page, phone) or a Microsoft
// 365 bearer token from an Office task pane (entra-auth.js), which maps to
// the same portal account by email. A bearer that fails is a 401, never a
// fall-through; with no bearer the ordinary session path runs.
const sessionOrBearer = (req, res, next) => (req.user && req.authVia === 'entra' ? next() : requireAuth(req, res, next));
router.use('/api/assist', entraBearerAuth, sessionOrBearer, (req, res, next) => {
  if (req.user?.role === 'read_only') return res.status(403).json({ error: 'Read-only accounts cannot use Opal Assist', code: 'read_only_denied' });
  next();
});

const safe = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(`[assist] ${req.method} ${req.path} failed:`, err.message);
  if (res.headersSent) { try { res.end(); } catch (_) { /* closed */ } return; }
  res.status(500).json({ error: 'Opal Assist is unavailable right now' });
});

// ── Rate limit (per user, in-process) ────────────────────────────────────────
const WINDOW_MS = 5 * 60 * 1000;
const MAX_PER_WINDOW = 30;
const _hits = new Map();
setInterval(() => { const cut = Date.now() - WINDOW_MS; for (const [k, v] of _hits) { const kept = v.filter((t) => t > cut); if (kept.length) _hits.set(k, kept); else _hits.delete(k); } }, 10 * 60 * 1000).unref();
function rateLimit(req, res, next) {
  const now = Date.now();
  const list = (_hits.get(req.user.id) || []).filter((t) => t > now - WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) {
    res.set('Retry-After', String(Math.ceil((list[0] + WINDOW_MS - now) / 1000)));
    return res.status(429).json({ error: 'rate_limited', answer: 'Please wait a few minutes before sending more messages.' });
  }
  list.push(now); _hits.set(req.user.id, list); next();
}
function _resetRateLimitForTests() { _hits.clear(); }

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const orgOf = (req) => req.user.organisation_id || null;
const surfaceOf = (body) => (SURFACES[body?.surface] ? body.surface : 'web');

// ── Client chats ─────────────────────────────────────────────────────────────
const CLIENT_REF_RE = /^splose:patient:([A-Za-z0-9_-]{1,40})$/;
const CLIENT_TOKEN = 'CLIENT_1';
const NO_CLIENT_CHECK = 'The client\'s name cannot be checked right now (the client list did not load), so nothing was sent. Please try again in a minute.';

/**
 * `known` with the chat's client pinned as [CLIENT_1]. Returns null when the
 * browser's list contradicts that (CLIENT_1 is someone else) — the caller
 * refuses rather than guess which person a token means.
 */
function withClient(known, clientRef) {
  const list = Array.isArray(known) ? known.filter((k) => k && typeof k === 'object') : [];
  if (!clientRef) return list;
  const mine = list.find((k) => k.ref === clientRef);
  if (mine) return mine.token === CLIENT_TOKEN ? list : null;
  if (list.some((k) => k.token === CLIENT_TOKEN)) return null;
  return [{ token: CLIENT_TOKEN, ref: clientRef, role: 'client' }, ...list];
}

/** True when the directory can name this client, so their name can be hidden and guarded. */
async function clientResolvable(clientRef) {
  try { return !!(await directory.byRef(clientRef)); } catch (_) { return false; }
}

/**
 * A NEW client chat: the ref must be one of the caller's own clients.
 * Responds and returns null on refusal. "Not yours" and "no such client" are
 * the same 404.
 */
async function authoriseClient(req, res, clientRef) {
  const m = CLIENT_REF_RE.exec(String(clientRef || ''));
  if (!m) { res.status(400).json({ error: 'invalid_client', answer: 'That client could not be found.' }); return null; }
  let client;
  try { client = await caseload.loadOwnClient(req, m[1]); } catch (err) {
    if (err instanceof caseload.CaseloadError) { res.status(err.status).json({ error: err.message, code: err.code, answer: err.message }); return null; }
    res.status(502).json({ error: 'client_lookup_failed', answer: 'Could not reach Splose to confirm the client. Please try again.' });
    return null;
  }
  if (!client) { res.status(404).json({ error: 'client_not_found', answer: 'That client could not be found.' }); return null; }
  return clientRef;
}

router.get('/api/assist/clients', safe(async (req, res) => {
  try {
    const { clients, scope } = await caseload.listOwnClients(req);
    res.json({ clients: clients.filter((c) => c.fullName).map((c) => ({ ref: `splose:patient:${c.id}`, name: c.fullName, suburb: c.suburb })), scope });
  } catch (err) {
    if (err instanceof caseload.CaseloadError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('[assist] client list failed:', err.message);
    res.status(502).json({ error: 'Could not load your clients from Splose just now.', code: 'client_lookup_failed' });
  }
}));

// ── Config ───────────────────────────────────────────────────────────────────
router.get('/api/assist/config', safe(async (req, res) => {
  res.json({ enabled: provider.isEnabled(), reason: provider.isEnabled() ? null : provider.configError(), name: 'Opal Assist', retentionDays: RETENTION_DAYS });
}));

// ── Check before sending — no model call ─────────────────────────────────────
router.post('/api/assist/check', safe(async (req, res) => {
  const body = req.body || {};
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim() || text.length > MAX_MESSAGE_CHARS + MAX_SELECTION_CHARS) {
    return res.status(400).json({ error: 'invalid_text', message: `Send between 1 and ${MAX_MESSAGE_CHARS + MAX_SELECTION_CHARS} characters.` });
  }
  let known = body.known;
  if (body.clientRef !== undefined && body.clientRef !== null) {
    if (!CLIENT_REF_RE.test(String(body.clientRef))) return res.status(400).json({ error: 'invalid_client' });
    known = withClient(body.known, body.clientRef);
    if (!known) return res.status(400).json({ error: 'client_token_conflict', message: 'This chat\'s client token is out of step. Start a new chat for this client.' });
    if (!(await clientResolvable(body.clientRef))) return res.status(503).json({ error: 'client_unresolvable', message: NO_CLIENT_CHECK });
  }
  const r = await deid.check({ text, known, confirmedNames: body.confirmedNames, ignoredWords: body.ignoredWords });
  res.json(r);
}));

// ── Shared chat preparation ──────────────────────────────────────────────────
async function prepare(req, res) {
  const body = req.body || {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const selection = typeof body.selection === 'string' ? body.selection.trim().slice(0, MAX_SELECTION_CHARS) : '';
  if (!message || message.length > MAX_MESSAGE_CHARS) {
    res.status(400).json({ error: 'invalid_message', answer: `Please send a message between 1 and ${MAX_MESSAGE_CHARS} characters.` });
    return null;
  }

  let conversation = null;
  if (body.conversationId !== undefined && body.conversationId !== null) {
    if (!isUuid(body.conversationId)) { res.status(404).json({ error: 'Conversation not found' }); return null; }
    const { rows } = await pool.query('SELECT * FROM assist_conversations WHERE id = $1 AND user_id = $2', [body.conversationId, req.user.id]);
    if (!rows.length) { res.status(404).json({ error: 'Conversation not found' }); return null; }
    conversation = rows[0];
  }

  // A thread keeps the client it was started for; a new one is checked
  // against the caller's caseload before anything is sent.
  let clientRef = null;
  if (conversation) clientRef = conversation.client_ref || null;
  else if (body.clientRef !== undefined && body.clientRef !== null) {
    clientRef = await authoriseClient(req, res, body.clientRef);
    if (!clientRef) return null;
  }
  const known = withClient(body.known, clientRef);
  if (!known) { res.status(400).json({ error: 'client_token_conflict', answer: 'This chat\'s client token is out of step. Start a new chat for this client.' }); return null; }
  if (clientRef && !(await clientResolvable(clientRef))) { res.status(503).json({ error: 'client_unresolvable', answer: NO_CLIENT_CHECK }); return null; }

  // The guard. A name or contact detail here means the browser skipped the
  // check, or the check missed something the practice knows — either way
  // it does not leave. Selection text is guarded the same way. In a client
  // chat the client is always part of `known`, server-side.
  for (const [what, txt] of [['message', message], ['selection', selection]]) {
    if (!txt) continue;
    const reason = await deid.assertClean({ text: txt, known });
    if (reason) {
      res.status(422).json({ error: 'identifiers_present', code: reason, where: what, answer: 'That text still contains a name or contact detail. Run the check and hide it first.' });
      return null;
    }
  }
  let history = [];
  if (conversation) {
    const { rows } = await pool.query(`SELECT role, content FROM assist_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT ${HISTORY_TURNS}`, [conversation.id]);
    history = rows.reverse().map((r) => ({ role: r.role, content: r.content }));
  }
  const surface = conversation ? conversation.surface : surfaceOf(body);
  const system = buildSystemPrompt({ user: req.user, surface, selection, clientChat: !!clientRef });
  const hiddenCount = Number.isInteger(body.hiddenCount) && body.hiddenCount >= 0 ? Math.min(body.hiddenCount, 10000) : 0;
  return { message, selection, conversation, history, surface, system, hiddenCount, clientRef };
}

async function persist(req, prep, answer, streamed) {
  let conversation = prep.conversation;
  if (!conversation) {
    const { rows } = await pool.query(
      `INSERT INTO assist_conversations (user_id, organisation_id, title, surface, client_ref, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' days')::interval) RETURNING *`,
      [req.user.id, orgOf(req), prep.message.slice(0, 60), prep.surface, prep.clientRef, String(RETENTION_DAYS)]);
    conversation = rows[0];
  } else {
    await pool.query(`UPDATE assist_conversations SET updated_at = NOW(), expires_at = NOW() + ($2 || ' days')::interval WHERE id = $1`, [conversation.id, String(RETENTION_DAYS)]);
  }
  await pool.query(`INSERT INTO assist_messages (conversation_id, role, content, hidden_count) VALUES ($1, 'user', $2, $3)`, [conversation.id, prep.message, prep.hiddenCount]);
  await pool.query(`INSERT INTO assist_messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`, [conversation.id, answer]);
  await db.logAuditEvent({
    actorUserId: req.user.id, organisationId: orgOf(req),
    action: 'assist.chat', targetType: 'assist_conversation', targetId: conversation.id,
    metadata: { surface: prep.surface, streamed: !!streamed, hiddenCount: prep.hiddenCount, hasSelection: !!prep.selection, messageChars: prep.message.length, clientChat: !!prep.clientRef },
    ipAddress: req.ip,
  }).catch(() => {});
  return conversation;
}

// ── Chat (JSON) ──────────────────────────────────────────────────────────────
router.post('/api/assist/chat', rateLimit, safe(async (req, res) => {
  if (!provider.isEnabled()) return res.json({ status: 'unavailable', answer: DISABLED });
  const prep = await prepare(req, res);
  if (!prep) return;
  let answer;
  try {
    const r = await provider.generate({ system: prep.system, messages: [...prep.history, { role: 'user', content: prep.message }], userId: req.user.id, organisationId: orgOf(req) });
    answer = String(r.text || '').slice(0, MAX_ANSWER_CHARS);
  } catch (err) {
    if (err?.message === 'content_blocked') return res.json({ status: 'blocked', answer: BLOCKED_ANSWER });
    return res.json({ status: 'unavailable', answer: UNAVAILABLE });
  }
  const conversation = await persist(req, prep, answer, false);
  res.json({ status: 'ok', conversationId: conversation.id, answer });
}));

// ── Chat (server-sent events) ────────────────────────────────────────────────
function sseSend(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }

router.post('/api/assist/chat/stream', rateLimit, safe(async (req, res) => {
  if (!provider.isEnabled()) return res.json({ status: 'unavailable', answer: DISABLED });
  const prep = await prepare(req, res);
  if (!prep) return;

  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let answer;
  try {
    const r = await provider.generate({
      system: prep.system, messages: [...prep.history, { role: 'user', content: prep.message }],
      userId: req.user.id, organisationId: orgOf(req), onText: (t) => sseSend(res, 'delta', { t }),
    });
    answer = String(r.text || '').slice(0, MAX_ANSWER_CHARS);
  } catch (err) {
    // A `blocked` event means the client MUST discard every delta shown.
    sseSend(res, err?.message === 'content_blocked' ? 'blocked' : 'unavailable', { answer: err?.message === 'content_blocked' ? BLOCKED_ANSWER : UNAVAILABLE });
    return res.end();
  }
  const conversation = await persist(req, prep, answer, true);
  sseSend(res, 'done', { conversationId: conversation.id, answer });
  res.end();
}));

// ── Conversations ────────────────────────────────────────────────────────────
// ── Document actions: "in your own words" → a list of fixed tools ───────────
// The pane runs formatting as CODE (assist-word-format.js / assist-excel-format.js).
// This endpoint only translates a typed instruction into which of those tools
// to run. It is sent the instruction — never the document — and the
// instruction is de-identified like any other message (a person may type
// "fix Noah's report"). The reply is filtered to the ids the pane offered, so
// the model cannot invent an action.
const ACTIONS = {
  word: {
    formatcheck: 'List every departure from the Opal styling with where it is and a Fix button for each: fonts, blank lines, double spaces, headings, tables, captions, out-of-date contents page',
    format: 'Apply the Opal document standard: fonts, sizes, colours, heading and table styles',
    tidy: 'Remove surplus blank lines and blank pages made of empty lines',
    pages: 'Start every main heading on a new page',
    toc: 'Refresh the contents page, page numbers and cross-references',
    check: 'Report problems without changing anything: missing appendices, heading-level jumps, empty headings, wrong fonts, double spaces, unfilled placeholders',
    refs: 'Turn typed "Table 1" captions into real numbered captions and typed "Appendix B" mentions into live cross-references, then refresh contents and fields',
    recs: 'List every written RECOMMENDATION paragraph in the Recommendation overview table, one row each by support type',
    write: 'Chat: draft the report section at the cursor from the notes there',
    rephrase: 'Chat: rephrase the selected text in plain, person-centred English',
    strengthen: 'Chat: rewrite the selected recommendation in reasonable-and-necessary terms with impact, goal, support and outcome',
    finding: 'Chat: write the KEY FINDING paragraph for the selected section',
    break: 'Insert a page break at the cursor',
    section: 'Insert a next-page section break at the cursor, so what follows can have its own header, footer or page numbering',
    header: 'Set or clear the page header on every section, using the wording the person typed',
    footer: 'Set or clear the page footer on every section, using the wording the person typed, optionally with Page X of Y',
    style: 'Give the selected paragraphs a built-in style the person named: Heading 1-4, Title, Subtitle, Caption, Normal',
    table: 'Insert an empty table in the Opal table style at the cursor, sized from the person\'s words (default 3 by 3)',
    margins: 'Set the page margins on every page: Opal\'s own by default, or normal, narrow or wide if named',
    orientation: 'Turn the pages landscape or portrait',
    firstpage: 'Give the first page its own header and footer (a cover page), or turn that off',
    layout: 'Change nothing: attach a structure-only layout summary (headings, breaks, headers, footers — no body text) to the chat, for a question about WHY the layout looks the way it does',
  },
  excel: {
    table: 'Format the selected range as an Opal table: green header row, banded rows, borders, Arial',
    fit: 'Auto-fit column widths and wrap long text in the selection',
    freeze: 'Freeze the top row so headings stay visible',
    totals: 'Add a totals row that sums every numeric column in the selection',
    numbers: 'Format numeric columns consistently: currency for money headings, two decimals otherwise, dates as d/mm/yyyy',
    check: 'Report problems without changing anything: blank cells, numbers stored as text, duplicate rows, mixed date formats',
  },
};
router.post('/api/assist/actions', rateLimit, safe(async (req, res) => {
  const body = req.body || {};
  const surface = ACTIONS[body.surface] ? body.surface : null;
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 600) : '';
  if (!surface || !instruction) return res.status(400).json({ error: 'invalid_request' });
  if (!provider.isEnabled()) return res.json({ status: 'unavailable', actions: [], note: DISABLED });
  const menu = ACTIONS[surface];
  const checked = await deid.check({ text: instruction });
  const system = 'You translate one instruction from a staff member into document tools. Reply with ONLY a JSON object: '
    + '{"actions": ["id", ...], "note": "one short sentence"}. Use only these ids, in the order they should run; an empty list if none fits. '
    + 'Never include anything else, and never repeat the instruction.\n\nTOOLS\n'
    + Object.entries(menu).map(([id, d]) => `${id}: ${d}`).join('\n');
  let text;
  try {
    const r = await provider.generate({ system, messages: [{ role: 'user', content: checked.text }], userId: req.user.id, organisationId: orgOf(req) });
    text = String(r.text || '');
  } catch (err) {
    if (err?.message === 'content_blocked') return res.json({ status: 'blocked', actions: [], note: BLOCKED_ANSWER });
    return res.json({ status: 'unavailable', actions: [], note: UNAVAILABLE });
  }
  let parsed = null;
  try { parsed = JSON.parse((text.match(/\{[\s\S]*\}/) || [''])[0]); } catch (e) { parsed = null; }
  const actions = Array.isArray(parsed?.actions) ? [...new Set(parsed.actions.filter((id) => typeof id === 'string' && menu[id]))].slice(0, 6) : [];
  await db.logAuditEvent({
    actorUserId: req.user.id, organisationId: orgOf(req), action: 'assist.actions', targetType: 'assist_surface', targetId: surface,
    metadata: { surface, actions, instructionChars: instruction.length, hiddenCount: checked.hidden.length }, ipAddress: req.ip,
  }).catch(() => {});
  res.json({ status: 'ok', actions, note: actions.length ? '' : 'None of the document tools fits that. Ask it in the chat below instead.' });
}));

router.get('/api/assist/conversations', safe(async (req, res) => {
  const filter = typeof req.query.client === 'string' ? req.query.client : null;
  if (filter && filter !== 'general' && !CLIENT_REF_RE.test(filter)) return res.status(400).json({ error: 'invalid_client' });
  const where = filter === 'general' ? ' AND client_ref IS NULL' : filter ? ' AND client_ref = $2' : '';
  const { rows } = await pool.query(
    `SELECT id, title, surface, client_ref, updated_at, expires_at FROM assist_conversations WHERE user_id = $1 AND expires_at > NOW()${where} ORDER BY updated_at DESC LIMIT 50`,
    filter && filter !== 'general' ? [req.user.id, filter] : [req.user.id]);
  res.json({ conversations: rows });
}));

router.get('/api/assist/conversations/:id', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Conversation not found' });
  const c = await pool.query('SELECT id, title, surface, client_ref, updated_at, expires_at FROM assist_conversations WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!c.rows.length) return res.status(404).json({ error: 'Conversation not found' });
  const m = await pool.query('SELECT role, content, hidden_count, created_at FROM assist_messages WHERE conversation_id = $1 ORDER BY id ASC', [req.params.id]);
  res.json({ conversation: c.rows[0], messages: m.rows });
}));

router.delete('/api/assist/conversations/:id', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Conversation not found' });
  const r = await pool.query('DELETE FROM assist_conversations WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Conversation not found' });
  await db.logAuditEvent({ actorUserId: req.user.id, organisationId: orgOf(req), action: 'assist.conversation_deleted', targetType: 'assist_conversation', targetId: req.params.id, metadata: {}, ipAddress: req.ip }).catch(() => {});
  res.json({ ok: true });
}));

/** Retention: delete expired conversations (messages cascade). Called daily and at boot. */
async function purgeExpired() {
  const r = await pool.query('DELETE FROM assist_conversations WHERE expires_at <= NOW()');
  return r.rowCount || 0;
}

module.exports = router;
module.exports.purgeExpired = purgeExpired;
module.exports.ACTIONS = ACTIONS;
module.exports.RETENTION_DAYS = RETENTION_DAYS;
module.exports._resetRateLimitForTests = _resetRateLimitForTests;
