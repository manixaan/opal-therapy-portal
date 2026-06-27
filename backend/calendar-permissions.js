/**
 * CALENDAR PERMISSION ENFORCEMENT
 *
 * All functions here are called server-side before returning any calendar data.
 * Never rely on the frontend to hide calendars — enforce here.
 *
 * Role summary:
 *   owner     — full access: all calendars, all data, financial info
 *   admin     — full operational access: all calendars, no financial data
 *   therapist — own calendar only, own appointments only
 */

'use strict';

// ── Core role checks ────────────────────────────────────────────────────────

/**
 * Can this user see the Master Calendar (all therapists combined)?
 * Owner and Admin only.
 */
function canViewMasterCalendar(user) {
  return user && ['owner', 'admin'].includes(user.role);
}

/**
 * Can this user view events belonging to a specific therapist profile?
 * - Owner/Admin: yes, always.
 * - Therapist: only if the profile ID matches their own.
 */
function canViewTherapistCalendar(user, therapistProfileId) {
  if (!user || !therapistProfileId) return false;
  if (['owner', 'admin'].includes(user.role)) return true;
  if (user.role === 'therapist') {
    return String(user.therapist_profile_id) === String(therapistProfileId);
  }
  return false;
}

/**
 * Can this user manage (create/edit/delete) appointments for a therapist?
 * - Owner: yes, for any therapist.
 * - Admin: yes, for any therapist (operational management).
 * - Therapist: only for their own profile.
 */
function canManageTherapistSchedule(user, therapistProfileId) {
  if (!user) return false;
  if (['owner', 'admin'].includes(user.role)) return true;
  if (user.role === 'therapist') {
    return String(user.therapist_profile_id) === String(therapistProfileId);
  }
  return false;
}

/**
 * Can this user assign a booking to a specific therapist?
 * Only Owner and Admin can assign to others. Therapists can only self-assign.
 */
function canAssignBookingToTherapist(user, therapistProfileId) {
  if (!user) return false;
  if (['owner', 'admin'].includes(user.role)) return true;
  if (user.role === 'therapist') {
    return String(user.therapist_profile_id) === String(therapistProfileId);
  }
  return false;
}

/**
 * Can this user view a client/patient record?
 * - Owner/Admin: all clients.
 * - Therapist: only clients assigned to them (checked by caller with appointment data).
 */
function canViewClientForBooking(user) {
  return !!user && user.is_active !== false;
}

/**
 * Can this user see financial data (billing rates, NDIS plan values, invoice status)?
 * Only Owner role has financial visibility.
 */
function canViewFinancials(user) {
  return user && user.role === 'owner';
}

// ── Data sanitisation ───────────────────────────────────────────────────────

const FINANCIAL_FIELDS = [
  'billing_rate', 'travel_rate', 'ndis_plan_budget', 'ndis_plan_expiry',
  'invoice_id', 'invoice_status', 'invoice_amount', 'payment_status',
  'travel_distance', 'travelBillingRate',
];

/**
 * Strip financial fields from an event/appointment object for non-owner roles.
 */
function stripFinancials(data, user) {
  if (!data || canViewFinancials(user)) return data;
  const clean = { ...data };
  FINANCIAL_FIELDS.forEach(f => delete clean[f]);
  if (clean.custom_metadata) {
    try {
      const meta = typeof clean.custom_metadata === 'string'
        ? JSON.parse(clean.custom_metadata)
        : clean.custom_metadata;
      FINANCIAL_FIELDS.forEach(f => delete meta[f]);
      clean.custom_metadata = meta;
    } catch (_) {}
  }
  return clean;
}

/**
 * Filter and strip an array of events based on the user's permissions.
 * - Removes events the user is not allowed to see.
 * - Strips financial fields if user is not owner.
 */
function filterEventsForUser(events, user) {
  if (!events || !user) return [];

  return events
    .filter(ev => canViewTherapistCalendar(user, ev.therapist_profile_id))
    .map(ev => stripFinancials(ev, user));
}

// ── Express middleware ──────────────────────────────────────────────────────

/**
 * Middleware: require the user to be able to view the Master Calendar.
 * Returns 403 if the logged-in user is a therapist.
 */
function requireMasterCalendarAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!canViewMasterCalendar(req.user)) {
    return res.status(403).json({
      error: 'Access denied',
      reason: 'Master Calendar is only available to Owner and Admin roles.',
    });
  }
  next();
}

/**
 * Middleware: validate that the requested therapistIds are accessible to this user.
 * Reads therapistIds from query params (comma-separated or array).
 * Attaches req.allowedTherapistIds with the validated subset.
 */
function validateTherapistIds(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

  const raw = req.query.therapistIds || req.query.therapistId || '';
  const requested = Array.isArray(raw) ? raw : raw.split(',').map(s => s.trim()).filter(Boolean);

  if (requested.length === 0) {
    // No filter specified — therapist defaults to own calendar, owner/admin gets all
    if (req.user.role === 'therapist') {
      req.allowedTherapistIds = req.user.therapist_profile_id ? [req.user.therapist_profile_id] : [];
    } else {
      req.allowedTherapistIds = null; // null = all (resolved in route handler)
    }
    return next();
  }

  // Filter to only the IDs this user is allowed to see
  const allowed = requested.filter(id => canViewTherapistCalendar(req.user, id));

  if (allowed.length === 0 && requested.length > 0) {
    return res.status(403).json({
      error: 'Access denied',
      reason: 'You do not have permission to view the requested therapist calendar(s).',
    });
  }

  req.allowedTherapistIds = allowed;
  next();
}

module.exports = {
  canViewMasterCalendar,
  canViewTherapistCalendar,
  canManageTherapistSchedule,
  canAssignBookingToTherapist,
  canViewClientForBooking,
  canViewFinancials,
  stripFinancials,
  filterEventsForUser,
  requireMasterCalendarAccess,
  validateTherapistIds,
};
