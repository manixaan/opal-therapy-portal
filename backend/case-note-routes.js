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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validInstruction(instruction) {
  return instruction === undefined || instruction === null
    || Object.prototype.hasOwnProperty.call(INSTRUCTION_MODIFIERS, instruction);
}

// ═══ Generate ════════════════════════════════════════════════════════════════

router.post('/api/mobile/case-note-drafts/generate', safe(async (req, res) => {
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

  // Fail closed BEFORE anything leaves the server.
  if (!provider.isEnabled()) {
    return res.status(503).json({
      error: 'Case-note formatting is not available yet. Your transcript is safe — you can save it as a draft note.',
      code: 'generation_unavailable',
    });
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
    });
  } catch (err) {
    return res.status(502).json({
      error: "We couldn't format your case note right now. Your transcript is safe.",
      code: 'generation_failed',
    });
  }

  const screened = screenNarrative(raw, header);
  const sections = { ...screened.sections, warnings: [...raw.warnings, ...screened.extraWarnings] };
  const noteBody = composeNoteBody(header, sections, buildBillingLine(ev));
  const identity = provider.providerIdentity();

  const { rows } = await pool.query(
    `INSERT INTO case_note_drafts
       (user_id, organisation_id, voice_note_id, linked_event_id, transcript, header,
        identify, session_details, plan, warnings, note_body,
        style_version, provider_id, model_id, generated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW()) RETURNING *`,
    [req.user.id, orgOf(req), b.voiceNoteId || null, ev.id, transcript, JSON.stringify(header),
     sections.identify, sections.sessionDetails, JSON.stringify(sections.plan),
     JSON.stringify(sections.warnings), noteBody,
     CURRENT_STYLE_VERSION, identity.providerId, identity.modelId]);
  const draft = rows[0];

  await audit(req, 'mobile.case_note_generated', draft.id, {
    linkedEventId: ev.id,
    styleVersion: CURRENT_STYLE_VERSION,
    modelId: identity.modelId,
    transcriptChars: transcript.length,
    warningCount: sections.warnings.length,
  });
  res.status(201).json({ caseNoteDraft: formatDraft(draft) });
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

router.post('/api/mobile/case-note-drafts/:id/regenerate', safe(async (req, res) => {
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
    return res.status(503).json({
      error: 'Case-note formatting is not available right now. Your current draft is unchanged.',
      code: 'generation_unavailable',
    });
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
    });
  } catch (err) {
    return res.status(502).json({
      error: "We couldn't regenerate the case note right now. Your current draft is unchanged.",
      code: 'generation_failed',
    });
  }

  const screened = screenNarrative(raw, header);
  const sections = { ...screened.sections, warnings: [...raw.warnings, ...screened.extraWarnings] };
  const identity = provider.providerIdentity();
  const noteBody = composeNoteBody(header, sections, billing);
  const { rows } = await pool.query(
    `UPDATE case_note_drafts
        SET header = $3, identify = $4, session_details = $5, plan = $6, warnings = $7,
            note_body = $8, style_version = $9, provider_id = $10, model_id = $11,
            generated_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND user_id = $2 RETURNING *`,
    [row.id, req.user.id, JSON.stringify(header), sections.identify, sections.sessionDetails,
     JSON.stringify(sections.plan), JSON.stringify(sections.warnings), noteBody,
     CURRENT_STYLE_VERSION, identity.providerId, identity.modelId]);

  await audit(req, 'mobile.case_note_regenerated', row.id, {
    styleVersion: CURRENT_STYLE_VERSION,
    modelId: identity.modelId,
    instruction: instruction || null,
    warningCount: sections.warnings.length,
  });
  res.json({ caseNoteDraft: formatDraft(rows[0]) });
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

module.exports = router;
