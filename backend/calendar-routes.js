/**
 * MULTI-THERAPIST CALENDAR ROUTES
 *
 * Provides therapist profile management and multi-therapist calendar queries.
 * All routes enforce permission rules server-side via calendar-permissions.js.
 *
 * Endpoints:
 *   GET  /api/therapists                 — list all therapist profiles (owner/admin)
 *   GET  /api/therapists/me              — get own therapist profile
 *   GET  /api/therapists/:id             — get a specific profile (owner/admin or self)
 *   POST /api/therapists                 — create a therapist profile (owner only)
 *   PUT  /api/therapists/:id             — update a profile (owner or self)
 *
 *   GET  /api/calendar/events            — events for one or more therapists
 *   GET  /api/calendar/master            — merged master calendar (owner/admin only)
 *   GET  /api/calendar/availability      — free/busy grid for selected therapists
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('./database');

const {
  canViewMasterCalendar,
  canViewTherapistCalendar,
  canManageTherapistSchedule,
  canViewFinancials,
  stripFinancials,
  filterEventsForUser,
  requireMasterCalendarAccess,
} = require('./calendar-permissions');

// ── Auth middleware (re-uses the one in routes.js via shared session) ───────
// Routes here run after server.js has mounted requireAuth on the session,
// so we just define a local guard that checks req.session and loads the user.
const { getPermissions } = require('./permissions');

async function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    if (!req.user) {
      const user = await db.getUser(req.session.userId);
      if (!user || user.is_active === false) {
        req.session.destroy(() => {});
        return res.status(401).json({ error: 'Session expired or account inactive' });
      }
      user.permissions = getPermissions(user.role, user.permissions || []);
      req.user = user;
    }
    next();
  } catch (err) {
    console.error('requireAuth error:', err);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied', required: roles });
    }
    next();
  };
}

// ── Helper: resolve and validate therapistIds from query params ─────────────
function parseTherapistIds(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(',');
  return arr.map(s => s.trim()).filter(Boolean);
}

// ── Helper: format event for API response ──────────────────────────────────
function formatEvent(ev, user) {
  const base = {
    id:                 ev.id,
    therapistProfileId: ev.therapist_profile_id,
    therapistName:      ev.therapist_name      || null,
    therapistColour:    ev.therapist_colour    || null,
    therapistRoleTitle: ev.therapist_role_title || null,
    organisationId:     ev.organisation_id,
    title:              ev.title,
    start:              ev.start_time,
    end:                ev.end_time,
    location:           ev.location,
    eventType:          ev.event_type,
    source:             ev.source,
    outlookId:          ev.outlook_id,
    sploseId:           ev.splose_id,
    clientName:         ev.client_name,
    categories:         ev.categories,
    isDeleted:          ev.is_deleted,
    isCancelled:        ev.status === 'cancelled',
    manualLocation:     ev.manual_location,
    createdAt:          ev.created_at,
    updatedAt:          ev.updated_at,
  };
  return stripFinancials(base, user);
}

// ══════════════════════════════════════════════════════════════════════════════
// THERAPIST PROFILE ROUTES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/therapists
 * List all active therapist profiles for the organisation.
 * Owner and Admin only.
 */
router.get('/api/therapists', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const orgId = req.user.organisation_id;
    if (!orgId) return res.status(400).json({ error: 'User has no organisation assigned' });

    const profiles = await db.getAllTherapistProfiles(orgId);
    res.json({ profiles });
  } catch (err) {
    console.error('GET /api/therapists error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/therapists/me
 * Get the logged-in user's own therapist profile. Returns 404 if they don't have one.
 */
router.get('/api/therapists/me', requireAuth, async (req, res) => {
  try {
    const profile = await db.getTherapistProfile(req.user.id);
    if (!profile) return res.status(404).json({ error: 'No therapist profile for this account' });
    res.json({ profile });
  } catch (err) {
    console.error('GET /api/therapists/me error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/therapists/:id
 * Get a specific therapist profile by its UUID.
 * Owner/Admin can view any. Therapist can only view their own.
 */
router.get('/api/therapists/:id', requireAuth, async (req, res) => {
  try {
    const profile = await db.getTherapistProfileById(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Therapist profile not found' });

    if (!canViewTherapistCalendar(req.user, profile.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({ profile });
  } catch (err) {
    console.error('GET /api/therapists/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/therapists
 * Create a therapist profile for a user.
 * Owner only. The target user must exist and have isTreatingTherapist=true (or owner sets it).
 *
 * Body: { userId, displayName, roleTitle?, colour?, splosePractitionerId? }
 */
router.post('/api/therapists', requireAuth, requireRole('owner'), async (req, res) => {
  try {
    const { userId, displayName, roleTitle, colour, splosePractitionerId, outlookCalendarId } = req.body;
    if (!userId || !displayName) {
      return res.status(400).json({ error: 'userId and displayName are required' });
    }

    // Ensure the target user belongs to the same org
    const targetUser = await db.getUser(userId);
    if (!targetUser) return res.status(404).json({ error: 'Target user not found' });
    if (targetUser.organisation_id !== req.user.organisation_id) {
      return res.status(403).json({ error: 'Target user is not in your organisation' });
    }

    const profile = await db.upsertTherapistProfile({
      userId,
      organisationId:       req.user.organisation_id,
      displayName,
      roleTitle:            roleTitle            || null,
      colour:               colour               || '#5b6af0',
      splosePractitionerId: splosePractitionerId || null,
      outlookCalendarId:    outlookCalendarId    || null,
    });

    // Mark the user as a treating therapist and link the profile ID
    await db.pool.query(`
      UPDATE users
      SET is_treating_therapist = TRUE,
          therapist_profile_id  = $1,
          updated_at            = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [profile.id, userId]);

    // Backfill existing events for this user
    const backfilled = await db.backfillEventTherapistProfile(
      userId, profile.id, req.user.organisation_id
    );

    await db.logAuditEvent({
      actorUserId:    req.user.id,
      action:         'therapist_profile_created',
      targetType:     'therapist_profile',
      targetId:       profile.id,
      metadata:       { displayName, userId },
      organisationId: req.user.organisation_id,
    });

    res.json({ profile, backfilledEvents: backfilled });
  } catch (err) {
    console.error('POST /api/therapists error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/therapists/:id
 * Update a therapist profile.
 * Owner can update any. Therapist can update their own (limited fields).
 *
 * Body: { displayName?, roleTitle?, colour?, splosePractitionerId?, outlookCalendarId?, defaultWorkLocationId? }
 */
router.put('/api/therapists/:id', requireAuth, async (req, res) => {
  try {
    const profile = await db.getTherapistProfileById(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Therapist profile not found' });

    if (!canManageTherapistSchedule(req.user, profile.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { displayName, roleTitle, colour, splosePractitionerId, outlookCalendarId, defaultWorkLocationId } = req.body;

    const updated = await db.upsertTherapistProfile({
      userId:               profile.user_id,
      organisationId:       profile.organisation_id,
      displayName:          displayName            || profile.display_name,
      roleTitle:            roleTitle              !== undefined ? roleTitle            : profile.role_title,
      colour:               colour                 !== undefined ? colour               : profile.colour,
      splosePractitionerId: splosePractitionerId   !== undefined ? splosePractitionerId : profile.splose_practitioner_id,
      outlookCalendarId:    outlookCalendarId      !== undefined ? outlookCalendarId    : profile.outlook_calendar_id,
      defaultWorkLocationId: defaultWorkLocationId !== undefined ? defaultWorkLocationId : profile.default_work_location_id,
    });

    res.json({ profile: updated });
  } catch (err) {
    console.error('PUT /api/therapists/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// CALENDAR EVENT ROUTES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/calendar/events
 * Fetch events for one or more therapists.
 * Query params:
 *   therapistIds  — comma-separated UUID list (owner/admin can pass any; therapist limited to own)
 *   startDate     — ISO date string (inclusive)
 *   endDate       — ISO date string (inclusive)
 *
 * Backend enforces: therapist can only receive their own events.
 */
router.get('/api/calendar/events', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const requestedIds = parseTherapistIds(req.query.therapistIds || req.query.therapistId);

    // Resolve which therapist profile IDs to fetch
    let therapistProfileIds;
    if (req.user.role === 'therapist') {
      // Therapist always gets only their own — ignore any requested IDs
      if (!req.user.therapist_profile_id) {
        return res.json({ events: [] });
      }
      therapistProfileIds = [req.user.therapist_profile_id];
    } else if (requestedIds.length > 0) {
      // Owner/Admin: validate all requested IDs are accessible (same org)
      const orgProfiles = await db.getAllTherapistProfiles(req.user.organisation_id);
      const validIds = new Set(orgProfiles.map(p => p.id));
      therapistProfileIds = requestedIds.filter(id => validIds.has(id));
    } else {
      // Owner/Admin with no filter: return all therapists in org
      const orgProfiles = await db.getAllTherapistProfiles(req.user.organisation_id);
      therapistProfileIds = orgProfiles.map(p => p.id);
    }

    if (therapistProfileIds.length === 0) {
      return res.json({ events: [] });
    }

    const events = await db.getEventsForTherapists(therapistProfileIds, {
      startDate: startDate || null,
      endDate:   endDate   || null,
    });

    res.json({
      events:      events.map(ev => formatEvent(ev, req.user)),
      therapistIds: therapistProfileIds,
      count:       events.length,
    });
  } catch (err) {
    console.error('GET /api/calendar/events error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/calendar/master
 * Owner/Admin only. Returns all events across all therapists in the org,
 * merged and tagged with therapist identity for the Master Calendar view.
 * Query params: startDate, endDate, therapistIds (optional filter)
 */
router.get('/api/calendar/master', requireAuth, requireMasterCalendarAccess, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const requestedIds = parseTherapistIds(req.query.therapistIds || req.query.therapistId);

    const orgProfiles = await db.getAllTherapistProfiles(req.user.organisation_id);
    const validIds    = new Set(orgProfiles.map(p => p.id));

    const therapistProfileIds = requestedIds.length > 0
      ? requestedIds.filter(id => validIds.has(id))
      : orgProfiles.map(p => p.id);

    if (therapistProfileIds.length === 0) {
      return res.json({ events: [], therapists: orgProfiles, count: 0 });
    }

    const events = await db.getEventsForTherapists(therapistProfileIds, {
      startDate: startDate || null,
      endDate:   endDate   || null,
    });

    // Build therapist lookup for the UI (colour, name, initials)
    const therapists = orgProfiles.map(p => ({
      id:          p.id,
      displayName: p.display_name,
      roleTitle:   p.role_title,
      colour:      p.colour,
      initials:    (p.display_name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase(),
      email:       p.user_email,
      hasOutlook:  p.has_outlook_connected,
    }));

    res.json({
      events:    events.map(ev => formatEvent(ev, req.user)),
      therapists,
      count:     events.length,
    });
  } catch (err) {
    console.error('GET /api/calendar/master error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/calendar/availability
 * Owner/Admin only. Returns free/busy grid for selected therapists.
 * Used by the Scheduling Assistant view.
 *
 * Query params:
 *   therapistIds  — comma-separated; required
 *   startDate     — ISO date string; required
 *   endDate       — ISO date string; required
 */
router.get('/api/calendar/availability', requireAuth, requireMasterCalendarAccess, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const requestedIds = parseTherapistIds(req.query.therapistIds || req.query.therapistId);
    const orgProfiles  = await db.getAllTherapistProfiles(req.user.organisation_id);
    const validIds     = new Set(orgProfiles.map(p => p.id));

    const therapistProfileIds = requestedIds.length > 0
      ? requestedIds.filter(id => validIds.has(id))
      : orgProfiles.map(p => p.id);

    if (therapistProfileIds.length === 0) {
      return res.json({ availability: [] });
    }

    const availability = await db.getTherapistAvailability(
      therapistProfileIds, new Date(startDate), new Date(endDate)
    );

    res.json({ availability, startDate, endDate });
  } catch (err) {
    console.error('GET /api/calendar/availability error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/calendar/therapists-summary
 * Quick summary of all therapists with their event count for the current week.
 * Used to populate the therapist selector chip list in the Master Calendar sidebar.
 * Owner/Admin only.
 */
router.get('/api/calendar/therapists-summary', requireAuth, requireMasterCalendarAccess, async (req, res) => {
  try {
    const orgId = req.user.organisation_id;
    if (!orgId) return res.status(400).json({ error: 'No organisation' });

    const profiles = await db.getAllTherapistProfiles(orgId);

    // For each profile, count events in the requested window
    const { startDate, endDate } = req.query;
    const summaries = await Promise.all(profiles.map(async p => {
      let eventCount = 0;
      if (startDate && endDate) {
        const r = await db.pool.query(
          `SELECT COUNT(*) FROM events
           WHERE therapist_profile_id = $1
             AND (is_deleted IS NULL OR is_deleted = FALSE)
             AND start_time >= $2 AND end_time <= $3`,
          [p.id, new Date(startDate), new Date(endDate)]
        );
        eventCount = parseInt(r.rows[0].count, 10);
      }
      return {
        id:          p.id,
        displayName: p.display_name,
        roleTitle:   p.role_title,
        colour:      p.colour,
        initials:    (p.display_name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase(),
        email:       p.user_email,
        hasOutlook:  p.has_outlook_connected,
        eventCount,
      };
    }));

    res.json({ therapists: summaries });
  } catch (err) {
    console.error('GET /api/calendar/therapists-summary error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
