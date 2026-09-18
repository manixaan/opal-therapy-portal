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
 *   • a therapist may link ONLY the practitioner whose Splose email matches
 *     their portal email (case-insensitive) — anything else is the owner's
 *     call via PUT /api/therapists/:id;
 *   • owner/admin may link any practitioner, but never one already linked
 *     to another account in the practice — one person, one identity;
 *   • unlinking is explicit (DELETE) — the upsert helper's COALESCE never
 *     clears the column, and nothing else may.
 *
 * Every link and unlink is audited with ids only.
 */

const express = require('express');
const db = require('./database');
const sploseApi = require('./splose-api');
const { requireAuth } = require('./permissions');

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
const canChooseAny = (user) => user.role === 'owner' || user.role === 'admin';

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
  const any = canChooseAny(req.user);
  const options = (practitioners || []).map((p) => {
    const id = String(p.id);
    const emailMatch = !!p.email && lower(p.email) === me;
    const claimedBy = claimed.get(id) || null;
    return {
      id,
      fullName: p.fullName || `${p.firstname || ''} ${p.lastname || ''}`.trim() || id,
      emailMatch,
      claimedBy,
      selectable: !claimedBy && (any || emailMatch),
    };
  });
  const linked = own ? (options.find((o) => o.id === own) || { id: own, fullName: 'Practitioner ' + own }) : null;
  res.json({ linked, options, canChooseAny: any });
}));

/** PUT { practitionerId } — link this account to one Splose practitioner. */
router.put('/api/splose/my-practitioner', safe(async (req, res) => {
  const id = String(req.body?.practitionerId || '').trim();
  if (!id || id.length > 64) return res.status(400).json({ error: 'practitionerId is required', code: 'invalid_practitioner' });

  const practitioners = await sploseApi.getPractitioners();
  const p = (practitioners || []).find((x) => String(x.id) === id);
  if (!p) return res.status(404).json({ error: 'That practitioner is not in Splose', code: 'practitioner_not_found' });

  if (!canChooseAny(req.user) && lower(p.email) !== lower(req.user.email)) {
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

module.exports = router;
