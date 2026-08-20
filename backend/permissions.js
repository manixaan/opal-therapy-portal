/**
 * PERMISSIONS & ROLE-BASED ACCESS CONTROL
 *
 * Roles (least → most privileged):
 *   pre_employee — an invited new starter completing onboarding. Can reach
 *                  their own onboarding and nothing else (see the choke point
 *                  in requireAuth). Becomes a real role on activation.
 *   read_only  — view calendars and client summaries; no writes of any kind
 *   therapist  — own calendar, own schedule, assigned clients, Outlook write
 *   admin      — all calendars, all clients, operational management; no financials
 *   owner      — full access including financials, billing, users, integrations
 *
 * ONBOARDING DELEGATION. The onboarding.* permissions are NOT part of any
 * role's defaults, owner excepted. An Admin employee is not an onboarding
 * administrator: those are two different things, and the Owner grants the
 * second one permission by permission. See ONBOARDING_PERMISSIONS below.
 *
 * INTERVIEW DELEGATION. The interviews.* permissions follow the same rule for
 * the same reason: recruitment interviews carry employment information about
 * people who are not yet employees, and "this person schedules appointments"
 * says nothing about whether they should read a candidate's salary
 * expectations. See INTERVIEW_PERMISSIONS below.
 *
 * IMPORTANT: Frontend role checks are UI-only conveniences.
 * These backend helpers are the authoritative enforcement layer.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  Role → permission map
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_PERMISSIONS = {
  // read_only: view-only access — cannot write to Outlook/Splose, cannot manage
  // users, approve accounts, change settings, or edit any schedules.
  read_only: [
    'view_all_calendars',
    'view_own_calendar',
    'view_all_clients',
    'view_assigned_clients',
    'view_all_therapists',
    'view_own_travel',
    'view_all_travel',
    'view_own_hours',
    'view_all_hours',
    'view_own_kilometres',
    'view_all_kilometres',
    'view_sync_status',
  ],

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

  // RBAC 2026-08-06: admin is a focused scheduling + travel role. No billing,
  // contacts, activity, NDIS/dormant, accounting, resources, settings or team
  // controls — routes enforce this independently; this list mirrors it for
  // the frontend's currentUserCan().
  admin: [
    'view_all_calendars',
    'manage_all_schedules',
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

  // An invited new starter, part-way through onboarding. They hold NO business
  // permission at all: their access is defined entirely by the pre-employee
  // path allowlist enforced in requireAuth below, not by anything they can be
  // granted here. Activation replaces this role with a real one.
  pre_employee: [],
};

// ─────────────────────────────────────────────────────────────────────────────
//  Onboarding delegation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The permissions the Owner may delegate for the Onboarding Packages module.
 *
 * These are deliberately absent from every role's defaults except owner. An
 * "Admin employee" (someone whose JOB is administration) and an "onboarding
 * administrator" (someone the Owner has authorised to handle new-starter
 * paperwork) are two different things, and conflating them would hand every
 * scheduler a colleague's bank details.
 *
 * The three tiers below are ordered by how much damage a mistaken grant does.
 * Nothing implies anything else: holding `onboarding.review` does not confer
 * `onboarding.payroll`. Each is checked independently at the route.
 */
const ONBOARDING_PERMISSIONS = [
  // Operational — chase, assign, and see progress
  'onboarding.view',              // see the module, dashboards and progress
  'onboarding.assign',            // assign a package and release an invitation
  'onboarding.review',            // read submissions, approve non-statutory items
  'onboarding.verify',            // record a statutory/credential verification
  'onboarding.activate',          // convert a pre-employee into staff

  // Configuration — change what everyone is asked for
  'onboarding.manage_packages',   // author packages, templates, publish versions
  'onboarding.manage_documents',  // document library, versions, ZIP import
  'onboarding.manage_compliance', // compliance registry + organisational records

  // Sensitive — the two that expose regulated personal data
  'onboarding.payroll',           // bank, tax/TFN and superannuation records
  'onboarding.sensitive_identity',// identity documents, visa/work-rights evidence

  'onboarding.audit',             // onboarding audit history and record exports
];

/** Grouped for the Owner's delegation UI; the grouping carries the warning. */
const ONBOARDING_PERMISSION_GROUPS = [
  {
    key: 'operational',
    label: 'Day-to-day onboarding',
    description: 'Run onboarding for new starters without seeing regulated personal data.',
    permissions: ['onboarding.view', 'onboarding.assign', 'onboarding.review', 'onboarding.verify', 'onboarding.activate'],
  },
  {
    key: 'configuration',
    label: 'Configuration',
    description: 'Change what every new starter is asked to complete.',
    permissions: ['onboarding.manage_packages', 'onboarding.manage_documents', 'onboarding.manage_compliance'],
  },
  {
    key: 'sensitive',
    label: 'Sensitive personal data',
    description: 'Grant only to people who genuinely process payroll or verify identity. '
      + 'These permissions expose tax file numbers, bank details and identity documents.',
    permissions: ['onboarding.payroll', 'onboarding.sensitive_identity', 'onboarding.audit'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Interview Preparation delegation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The permissions the Owner may delegate for Interview Preparation.
 *
 * Absent from every role's defaults except owner. Recruitment interviews hold
 * employment information — salary expectations, reference-check decisions,
 * an interviewer's written concerns — about people who are not employees and
 * never may be. An Admin holds this only because the Owner decided that
 * person conducts interviews, and the Owner can take it back.
 *
 * `access` is the capability itself. `view_all` is separate and additive:
 * conducting interviews does not imply reading everybody else's, so an
 * authorised Admin sees the interviews they conducted unless the Owner
 * deliberately widens that. Neither implies the other; each is checked at the
 * route. The Owner holds both implicitly and cannot be locked out of the
 * practice's own recruitment records.
 *
 * Nothing here delegates the power to delegate: granting is owner-only, by
 * role, so a delegate can never widen their own reach or a colleague's.
 */
const INTERVIEW_PERMISSIONS = [
  'interviews.access',    // see the module, run interviews, save, complete, export
  'interviews.view_all',  // read and export every interview in the practice
];

/** Grouped for the Owner's delegation UI; the grouping carries the warning. */
const INTERVIEW_PERMISSION_GROUPS = [
  {
    key: 'interviews',
    label: 'Interview Preparation',
    description: 'Conduct structured recruitment interviews on the practice\'s behalf. '
      + 'Interview records hold employment information about job applicants — grant only to '
      + 'people who genuinely interview candidates.',
    permissions: INTERVIEW_PERMISSIONS,
  },
];

/** Human labels for the delegation UI and for audit readability. */
const INTERVIEW_PERMISSION_LABELS = {
  'interviews.access': 'Interview Preparation access',
  'interviews.view_all': 'See all interviews in the practice',
};

/** Every permission string this file recognises — the grant allowlist. */
const KNOWN_PERMISSIONS = new Set([
  ...Object.values(ROLE_PERMISSIONS).flat(),
  ...ONBOARDING_PERMISSIONS,
  ...INTERVIEW_PERMISSIONS,
]);

/**
 * Return the permissions array for a given role.
 * Also merges any custom per-user permissions stored in the DB.
 *
 * The owner holds every onboarding and interview permission implicitly — the
 * practice owner is the data controller and cannot lock themselves out of
 * their own records.
 *
 * @param {string}   role        - 'owner' | 'admin' | 'therapist' | 'read_only' | 'pre_employee'
 * @param {string[]} [extraPerms] - additional permissions from user.permissions column
 */
function getPermissions(role, extraPerms = []) {
  const base = ROLE_PERMISSIONS[role] || [];
  const merged = role === 'owner'
    ? [...base, ...ONBOARDING_PERMISSIONS, ...INTERVIEW_PERMISSIONS]
    : base;
  if (!extraPerms || !extraPerms.length) return [...new Set(merged)];
  // Per-user grants must name a permission this file actually defines. An
  // unrecognised string in the column is ignored rather than silently becoming
  // a capability nobody reviewed — the column is now writable through an API,
  // so "whatever is in the JSONB" is no longer a safe contract.
  const extras = extraPerms.filter((p) => KNOWN_PERMISSIONS.has(p));
  return [...new Set([...merged, ...extras])];
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

/**
 * Paths a pre-employee may reach. Everything else is refused.
 *
 * Deliberately an ALLOWLIST of prefixes, matched against req.originalUrl
 * (req.path is relative to the router's mount point and would let a path
 * through under a different mount). Query strings are stripped before
 * matching so "/api/contacts?x=/api/onboarding/me" cannot smuggle a prefix.
 */
const PRE_EMPLOYEE_PATHS = [
  '/api/auth/',            // login, logout, me, password change, verification
  '/auth/logout',
  '/api/onboarding/me',    // their own onboarding surface (all sub-paths)
  '/api/learning/my',      // learning assigned to them as part of onboarding
  '/api/tutorial',         // the product walkthrough
  '/api/notifications',    // their own notifications
];

function isPreEmployeePath(originalUrl) {
  const path = String(originalUrl || '').split('?')[0];
  // Exact match, or a match on the next path SEGMENT. A bare startsWith would
  // let "/api/onboarding/members" through on the strength of ".../me".
  return PRE_EMPLOYEE_PATHS.some((p) => {
    if (p.endsWith('/')) return path.startsWith(p);
    return path === p || path.startsWith(`${p}/`);
  });
}

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

    // ── pre_employee enforcement (server-side, single choke point) ─────────
    // A new starter part-way through onboarding must not reach ANY part of the
    // practice: no participants, no colleagues, no contacts, no clinical
    // surfaces, no Resource Hub. Route-level requireRole() already excludes
    // them from most things, but a number of routes gate on requireAuth alone
    // (submitting leave, for instance), so an allowlist here — not a
    // denylist — is what actually makes the boundary hold.
    //
    // This runs BEFORE the read_only check because a pre-employee needs to
    // write their own onboarding, and must be judged on path, not method.
    if (req.user.role === 'pre_employee' && !isPreEmployeePath(req.originalUrl)) {
      return res.status(403).json({
        error: 'Onboarding access only',
        message: 'Your account is limited to completing your onboarding until it is activated.',
      });
    }

    // read_only enforcement (server-side, single choke point): no business
    // writes of any kind. Their own auth endpoints stay available (password
    // change, logout-all, onboarding — all live under /api/auth/).
    // req.originalUrl is used because req.path is relative to the router
    // mount point.
    //
    // /api/onboarding/me/ is the one deliberate addition: acknowledging a
    // policy or re-supplying an expired credential is a personal compliance
    // act, not a business write, and a read_only account that is still an
    // employee must be able to do it. Every other onboarding path stays
    // blocked for them by the write rule below.
    const UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (
      req.user.role === 'read_only' &&
      UNSAFE_METHODS.includes(req.method) &&
      !req.originalUrl.startsWith('/api/auth/') &&
      !req.originalUrl.startsWith('/api/onboarding/me/')
    ) {

      return res.status(403).json({ error: 'Read-only account — this action is not permitted' });
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

/**
 * requireAnyPermission(...permissions)
 * Allows a user holding AT LEAST ONE of the listed permissions.
 *
 * Used where several distinct delegations can legitimately reach the same
 * read — e.g. an employee summary is visible to whoever may review, verify or
 * activate, but the sensitive sections inside it are gated separately.
 */
function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!permissions.some((p) => hasPermission(req.user, p))) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Requires one of: ${permissions.join(', ')}`,
      });
    }
    next();
  };
}

module.exports = {
  ROLE_PERMISSIONS,
  ONBOARDING_PERMISSIONS,
  ONBOARDING_PERMISSION_GROUPS,
  INTERVIEW_PERMISSIONS,
  INTERVIEW_PERMISSION_GROUPS,
  INTERVIEW_PERMISSION_LABELS,
  KNOWN_PERMISSIONS,
  PRE_EMPLOYEE_PATHS,
  isPreEmployeePath,
  getPermissions,
  hasPermission,
  requireAuth,
  requireRole,
  requirePermission,
  requireAnyPermission,
  canViewCalendar,
  canViewFinancials,
  canManageSchedule,
  canViewClient,
  stripFinancials,
};
