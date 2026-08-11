'use strict';

/**
 * CASE-NOTE DRAFTS — voice-to-case-note for Opa Mobile.
 *
 * Flow: the phone sends a reviewed dictation transcript + a linked
 * appointment id. The server verifies ownership, pulls the appointment
 * metadata itself, sends ONLY the transcript + session date/service label
 * to the clinical-note provider (see clinical-note-provider.js for the full
 * transmission contract), validates the structured narrative that comes
 * back, composes the Opal-format note deterministically, and stores a
 * PRIVATE DRAFT.
 *
 * Hard rules enforced here:
 * - Metadata (client name, address, service line, date, billing) comes from
 *   the linked event — model output can never set or override it.
 * - Billing/time lines appear only when derivable from event data
 *   (duration from start/end, travel from travel_time_minutes); otherwise
 *   they are omitted entirely — never guessed.
 * - The original transcript is stored verbatim and survives every
 *   regeneration unchanged.
 * - Fail-closed: provider unconfigured → 503 generation_unavailable before
 *   anything is sent anywhere; provider failure → 502 with no row written
 *   (the phone keeps the transcript).
 * - Strictly user-scoped (snapshot model): every read/write filters
 *   user_id; not-yours answers 404. No role — owner included — can read
 *   another user's drafts.
 * - Drafts stay drafts: no Splose/Outlook write, no finalisation, no
 *   appointment-completion side effects. Audit events carry ids, versions
 *   and counts only — never transcript or note content.
 */

const express = require('express');
const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const { requireAuth } = require('./permissions');
const provider = require('./clinical-note-provider');
const { CURRENT_STYLE_VERSION, INSTRUCTION_MODIFIERS } = require('./case-note-style');
const log = require('./logger').createLogger('case-note');

router.use('/api/mobile/case-note-drafts', requireAuth);

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  // Message only — never request bodies (they carry clinical content).
  log.error('case-note route error', { error: err.message, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const orgOf = (req) => req.user?.organisation_id || null;

const MAX_TRANSCRIPT_CHARS = 8000;
const MAX_NOTE_BODY_CHARS = 40000;

/**
 * The client's correlation id, echoed back so a therapist reporting "the note
 * failed this afternoon" can be matched to one interaction row.
 *
 * Client-supplied and unauthenticated: it is validated as a UUID and used as a
 * log field only. It never selects a record and never grants anything.
 */
const requestIdOf = (req) => (isUuid(req.body?.requestId) ? req.body.requestId : undefined);

// ── Per-user AI generation rate limit — 10 generations per 10 minutes ────────
//
// The read and edit routes below are cheap database calls. A generation is
// not: it is a real model invocation with real cost, an audit row, and
// clinical content in flight. Nothing else bounds how fast an authenticated
// caller can ask for one, and a phone retrying in a loop — which is exactly
// what a client does when it thinks a failure is transient — could issue them
// as fast as the network allows.
//
// Mirrors the in-memory pattern in opa-routes.js: a Map plus a periodic prune.
// The window resets on restart, which is acceptable at this deployment size
// and is the same trade-off already accepted for chat and for login attempts.

const CASE_NOTE_AI_WINDOW_MS = 10 * 60 * 1000;
const CASE_NOTE_AI_MAX = 10;
const _aiAttempts = new Map(); // userId → { count, resetAt }

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _aiAttempts) {
    if (entry.resetAt <= now) _aiAttempts.delete(key);
  }
}, 10 * 60 * 1000).unref();

function aiRateLimit(req, res, next) {
  const key = req.user?.id || 'anonymous';
  const now = Date.now();
  let entry = _aiAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + CASE_NOTE_AI_WINDOW_MS };
    _aiAttempts.set(key, entry);
  }
  entry.count++;
  if (entry.count > CASE_NOTE_AI_MAX) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      // Says the transcript is safe, because the therapist is holding one and
      // that is their actual worry when a request is refused.
      error: 'That is a lot of case notes at once. Your transcript is safe — please wait a moment and try again.',
      code: 'rate_limited',
      requestId: requestIdOf(req),
    });
  }
  return next();
}

/** Test helper: clear the rate-limit window between tests. */
function _resetCaseNoteAiRateLimit() { _aiAttempts.clear(); }

/**
 * Map a provider failure onto the mobile API contract.
 *
 * The distinction this exists to preserve: `generation_disabled` is a POLICY
 * state — the kill switch thrown, a failed boundary self-check, an unavailable
 * audit layer, or Bedrock configuration missing. None of those change by
 * asking again.
 *
 * Reporting it as `generation_failed` (which is what happened before) tells
 * the phone the request FAILED, and the phone offers a Retry button on a
 * failure. The therapist then retries something that cannot succeed, and every
 * attempt writes another denied row to ai_interactions. The kill switch being
 * thrown mid-incident is precisely when that must not happen.
 *
 * `content_blocked` is a third state again: the guardrail declined the content.
 * It is not a fault and not a configuration problem, and it is the one case
 * where retrying is not merely useless but wrong — it resubmits clinical
 * content to a control that has already refused it.
 */
function generationFailure(err, req, variant = 'generate') {
  const requestId = requestIdOf(req);
  const regenerating = variant === 'regenerate';

  // What is at risk differs between the two callers, and the reassurance has
  // to match: on first generation the therapist is holding an unsaved
  // dictation; on regeneration they already have a draft they might lose.
  //
  // The dead-end states (503, 422) additionally point at the fallback, because
  // for those there is no retry and saving the dictation as a plain draft is
  // the only way forward. The 502 deliberately does NOT, so the two read
  // differently: that one IS worth trying again, and suggesting the fallback
  // first would talk the therapist out of the action most likely to work.
  const safety = regenerating
    ? 'Your current draft is unchanged.'
    : 'Your transcript is safe — you can save it as a draft note.';

  if (err?.message === 'generation_disabled') {
    return {
      status: 503,
      body: {
        error: `Case-note formatting is not available right now. ${safety}`,
        code: 'generation_unavailable',
        requestId,
      },
    };
  }

  if (err?.message === 'content_blocked') {
    return {
      status: 422,
      body: {
        // Deliberately says nothing about WHY. A refusal reason describing how
        // clinical content tripped a filter is not something to hand to a
        // client-facing screen, and the phone substitutes its own wording.
        error: `This content could not be processed. ${safety}`,
        code: 'content_blocked',
        requestId,
      },
    };
  }

  return {
    status: 502,
    body: {
      error: regenerating
        ? "We couldn't regenerate the case note right now. Your current draft is unchanged."
        : "We couldn't format your case note right now. Your transcript is safe.",
      code: 'generation_failed',
      requestId,
    },
  };
}

async function audit(req, action, targetId, extraMeta = {}) {
  await db.logAuditEvent({
    action, targetType: 'case_note_draft', targetId,
    actorUserId: req.user?.id, organisationId: orgOf(req), ipAddress: req.ip,
    metadata: { id: targetId, ...extraMeta }, // ids/versions/counts only
  }).catch(() => {});
}

// ── Perth rendering (same single-business-timezone rule as mobile-routes) ───
const PERTH_TZ = 'Australia/Perth';

const perthTime = (iso) => new Date(iso)
  .toLocaleTimeString('en-AU', { timeZone: PERTH_TZ, hour: 'numeric', minute: '2-digit', hour12: true })
  .replace(/\s/g, ' ');
const perthDateShort = (iso) => new Date(iso)
  .toLocaleDateString('en-AU', { timeZone: PERTH_TZ, day: 'numeric', month: 'short', year: 'numeric' });
const perthDateSlash = (iso) => new Date(iso)
  .toLocaleDateString('en-AU', { timeZone: PERTH_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });

/** Same routability rule as mobile-routes/routes.js. */
function isRoutableAddress(addr) {
  if (!addr || typeof addr !== 'string') return false;
  const clean = addr.trim();
  if (clean.length < 6) return false;
  if (/^(unknown|n\/a|none|tbc|tbd|-+)$/i.test(clean)) return false;
  return clean.includes(',') || clean.split(/\s+/).length >= 3;
}

/** Load an event the caller owns (therapist profile or legacy user row). */
async function loadOwnEvent(req, eventId) {
  if (!isUuid(eventId)) return null;
  const params = [eventId, req.user.id];
  let where = 'user_id = $2';
  if (req.user.therapist_profile_id) {
    params.push(req.user.therapist_profile_id);
    where = '(user_id = $2 OR therapist_profile_id = $3)';
  }
  const { rows } = await pool.query(
    `SELECT * FROM events WHERE id = $1 AND ${where} AND (is_deleted IS NULL OR is_deleted = FALSE)`, params);
  return rows[0] || null;
}

async function loadOwnDraft(req, id) {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(
    'SELECT * FROM case_note_drafts WHERE id = $1 AND user_id = $2', [id, req.user.id]);
  return rows[0] || null;
}

// ── Deterministic composition (never model output) ──────────────────────────

/** Header snapshot from the linked event. Missing data is omitted, never invented. */
function buildHeader(ev) {
  const address = ev.manual_location || ev.location || null;
  return {
    clientName: ev.client_name || null,
    clientAddress: isRoutableAddress(address) ? address : null,
    serviceLine: `${perthTime(ev.start_time)}, ${perthDateShort(ev.start_time)} ${ev.title || 'Therapy Session'}`,
    sessionDateLabel: perthDateSlash(ev.start_time),
  };
}

/** Billing line only where the event actually carries the data. */
function buildBillingLine(ev) {
  const start = new Date(ev.start_time).getTime();
  const end = new Date(ev.end_time).getTime();
  const duration = Math.round((end - start) / 60000);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60) return null;
  const travel = ev.travel_time_minutes != null ? Number(ev.travel_time_minutes) : null;
  return `Time billed for ${duration}-minute session${travel ? ` + ${travel} minutes travel` : ''}.`;
}

/**
 * Content screen over model narrative (defence in depth behind the style
 * prompt). Structural separation stops the model SETTING metadata fields,
 * but nothing stopped it writing metadata-shaped sentences INSIDE the
 * narrative — e.g. "Time billed for 90-minute session" on an appointment
 * with no billable duration, rendered indistinguishably from the server's
 * own deterministic line. Prompts are instruction, not enforcement, so:
 * strip billing/time-claim sentences from the narrative outright, and flag
 * an address echo for the therapist. Returns { sections, extraWarnings }.
 */
// Group 1 is the preceding sentence terminator — kept, so stripping a
// billing sentence never swallows the punctuation of the sentence before it.
const BILLING_CLAIM_RE = /(^|[.!?]\s+)[^.!?]*\b(?:time billed|billed for|minutes? travel|hours? billed|case noting)\b[^.!?]*[.!?]?/gi;

function screenNarrative(sections, header) {
  const extraWarnings = [];
  const stripBilling = (text, label) => {
    if (!BILLING_CLAIM_RE.test(text)) { BILLING_CLAIM_RE.lastIndex = 0; return text; }
    BILLING_CLAIM_RE.lastIndex = 0;
    const cleaned = text.replace(BILLING_CLAIM_RE, '$1').replace(/\s{2,}/g, ' ').trim();
    extraWarnings.push(`A billing or time statement was removed from ${label} — billing comes from the appointment, not the dictation.`);
    return cleaned;
  };
  const identify = stripBilling(sections.identify, 'Identify');
  const sessionDetails = stripBilling(sections.sessionDetails, 'Session details');
  const plan = sections.plan.filter((p) => {
    BILLING_CLAIM_RE.lastIndex = 0;
    const isBilling = BILLING_CLAIM_RE.test(p);
    BILLING_CLAIM_RE.lastIndex = 0;
    return !isBilling;
  });

  // Address echo: the model should never restate the participant's address
  // (it is never sent to the model, so an echo means it came from dictation
  // or invention — either way the therapist should look).
  if (header.clientAddress) {
    const needle = header.clientAddress.split(',')[0].trim().toLowerCase();
    if (needle.length >= 6 && `${identify} ${sessionDetails}`.toLowerCase().includes(needle)) {
      extraWarnings.push('Check the address mentioned in the narrative — the appointment address is added automatically.');
    }
  }
  return { sections: { ...sections, identify, sessionDetails, plan }, extraWarnings };
}

/**
 * Service label sent to the model. Appointment titles in this product can
 * embed the participant's name ("Therapy Session — Liam"), and the
 * transmission contract says no names leave the server: strip the linked
 * client's name (and any trailing "— Name" fragment) before sending. The
 * FULL title is still used for the note header, which never goes to the
 * model.
 */
function providerServiceLabel(ev) {
  let label = String(ev.title || 'Therapy Session');
  const name = (ev.client_name || '').trim();
  if (name) {
    for (const part of [name, ...name.split(/\s+/)].filter((p) => p.length >= 3)) {
      label = label.replace(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
    }
  }
  // Drop dangling separators left by the removal, then collapse whitespace.
  label = label.replace(/[—–-]\s*(?=$|[—–-])/g, ' ').replace(/\s{2,}/g, ' ').replace(/[\s—–-]+$/, '').trim();
  return label || 'Therapy Session';
}

/** Compose the full editable note body from header + validated narrative. */
function composeNoteBody(header, sections, billingLine) {
  const parts = [];
  if (header.clientName) parts.push(header.clientName);
  if (header.clientAddress) parts.push(header.clientAddress);
  if (parts.length) parts.push('');
  parts.push('Therapy Session', '', `Service: ${header.serviceLine}`, '');
  parts.push('Identify:', '', sections.identify, '');
  parts.push('Session details:', '', sections.sessionDetails, '');
  if (sections.plan.length) {
    parts.push('Plan:', '', ...sections.plan.map((p) => `- ${p}`), '');
  }
  if (billingLine) parts.push(billingLine);
  return parts.join('\n').trim();
}

function formatDraft(row) {
  return {
    id: row.id,
    voiceNoteId: row.voice_note_id,
    linkedEventId: row.linked_event_id,
    transcript: row.transcript,
    header: row.header || {},
    identify: row.identify,
    sessionDetails: row.session_details,
    plan: row.plan || [],
    warnings: row.warnings || [],
    noteBody: row.note_body,
    status: row.status,
    styleVersion: row.style_version,
    generatedAt: row.generated_at,
    // Governance surface: whether AI was involved, whether a human has
    // accepted it, and which interaction produced it. The client needs this
    // to show an honest "AI-assisted, awaiting your review" state rather than
    // presenting a draft as if it were finished documentation.
    generationSource: row.generation_source || 'ai_assisted',
    reviewStatus: row.review_status || 'review_required',
    reviewedAt: row.reviewed_at || null,
    aiInteractionId: row.ai_interaction_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validInstruction(instruction) {
  return instruction === undefined || instruction === null
    || Object.prototype.hasOwnProperty.call(INSTRUCTION_MODIFIERS, instruction);
}

// ═══ Generate ════════════════════════════════════════════════════════════════

router.post('/api/mobile/case-note-drafts/generate', aiRateLimit, safe(async (req, res) => {
  const b = req.body || {};
  if (!(typeof b.transcript === 'string' && b.transcript.trim())) {
    return res.status(400).json({ error: 'transcript is required' });
  }
  if (b.transcript.length > MAX_TRANSCRIPT_CHARS) {
    return res.status(400).json({ error: `transcript must be ${MAX_TRANSCRIPT_CHARS} characters or fewer` });
  }
  if (!validInstruction(b.instruction)) {
    return res.status(400).json({ error: 'Unknown instruction' });
  }

  const ev = await loadOwnEvent(req, b.linkedEventId);
  if (!ev) {
    return res.status(400).json({
      error: 'linkedEventId does not reference an appointment you can access',
      code: 'invalid_link',
    });
  }
  if (b.voiceNoteId !== undefined && b.voiceNoteId !== null) {
    if (!isUuid(b.voiceNoteId)) return res.status(400).json({ error: 'voiceNoteId must be a UUID' });
    const vn = await pool.query(
      'SELECT id FROM voice_notes WHERE id = $1 AND user_id = $2', [b.voiceNoteId, req.user.id]);
    if (!vn.rows.length) {
      return res.status(400).json({ error: 'voiceNoteId does not reference a note you can access', code: 'invalid_link' });
    }
  }

  // Fail closed BEFORE anything leaves the server. Routed through the same
  // helper as the mid-flight case so both produce one indistinguishable
  // 'unavailable' shape: from the phone's point of view "the switch was
  // already off" and "the switch was thrown while I was asking" are the same
  // event, and it should not have to tell them apart.
  if (!provider.isEnabled()) {
    const { status, body } = generationFailure(new Error('generation_disabled'), req);
    return res.status(status).json(body);
  }

  const header = buildHeader(ev);
  const transcript = b.transcript.trim();

  let raw;
  try {
    raw = await provider.generateCaseNote({
      transcript,
      styleVersion: CURRENT_STYLE_VERSION,
      instruction: b.instruction || undefined,
      // Minimum context: date + name-stripped service label only. No names,
      // no address, no ids — the transcript is the only clinical carrier.
      session: { dateLabel: header.sessionDateLabel, serviceLabel: providerServiceLabel(ev) },
      // Attribution. Without these the ai_interactions row is written with a
      // null actor, and no AI call can be traced to a person — which defeats
      // the governance layer and breaks the review linkage below.
      userId: req.user.id,
      organisationId: orgOf(req),
    });
  } catch (err) {
    const { status, body } = generationFailure(err, req);
    return res.status(status).json(body);
  }

  const screened = screenNarrative(raw, header);
  const sections = { ...screened.sections, warnings: [...raw.warnings, ...screened.extraWarnings] };
  const noteBody = composeNoteBody(header, sections, buildBillingLine(ev));
  const identity = provider.providerIdentity();

  const { rows } = await pool.query(
    // ai_interaction_id links the draft to the gateway interaction that
    // produced it, so the practice can answer "which notes were AI-assisted,
    // where were they processed, and who approved them" without this table
    // ever holding the AI conversation. review_status starts at
    // 'review_required': a clinical document is not documentation until a
    // therapist accepts it.
    `INSERT INTO case_note_drafts
       (user_id, organisation_id, voice_note_id, linked_event_id, transcript, header,
        identify, session_details, plan, warnings, note_body,
        style_version, provider_id, model_id, generated_at,
        ai_interaction_id, generation_source, review_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),$15,'ai_assisted','review_required') RETURNING *`,
    [req.user.id, orgOf(req), b.voiceNoteId || null, ev.id, transcript, JSON.stringify(header),
     sections.identify, sections.sessionDetails, JSON.stringify(sections.plan),
     JSON.stringify(sections.warnings), noteBody,
     CURRENT_STYLE_VERSION, identity.providerId, identity.modelId,
     sections.metadata?.interactionId || null]);
  const draft = rows[0];

  await audit(req, 'mobile.case_note_generated', draft.id, {
    linkedEventId: ev.id,
    styleVersion: CURRENT_STYLE_VERSION,
    modelId: identity.modelId,
    transcriptChars: transcript.length,
    warningCount: sections.warnings.length,
  });
  res.status(201).json({ caseNoteDraft: formatDraft(draft), requestId: requestIdOf(req) });
}));

// ═══ Read ════════════════════════════════════════════════════════════════════

router.get('/api/mobile/case-note-drafts', safe(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM case_note_drafts WHERE user_id = $1 AND status = 'draft'
      ORDER BY created_at DESC LIMIT 20`, [req.user.id]);
  res.json({ caseNoteDrafts: rows.map(formatDraft) });
}));

router.get('/api/mobile/case-note-drafts/:id', safe(async (req, res) => {
  const row = await loadOwnDraft(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ caseNoteDraft: formatDraft(row) });
}));

// ═══ Edit (therapist review) ═════════════════════════════════════════════════

router.patch('/api/mobile/case-note-drafts/:id', safe(async (req, res) => {
  const row = await loadOwnDraft(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'draft') {
    return res.status(409).json({ error: 'Only drafts can be edited', code: 'invalid_state' });
  }
  const b = req.body || {};
  const sets = [];
  const params = [row.id, req.user.id];
  if (b.noteBody !== undefined) {
    if (!(typeof b.noteBody === 'string' && b.noteBody.trim())) {
      return res.status(400).json({ error: 'noteBody must be a non-empty string' });
    }
    if (b.noteBody.length > MAX_NOTE_BODY_CHARS) {
      return res.status(400).json({ error: `noteBody must be ${MAX_NOTE_BODY_CHARS} characters or fewer` });
    }
    params.push(b.noteBody);
    sets.push(`note_body = $${params.length}`);
  }
  if (b.plan !== undefined) {
    if (!Array.isArray(b.plan) || b.plan.some((p) => typeof p !== 'string') || b.plan.length > 20) {
      return res.status(400).json({ error: 'plan must be an array of up to 20 strings' });
    }
    params.push(JSON.stringify(b.plan.map((p) => p.trim()).filter(Boolean)));
    sets.push(`plan = $${params.length}`);
  }
  if (!sets.length) return res.status(400).json({ error: 'No editable fields supplied' });

  const { rows } = await pool.query(
    `UPDATE case_note_drafts SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $1 AND user_id = $2 RETURNING *`, params);
  await audit(req, 'mobile.case_note_updated', row.id, { editedChars: b.noteBody ? b.noteBody.length : 0 });
  res.json({ caseNoteDraft: formatDraft(rows[0]) });
}));

// ═══ Regenerate (same row — retries never duplicate records) ═════════════════

router.post('/api/mobile/case-note-drafts/:id/regenerate', aiRateLimit, safe(async (req, res) => {
  const row = await loadOwnDraft(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'draft') {
    return res.status(409).json({ error: 'Only drafts can be regenerated', code: 'invalid_state' });
  }
  const instruction = req.body?.instruction;
  if (!validInstruction(instruction)) {
    return res.status(400).json({ error: 'Unknown instruction' });
  }
  if (!provider.isEnabled()) {
    const { status, body } = generationFailure(new Error('generation_disabled'), req, 'regenerate');
    return res.status(status).json(body);
  }

  // Re-fetch the event for header/billing; if it has since vanished, reuse
  // the stored header snapshot rather than failing the regeneration.
  const ev = await loadOwnEvent(req, row.linked_event_id);
  const header = ev ? buildHeader(ev) : (row.header || {});
  const billing = ev ? buildBillingLine(ev) : null;

  let raw;
  try {
    raw = await provider.generateCaseNote({
      transcript: row.transcript, // always the original dictation
      styleVersion: CURRENT_STYLE_VERSION,
      instruction: instruction || undefined,
      session: { dateLabel: header.sessionDateLabel, serviceLabel: ev ? providerServiceLabel(ev) : undefined },
      userId: req.user.id,
      organisationId: orgOf(req),
    });
  } catch (err) {
    const { status, body } = generationFailure(err, req, 'regenerate');
    return res.status(status).json(body);
  }

  const screened = screenNarrative(raw, header);
  const sections = { ...screened.sections, warnings: [...raw.warnings, ...screened.extraWarnings] };
  const identity = provider.providerIdentity();
  const noteBody = composeNoteBody(header, sections, billing);
  const { rows } = await pool.query(
    // Regeneration replaces the narrative with fresh, never-reviewed model
    // output, so any prior approval is void: review_status resets and the
    // previous reviewer is cleared. Leaving them would leave a note marked
    // "approved by <therapist> on <date>" whose text that therapist never saw
    // — an attestation to content that did not exist when it was made.
    //
    // ai_interaction_id also moves to the NEW interaction; otherwise the draft
    // points at the superseded call and the interaction that actually produced
    // the current text is orphaned.
    `UPDATE case_note_drafts
        SET header = $3, identify = $4, session_details = $5, plan = $6, warnings = $7,
            note_body = $8, style_version = $9, provider_id = $10, model_id = $11,
            ai_interaction_id = $12,
            review_status = 'review_required', reviewed_by = NULL, reviewed_at = NULL,
            generated_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND user_id = $2 RETURNING *`,
    [row.id, req.user.id, JSON.stringify(header), sections.identify, sections.sessionDetails,
     JSON.stringify(sections.plan), JSON.stringify(sections.warnings), noteBody,
     CURRENT_STYLE_VERSION, identity.providerId, identity.modelId,
     raw.metadata?.interactionId || null]);

  await audit(req, 'mobile.case_note_regenerated', row.id, {
    styleVersion: CURRENT_STYLE_VERSION,
    modelId: identity.modelId,
    instruction: instruction || null,
    warningCount: sections.warnings.length,
  });
  res.json({ caseNoteDraft: formatDraft(rows[0]), requestId: requestIdOf(req) });
}));

// ═══ Archive (soft delete) ═══════════════════════════════════════════════════

router.delete('/api/mobile/case-note-drafts/:id', safe(async (req, res) => {
  const row = await loadOwnDraft(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'draft') return res.json({ ok: true }); // already archived — idempotent
  await pool.query(
    `UPDATE case_note_drafts SET status = 'archived', updated_at = NOW()
      WHERE id = $1 AND user_id = $2`, [row.id, req.user.id]);
  await audit(req, 'mobile.case_note_archived', row.id);
  res.json({ ok: true });
}));

// ═══ Human review — the moment a draft stops being a draft ═══════════════════
//
// AHPRA holds the practitioner responsible for the accuracy and relevance of
// records produced with generative AI, so an AI-assisted note is documentation
// only once a person has accepted it. This endpoint is where that
// accountability is recorded, on the draft and on the AI interaction that
// produced it.
//
// Scoped to the owning user: one therapist cannot approve another's work.

const REVIEW_DECISIONS = ['approved', 'rejected'];

router.post('/api/mobile/case-note-drafts/:id/review', safe(async (req, res) => {
  const decision = String(req.body?.decision || '').toLowerCase();
  if (!REVIEW_DECISIONS.includes(decision)) {
    return res.status(400).json({ error: 'decision must be "approved" or "rejected"' });
  }

  const row = await loadOwnDraft(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'draft') {
    return res.status(409).json({ error: 'Archived drafts cannot be reviewed' });
  }

  const { rows } = await pool.query(
    `UPDATE case_note_drafts
        SET review_status = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = $3 AND user_id = $2 RETURNING *`,
    [decision, req.user.id, row.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });

  // Mirror the decision onto the AI interaction so the governance record and
  // the clinical record cannot drift apart. Non-fatal: a failure here must not
  // strand a therapist who has already approved their note.
  // A silent no-match here would leave the governance record permanently
  // disagreeing with the clinical record — the note says approved, the
  // interaction says awaiting review — so the outcome is captured rather than
  // discarded, and lands in the audit event where it can be noticed.
  let interactionSynced = null;
  if (row.ai_interaction_id) {
    try {
      // eslint-disable-next-line global-require
      interactionSynced = await require('./ai/ai-audit').markReviewed({
        interactionId: row.ai_interaction_id,
        reviewedBy: req.user.id,
        decision,
      });
      if (!interactionSynced) {
        log.warn(`review recorded on draft ${row.id} but interaction ${row.ai_interaction_id} matched no row`);
      }
    } catch (err) {
      interactionSynced = false;
      log.warn(`review recorded on draft but not on interaction (reason: ${err?.message || 'unknown'})`);
    }
  }

  await audit(req, 'mobile.case_note_reviewed', row.id, {
    decision,
    aiInteractionId: row.ai_interaction_id || null,
    interactionSynced,
  });
  res.json({ caseNoteDraft: formatDraft(rows[0]) });
}));

module.exports = router;
module.exports._resetCaseNoteAiRateLimit = _resetCaseNoteAiRateLimit;
