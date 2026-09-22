'use strict';

/**
 * WHICH SPLOSE PRACTITIONER AM I? — self-service link / unlink.
 *
 * Splose issues one API key per practice, so "your Splose account" inside the
 * portal is the practitioner id stored on your therapist profile
 * (`therapist_profiles.splose_practitioner_id`). Every scoped read and write
 * in routes.js keys off that one column. Until now only the owner could set
 * it, by pasting a raw id into Team Setup, and owner/admin accounts fell back
 * to the first practitioner in Splose's list — which is how an owner ended up
 * "logged into someone else's calendar".
 *
 * Rules, fail-closed:
 *   • read_only accounts cannot touch practice-management identity at all;
 *   • EVERY role — owner and admin included — may self-link ONLY the
 *     practitioner whose Splose email matches their own portal sign-in
 *     (case-insensitive). Nobody can link someone else's calendar to their
 *     own account by picking the wrong name (18 Sep 2026, Antony's rule);
 *   • never one already linked to another active account — one person,
 *     one identity. Moving a link belongs to the owner in Team Setup
 *     (PUT /api/therapists/:id), which is an explicit act on another
 *     person's profile, not a self-service pick;
 *   • unlinking is explicit (DELETE) — the upsert helper's COALESCE never
 *     clears the column, and nothing else may.
 *
 * Every link and unlink is audited with ids only.
 */

const express = require('express');
const db = require('./database');
const sploseApi = require('./splose-api');
const { requireAuth, requireRole } = require('./permissions');
const sploseCredentials = require('./splose-credentials');

const router = express.Router();

router.use('/api/splose/my-practitioner', requireAuth, (req, res, next) => {
  if (req.user?.role === 'read_only') {
    return res.status(403).json({
      error: 'Read-only accounts cannot access practice-management data',
      code: 'splose_read_only_denied',
    });
  }
  next();
});

const safe = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(`[splose-link] ${req.method} ${req.path} failed:`, err.message);
  res.status(500).json({ error: 'Splose practitioner link unavailable right now' });
});

const lower = (s) => String(s || '').trim().toLowerCase();

/** Practitioner ids already linked to OTHER accounts in this practice. */
async function claimedByOthers(req) {
  const q = await db.pool.query(
    `SELECT tp.splose_practitioner_id AS id, u.name, u.display_name
       FROM therapist_profiles tp
       JOIN users u ON u.id = tp.user_id
      WHERE tp.splose_practitioner_id IS NOT NULL
        AND tp.user_id <> $1
        AND u.organisation_id IS NOT DISTINCT FROM $2
        AND u.is_active = TRUE`,
    [req.user.id, req.user.organisation_id || null],
  );
  return new Map(q.rows.map((r) => [String(r.id), r.display_name || r.name || 'another account']));
}

/**
 * GET — the current link and the choices this account may make.
 * `options[].selectable` is a UI convenience; PUT re-checks everything.
 */
router.get('/api/splose/my-practitioner', safe(async (req, res) => {
  const [practitioners, claimed] = await Promise.all([sploseApi.getPractitioners(), claimedByOthers(req)]);
  const own = req.user.tp_splose_practitioner_id ? String(req.user.tp_splose_practitioner_id) : null;
  const me = lower(req.user.email);
  const options = (practitioners || []).map((p) => {
    const id = String(p.id);
    const emailMatch = !!p.email && lower(p.email) === me;
    const claimedBy = claimed.get(id) || null;
    return {
      id,
      fullName: p.fullName || `${p.firstname || ''} ${p.lastname || ''}`.trim() || id,
      emailMatch,
      claimedBy,
      selectable: !claimedBy && emailMatch,
    };
  });
  const linked = own ? (options.find((o) => o.id === own) || { id: own, fullName: 'Practitioner ' + own }) : null;
  // `matchCount` tells the UI whether there is anything this person CAN
  // link; zero means the owner must fix the email in Splose or link them.
  res.json({ linked, options, canChooseAny: false, matchCount: options.filter((o) => o.emailMatch).length, email: me });
}));

/** PUT { practitionerId } — link this account to one Splose practitioner. */
router.put('/api/splose/my-practitioner', safe(async (req, res) => {
  const id = String(req.body?.practitionerId || '').trim();
  if (!id || id.length > 64) return res.status(400).json({ error: 'practitionerId is required', code: 'invalid_practitioner' });

  const practitioners = await sploseApi.getPractitioners();
  const p = (practitioners || []).find((x) => String(x.id) === id);
  if (!p) return res.status(404).json({ error: 'That practitioner is not in Splose', code: 'practitioner_not_found' });

  if (lower(p.email) !== lower(req.user.email)) {
    return res.status(403).json({
      error: 'You can only link the Splose practitioner whose email matches your portal sign-in. Ask the practice owner to link a different one.',
      code: 'practitioner_email_mismatch',
    });
  }

  const claimed = await claimedByOthers(req);
  if (claimed.has(id)) {
    return res.status(409).json({
      error: 'That practitioner is already linked to another account. The practice owner can move it.',
      code: 'practitioner_already_linked',
    });
  }

  await db.upsertTherapistProfile({
    userId: req.user.id,
    organisationId: req.user.organisation_id || null,
    displayName: req.user.display_name || req.user.name || p.fullName || 'Therapist',
    splosePractitionerId: id,
  });
  await db.logAuditEvent({
    actorUserId: req.user.id, organisationId: req.user.organisation_id || null,
    action: 'splose.practitioner_linked', targetType: 'splose_practitioner', targetId: id,
    metadata: { self: true, previous: req.user.tp_splose_practitioner_id || null }, ipAddress: req.ip,
  }).catch(() => {});
  res.json({ ok: true, linked: { id, fullName: p.fullName || id } });
}));

/** DELETE — disconnect this account from its Splose practitioner. */
router.delete('/api/splose/my-practitioner', safe(async (req, res) => {
  const previous = req.user.tp_splose_practitioner_id || null;
  await db.pool.query(
    'UPDATE therapist_profiles SET splose_practitioner_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1',
    [req.user.id],
  );
  await db.logAuditEvent({
    actorUserId: req.user.id, organisationId: req.user.organisation_id || null,
    action: 'splose.practitioner_unlinked', targetType: 'splose_practitioner', targetId: previous,
    metadata: { self: true }, ipAddress: req.ip,
  }).catch(() => {});
  res.json({ ok: true, linked: null });
}));

// ── Owner links a practitioner to ANOTHER person (Settings → Users & Roles) ──
// The explicit act on someone else's profile that the self-service rule
// defers to. Same fail-closed checks minus the email match: the practitioner
// must exist in Splose and must not be claimed by a different active account.
// A missing therapist profile is created on the way. Audited with ids only,
// `self: false`, and the target user id.

router.use('/api/admin/people/:userId/splose-link', requireAuth, requireRole('owner'));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadTargetUser(req, res) {
  const userId = String(req.params.userId || '');
  if (!UUID_RE.test(userId)) { res.status(400).json({ error: 'Invalid user id', code: 'invalid_user' }); return null; }
  const q = await db.pool.query(
    `SELECT u.id, u.email, u.name, u.display_name, u.organisation_id, u.is_active,
            tp.splose_practitioner_id
       FROM users u LEFT JOIN therapist_profiles tp ON tp.user_id = u.id
      WHERE u.id = $1`, [userId]);
  const target = q.rows[0];
  if (!target || (target.organisation_id || null) !== (req.user.organisation_id || null)) {
    res.status(404).json({ error: 'That person is not in your practice', code: 'user_not_found' });
    return null;
  }
  return target;
}

router.put('/api/admin/people/:userId/splose-link', safe(async (req, res) => {
  const target = await loadTargetUser(req, res);
  if (!target) return;
  const id = String(req.body?.practitionerId || '').trim();
  if (!id || id.length > 64) return res.status(400).json({ error: 'practitionerId is required', code: 'invalid_practitioner' });

  const practitioners = await sploseApi.getPractitioners();
  const p = (practitioners || []).find((x) => String(x.id) === id);
  if (!p) return res.status(404).json({ error: 'That practitioner is not in Splose', code: 'practitioner_not_found' });

  const claimed = await db.pool.query(
    `SELECT u.name, u.display_name
       FROM therapist_profiles tp JOIN users u ON u.id = tp.user_id
      WHERE tp.splose_practitioner_id = $1 AND tp.user_id <> $2 AND u.is_active = TRUE
        AND u.organisation_id IS NOT DISTINCT FROM $3
      LIMIT 1`, [id, target.id, req.user.organisation_id || null]);
  if (claimed.rows[0]) {
    const who = claimed.rows[0].display_name || claimed.rows[0].name || 'another account';
    return res.status(409).json({ error: `That practitioner is already linked to ${who}. Disconnect it there first.`, code: 'practitioner_already_linked' });
  }

  await db.upsertTherapistProfile({
    userId: target.id,
    organisationId: target.organisation_id || null,
    displayName: target.display_name || target.name || p.fullName || 'Therapist',
    splosePractitionerId: id,
  });
  await db.logAuditEvent({
    actorUserId: req.user.id, organisationId: req.user.organisation_id || null,
    action: 'splose.practitioner_linked', targetType: 'splose_practitioner', targetId: id,
    metadata: { self: false, userId: target.id, previous: target.splose_practitioner_id || null }, ipAddress: req.ip,
  }).catch(() => {});
  res.json({ ok: true, linked: { id, fullName: p.fullName || id } });
}));

router.delete('/api/admin/people/:userId/splose-link', safe(async (req, res) => {
  const target = await loadTargetUser(req, res);
  if (!target) return;
  const previous = target.splose_practitioner_id ? String(target.splose_practitioner_id) : null;
  await db.pool.query(
    'UPDATE therapist_profiles SET splose_practitioner_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1',
    [target.id],
  );
  await db.logAuditEvent({
    actorUserId: req.user.id, organisationId: req.user.organisation_id || null,
    action: 'splose.practitioner_unlinked', targetType: 'splose_practitioner', targetId: previous,
    metadata: { self: false, userId: target.id }, ipAddress: req.ip,
  }).catch(() => {});
  res.json({ ok: true, linked: null });
}));

// ── The practice's Splose connection (Owner only) ───────────────────────────
// One API key for the whole practice. The Owner can see where it comes from,
// connect a new key (proved against Splose before it is stored) or
// disconnect. The key is never returned, never logged, never echoed.

router.use('/api/splose/connection', requireAuth, requireRole('owner'));

router.get('/api/splose/connection', safe(async (req, res) => {
  res.json(await sploseCredentials.status());
}));

router.put('/api/splose/connection', safe(async (req, res) => {
  const apiKey = String(req.body?.apiKey || '').trim();
  const label = String(req.body?.label || '').trim().slice(0, 120) || null;
  if (!apiKey || apiKey.length < 16 || apiKey.length > 512 || /\s/.test(apiKey)) {
    return res.status(400).json({ error: 'That does not look like a Splose API key', code: 'invalid_api_key' });
  }
  let proof;
  try {
    proof = await sploseApi.testKey(apiKey);
  } catch (err) {
    const status = err.response?.status;
    return res.status(422).json({
      error: status === 401 || status === 403 ? 'Splose rejected that key' : 'Splose could not be reached with that key',
      code: 'api_key_rejected',
    });
  }
  const conn = await sploseCredentials.connect({ apiKey, label, userId: req.user.id });
  await db.logAuditEvent({
    actorUserId: req.user.id, organisationId: req.user.organisation_id || null,
    action: 'splose.connected', targetType: 'integration', targetId: 'splose',
    metadata: { practitioners: proof.practitioners, label }, ipAddress: req.ip,
  }).catch(() => {});
  const { key, ...safeConn } = conn; // eslint-disable-line no-unused-vars
  res.json({ ok: true, connection: safeConn, practitioners: proof.practitioners, names: proof.names });
}));

router.delete('/api/splose/connection', safe(async (req, res) => {
  const conn = await sploseCredentials.disconnect({ userId: req.user.id });
  await db.logAuditEvent({
    actorUserId: req.user.id, organisationId: req.user.organisation_id || null,
    action: 'splose.disconnected', targetType: 'integration', targetId: 'splose',
    metadata: {}, ipAddress: req.ip,
  }).catch(() => {});
  const { key, ...safeConn } = conn; // eslint-disable-line no-unused-vars
  res.json({ ok: true, connection: safeConn });
}));

module.exports = router;
