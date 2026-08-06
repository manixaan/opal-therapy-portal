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

module.exports = router;
