'use strict';

/**
 * SHARED DATA LAYERS for every Opal generated document.
 *
 * These four loaders were written for the FCA report and are now used
 * unchanged by the progress note letter. Keeping ONE implementation is not
 * tidiness — organisation isolation, the "Splose is the system of record" rule
 * and the "missing is flagged, never fabricated" rule all live in here, and a
 * second copy would be a second place for one of them to be got wrong.
 *
 *   loadSploseClient(clientId)                  layer 1, live, external
 *   loadClientProfile(orgId, clientId)          layer 2, org-scoped, durable
 *   loadPortalData(userId, therapistProfileId)  the author, from this database
 *   loadOrganisationSettings(orgId)             the letterhead, from this database
 *
 * Nothing here writes. Nothing here resolves precedence — that is
 * resolve-scalars.js, and it is the only place precedence is decided.
 */

const { pool } = require('../database');
const splose = require('../splose-api');

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

// ── Layer 1: Splose ─────────────────────────────────────────────────────────

/** Splose is the system of record for client identity and contact facts. */
async function loadSploseClient(clientId) {
  try {
    return await splose.getPatient(clientId);
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404) return null;
    const wrapped = new Error('splose_unavailable');
    wrapped.sploseFailure = true;
    throw wrapped;
  }
}

// ── Layer 2: the organisation's client report profile ───────────────────────

/** The organisation's profile for this client, plus its CURRENT plan and goals. */
async function loadClientProfile(organisationId, clientId) {
  const { rows } = await pool.query(
    `SELECT * FROM fca_client_profiles
      WHERE organisation_id = $1 AND splose_client_id = $2`,
    [organisationId, String(clientId)]
  );
  const profile = rows[0] || null;
  if (!profile) return { profile: null, plans: [], currentPlan: null, goals: [] };

  const plansRes = await pool.query(
    `SELECT * FROM fca_client_ndis_plans
      WHERE client_profile_id = $1
      ORDER BY is_current DESC, created_at DESC`,
    [profile.id]
  );
  const goalsRes = await pool.query(
    `SELECT g.* FROM fca_client_ndis_goals g
       JOIN fca_client_ndis_plans p ON p.id = g.plan_id
      WHERE p.client_profile_id = $1
      ORDER BY g.sort_order ASC, g.created_at ASC`,
    [profile.id]
  );

  const goalsByPlan = new Map();
  for (const g of goalsRes.rows) {
    if (!goalsByPlan.has(g.plan_id)) goalsByPlan.set(g.plan_id, []);
    goalsByPlan.get(g.plan_id).push(g);
  }

  const plans = plansRes.rows.map((p) => ({ ...p, goals: goalsByPlan.get(p.id) || [] }));
  const currentPlan = plans.find((p) => p.is_current) || null;

  return {
    profile,
    plans,
    currentPlan,
    goals: currentPlan ? currentPlan.goals : [],
  };
}

// ── The author ──────────────────────────────────────────────────────────────

/**
 * Assessor / author facts that live in this database.
 *
 * `therapistCredentials` is additional to what the FCA reads and is used only
 * by the letter, which prints role and credentials as separate fields where the
 * FCA prints one combined line. It is the NAMES of the author's active
 * credentials — real rows, never a guess — and is absent when there are none.
 */
async function loadPortalData(userId, therapistProfileId) {
  const { rows } = await pool.query(
    `SELECT u.name, u.display_name, u.email, u.phone, u.role_title,
            o.name AS organisation_name,
            tp.display_name AS profile_display_name, tp.role_title AS profile_role_title
       FROM users u
       LEFT JOIN organisations o ON o.id = u.organisation_id
       LEFT JOIN therapist_profiles tp
              ON tp.id = $2::uuid AND tp.organisation_id IS NOT DISTINCT FROM u.organisation_id
      WHERE u.id = $1`,
    [userId, isUuid(therapistProfileId) ? therapistProfileId : null]
  );
  const u = rows[0] || {};

  const cred = await pool.query(
    `SELECT registration_number FROM credentials
      WHERE user_id = $1 AND status IN ('active','verified')
        AND (credential_type ILIKE '%ahpra%' OR credential_name ILIKE '%ahpra%' OR issuing_body ILIKE '%ahpra%')
        AND registration_number IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1`,
    [userId]
  );

  const named = await pool.query(
    `SELECT DISTINCT credential_name FROM credentials
      WHERE user_id = $1 AND status IN ('active','verified')
        AND credential_name IS NOT NULL
      ORDER BY credential_name ASC
      LIMIT 4`,
    [userId]
  );

  return {
    therapistName: u.profile_display_name || u.display_name || u.name || null,
    therapistRoleTitle: u.profile_role_title || u.role_title || null,
    therapistEmail: u.email || null,
    therapistPhone: u.phone || null,
    organisationName: u.organisation_name || null,
    ahpraNumber: cred.rows[0]?.registration_number || null,
    therapistCredentials: named.rows.length
      ? named.rows.map((r) => r.credential_name).join(', ').slice(0, 200)
      : null,
  };
}

// ── The letterhead ──────────────────────────────────────────────────────────

/**
 * Organisation letterhead facts, read from the EXISTING org_settings table.
 *
 * org_settings is a JSONB bag keyed by org_id TEXT. Two conventions are already
 * in use in this codebase: app-routes writes and reads the singleton row 'opal',
 * while scheduler-routes reads a row keyed by the organisation's uuid. Both are
 * read here and the organisation-specific row wins, so this works whichever
 * convention an installation is on without changing either of them.
 *
 * NOTHING IS INVENTED. A key that has never been set resolves to null, is
 * reported as MISSING, and — because all four letterhead tags are required —
 * blocks generation with a message telling the owner to fill them in. A letter
 * that goes to a plan manager with a guessed business address would be worse
 * than one that was never generated.
 */
async function loadOrganisationSettings(organisationId) {
  const keys = [];
  if (organisationId) keys.push(String(organisationId));
  keys.push('opal');

  const { rows } = await pool.query(
    'SELECT org_id, settings FROM org_settings WHERE org_id = ANY($1::text[])',
    [keys]
  );

  const byId = new Map(rows.map((r) => [r.org_id, r.settings || {}]));
  // Organisation-specific settings win over the installation-wide singleton.
  const merged = { ...(byId.get('opal') || {}), ...(organisationId ? (byId.get(String(organisationId)) || {}) : {}) };

  const pick = (...names) => {
    for (const n of names) {
      const v = merged[n];
      if (typeof v === 'string' && v.trim() !== '') return v.trim();
    }
    return null;
  };

  return {
    organisationName: pick('name'),
    businessAddress: pick('businessAddress', 'address'),
    businessPhone: pick('businessPhone', 'phone'),
    businessEmail: pick('businessEmail', 'email'),
    website: pick('website', 'websiteUrl'),
  };
}

module.exports = {
  loadSploseClient,
  loadClientProfile,
  loadPortalData,
  loadOrganisationSettings,
  isUuid,
};
