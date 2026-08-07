'use strict';

/**
 * TRAVEL LOGBOOK — read-only, role-scoped aggregation over Splose data.
 *
 * Why this exists (RBAC hardening, 2026-08-06): the logbook UI previously
 * assembled itself in the browser from GET /api/splose/support-items — an
 * owner/admin-only endpoint — so therapists silently saw an empty logbook,
 * and the only way to give them one would have been opening the whole
 * practice's support items to every role. This endpoint does the join
 * server-side and scopes rows to the caller:
 *
 *   owner/admin → every travel entry in the requested financial-year window
 *   therapist   → only entries whose linked appointment belongs to their own
 *                 Splose practitioner (fail-closed 403 when unmapped)
 *   read_only   → 403 (practice-management data)
 *
 * Strictly read-only toward Splose (GET-backed sploseApi calls only).
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('./permissions');
const sploseApi = require('./splose-api');
const { pool } = require('./database');

function denyReadOnly(req, res, next) {
  if (req.user?.role === 'read_only') {
    return res.status(403).json({
      error: 'Read-only accounts cannot access practice-management data',
      code: 'travel_read_only_denied',
    });
  }
  next();
}

/** Org kilometre rate (owner-configurable in Settings); ATO default fallback. */
async function orgKilometreRate() {
  try {
    const r = await pool.query(`SELECT settings FROM org_settings WHERE org_id = 'opal' LIMIT 1`);
    const rate = Number(r.rows[0]?.settings?.kilometreRate);
    return Number.isFinite(rate) && rate > 0 ? rate : 0.88;
  } catch (_) {
    return 0.88;
  }
}

// GET /api/travel/logbook?fy=2026
// Returns { entries, kilometreRate, scope } for the FY window (1 Jul → 30 Jun).
router.get('/api/travel/logbook', requireAuth, denyReadOnly, async (req, res) => {
  try {
    const role = req.user.role;
    let scopedPractitionerId = null;
    if (role !== 'owner' && role !== 'admin') {
      scopedPractitionerId = req.user.tp_splose_practitioner_id || null;
      if (!scopedPractitionerId) {
        return res.status(403).json({
          error: 'Your account is not linked to a Splose practitioner yet. Ask the practice owner to complete your therapist profile.',
          code: 'practitioner_mapping_required',
        });
      }
    }

    const fy = parseInt(req.query.fy, 10) || (new Date().getMonth() >= 6
      ? new Date().getFullYear() + 1
      : new Date().getFullYear());
    const start = `${fy - 1}-07-01`;
    const today = new Date().toISOString().slice(0, 10);
    const fyEnd = `${fy}-06-30`;
    const end = today < fyEnd ? today : fyEnd;

    const [items, appointments, kilometreRate] = await Promise.all([
      sploseApi.getSupportItems(),
      sploseApi.getAppointments(start, end, scopedPractitionerId),
      orgKilometreRate(),
    ]);

    const apptById = new Map((appointments || []).map((a) => [String(a.id), a]));

    const entries = (items || [])
      .filter((i) => !i.deletedAt)
      .filter((i) => String(i.type || '').toLowerCase().includes('travel') && i.appointmentAddress)
      .map((i) => {
        const appt = i.appointmentId ? apptById.get(String(i.appointmentId)) : null;
        // Therapist scope: getAppointments above was already practitioner-
        // filtered, so an item whose appointment isn't in the map either
        // belongs to someone else or sits outside the FY window — drop it.
        if (scopedPractitionerId && !appt) return null;
        const toMinutes = Number(i.toMinutes) || 0;
        const returnMinutes = Number(i.returnMinutes) || 0;
        const totalMinutes = toMinutes + returnMinutes;
        const estKm = Math.round((totalMinutes / 60) * 40 * 10) / 10; // 40 km/h average
        return {
          id: i.id,
          date: appt?.start || i.createdAt || null,
          type: i.type,
          destinationAddress: i.appointmentAddress,
          toMinutes,
          returnMinutes,
          totalMinutes,
          estKm,
          source: 'splose',
          appointmentId: i.appointmentId || null,
          appointmentTitle: appt?.title || null,
          appointmentStart: appt?.start || null,
          appointmentEnd: appt?.end || null,
          practitionerId: appt?.practitionerId || null,
          createdAt: i.createdAt || null,
          calculationStatus: i.appointmentAddress ? 'estimated' : 'address_missing',
        };
      })
      .filter(Boolean)
      .filter((e) => !e.date || (e.date.slice(0, 10) >= start && e.date.slice(0, 10) <= fyEnd));

    // Local address overrides (migration 009): practice-level overlay keyed
    // by Splose item id. Splose data stays untouched; the original address is
    // preserved as sourceDestination.
    if (entries.length) {
      const ids = entries.map((e) => String(e.id));
      const ov = await pool.query(
        'SELECT splose_item_id, from_address, to_address FROM travel_address_overrides WHERE splose_item_id = ANY($1)', [ids]);
      const byId = new Map(ov.rows.map((r) => [r.splose_item_id, r]));
      entries.forEach((e) => {
        const o = byId.get(String(e.id));
        e.fromAddress = (o && o.from_address) || null;
        if (o && (o.from_address || o.to_address)) e.addressEdited = true;
        if (o && o.to_address) {
          e.sourceDestination = e.destinationAddress;
          e.destinationAddress = o.to_address;
          e.calculationStatus = 'estimated';
        }
      });
    }

    entries.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    res.json({
      fy,
      entries,
      kilometreRate,
      scope: scopedPractitionerId ? 'own' : 'practice',
      calculationMethod: 'Splose travel minutes converted at a 40 km/h average speed; deduction = km × the practice kilometre rate.',
    });
  } catch (err) {
    console.error('travel logbook error:', err.message);
    res.status(502).json({ error: 'Could not load travel data from Splose', code: 'splose_unavailable' });
  }
});

// PATCH /api/travel/logbook/:itemId/addresses — local override only; never
// writes to Splose/Outlook. Owner/admin: any entry. Therapist: only items
// visible in their own scoped logbook (fail-closed via the same fetch).
router.patch('/api/travel/logbook/:itemId/addresses', requireAuth, denyReadOnly, async (req, res) => {
  try {
    const itemId = String(req.params.itemId || '').trim();
    if (!itemId || itemId.length > 100) return res.status(404).json({ error: 'Not found' });
    const { fromAddress, toAddress } = req.body || {};
    if (fromAddress === undefined && toAddress === undefined) {
      return res.status(400).json({ error: 'Provide fromAddress and/or toAddress' });
    }
    const clean = (v) => {
      if (v === undefined) return undefined;
      const t = String(v).slice(0, 500).trim();
      return t.length ? t : null; // blank clears the override for that leg
    };
    const fromV = clean(fromAddress);
    const toV = clean(toAddress);

    const role = req.user.role;
    if (role !== 'owner' && role !== 'admin') {
      const own = req.user.tp_splose_practitioner_id || null;
      if (!own) return res.status(403).json({ code: 'practitioner_mapping_required', error: 'No linked practitioner' });
      const [items, appts] = await Promise.all([
        sploseApi.getSupportItems(),
        sploseApi.getAppointments('2000-01-01', new Date().toISOString().slice(0, 10), own),
      ]);
      const apptIds = new Set((appts || []).map((a) => String(a.id)));
      const mine = (items || []).some((i) => String(i.id) === itemId && i.appointmentId && apptIds.has(String(i.appointmentId)));
      if (!mine) return res.status(404).json({ error: 'Not found' });
    }

    const r = await pool.query(
      `INSERT INTO travel_address_overrides (splose_item_id, organisation_id, from_address, to_address, updated_by_user_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (splose_item_id) DO UPDATE SET
         from_address = CASE WHEN $6 THEN EXCLUDED.from_address ELSE travel_address_overrides.from_address END,
         to_address   = CASE WHEN $7 THEN EXCLUDED.to_address   ELSE travel_address_overrides.to_address END,
         updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = NOW()
       RETURNING splose_item_id, from_address, to_address`,
      [itemId, req.user.organisation_id || null,
       fromV === undefined ? null : fromV, toV === undefined ? null : toV,
       req.user.id, fromAddress !== undefined, toAddress !== undefined]);
    await require('./database').logAuditEvent({
      actorUserId: req.user.id, action: 'travel.address_overridden',
      targetType: 'travel_entry', targetId: null, ipAddress: req.ip,
      organisationId: req.user.organisation_id || null,
      metadata: { itemId },
    }).catch(() => {});
    res.json({ ok: true, override: r.rows[0] });
  } catch (err) {
    console.error('travel address override error:', err.message);
    res.status(500).json({ error: 'Could not save the address change' });
  }
});

module.exports = router;
