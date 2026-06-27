/**
 * PERMISSIONS & ROLE-BASED ACCESS CONTROL
 *
 * Defines the three user roles (owner / admin / therapist) and maps each to
 * the permissions it grants. Provides Express middleware helpers that can be
 * dropped into any route to enforce access rules on the backend.
 *
 * IMPORTANT: Frontend role checks are UI-only conveniences.
 * These backend helpers are the authoritative enforcement layer.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  Role → permission map
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_PERMISSIONS = {
  owner: [
    'view_all_calendars',
    'view_own_calendar',
    'manage_all_schedules',
    'manage_own_schedule',
    'view_financials',
    'view_billing_without_financials',
    'manage_billing',
    'view_all_clients',
    'view_assigned_clients',
    'view_all_therapists',
    'view_own_travel',
    'view_all_travel',
    'view_own_hours',
    'view_all_hours',
    'view_own_kilometres',
    'view_all_kilometres',
    'manage_users',
    'manage_roles',
    'manage_integrations',
    'view_sync_status',
    'write_to_outlook',
    'write_to_splose',
    'view_audit_logs',
  ],

  admin: [
    'view_all_calendars',
    'manage_all_schedules',
    'view_billing_without_financials',
    'view_all_clients',
    'view_all_therapists',
    'view_all_travel',
    'view_all_hours',
    'view_all_kilometres',
    'view_sync_status',
  ],

  therapist: [
    'view_own_calendar',
    'manage_own_schedule',
    'view_assigned_clients',
    'view_own_travel',
    'view_own_hours',
    'view_own_kilometres',
    'write_to_outlook',
  ],
};

/**
 * Return the permissions array for a given role.
 * Also merges any custom per-user permissions stored in the DB.
 *
 * @param {string}   role        - 'owner' | 'admin' | 'therapist'
 * @param {string[]} [extraPerms] - additional permissions from user.permissions column
 */
function getPermissions(role, extraPerms = []) {
  const base = ROLE_PERMISSIONS[role] || [];
  if (!extraPerms || !extraPerms.length) return base;
  return [...new Set([...base, ...extraPerms])];
}

/**
 * Check whether a user object has a specific permission.
 */
function hasPermission(user, permission) {
  if (!user) return false;
  const perms = getPermissions(user.role, user.permissions || []);
  return perms.includes(permission);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Express middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * requireRole(...roles)
 * Returns middleware that allows only users whose role is in the provided list.
 *
 * Usage:
 *   router.get('/admin/users', requireAuth, requireRole('owner', 'admin'), handler);
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `This action requires one of: ${roles.join(', ')}`,
      });
    }
    next();
  };
}

/**
 * requirePermission(permission)
 * Returns middleware that allows only users who have the given permission
 * (either from their role's defaults or custom per-user grants).
 *
 * Usage:
 *   router.get('/api/financials', requireAuth, requirePermission('view_financials'), handler);
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Missing permission: ${permission}`,
      });
    }
    next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Convenience helpers (called inside route handlers, not as middleware)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Can this user view calendar events for a given therapist?
 * Owners and admins can view all. Therapists can only view their own.
 *
 * @param {object} user         - req.user from session
 * @param {string} therapistId  - the user.id of the therapist whose calendar is requested
 */
function canViewCalendar(user, therapistId) {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  return user.id === therapistId; // therapist can only see their own
}

/**
 * Can this user view financial data?
 */
function canViewFinancials(user) {
  return hasPermission(user, 'view_financials');
}

/**
 * Can this user manage (create/edit/delete) schedules for a given therapist?
 */
function canManageSchedule(user, therapistId) {
  if (!user) return false;
  if (user.role === 'owner' || user.role === 'admin') return true;
  return user.id === therapistId;
}

/**
 * Can this user view client data?
 * Owners see all clients; admins see all for scheduling; therapists see assigned only.
 * Note: actual client-level filtering happens in DB queries — this is a high-level check.
 */
function canViewClient(user) {
  return hasPermission(user, 'view_all_clients') || hasPermission(user, 'view_assigned_clients');
}

/**
 * Strip financial fields from an object (or array of objects) before sending
 * to Admin or Therapist roles. Avoids leaking revenue/billing data in API
 * responses even if a user calls the endpoint directly.
 */
const FINANCIAL_FIELDS = [
  'rate', 'billing_rate', 'invoice_amount', 'revenue', 'payment_amount',
  'gross_billings', 'net_amount', 'gst', 'claim_amount', 'ndis_amount',
  'cost', 'earnings', 'reimbursement_amount',
];

function stripFinancials(data) {
  if (Array.isArray(data)) return data.map(stripFinancials);
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const f of FINANCIAL_FIELDS) delete out[f];
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  requireAuth — session guard used by all route files
//  Exported here so every router can import it from one place instead of
//  duplicating the logic or creating a circular dependency via routes.js.
// ─────────────────────────────────────────────────────────────────────────────

async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    if (!req.user) {
      // Lazy-load db to avoid circular dependency at module init time
      const db   = require('./database');
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

// ─────────────────────────────────────────────────────────────────────────────
//  Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  ROLE_PERMISSIONS,
  getPermissions,
  hasPermission,
  requireAuth,
  requireRole,
  requirePermission,
  canViewCalendar,
  canViewFinancials,
  canManageSchedule,
  canViewClient,
  stripFinancials,
};
