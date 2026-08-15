'use strict';

/**
 * RESOURCE HUB GOVERNANCE — vocabularies, access rules and the review state
 * machine described in the Opal Resource Hub handoff (CONTENT_GOVERNANCE.md).
 *
 * Deliberately pure: no database, no express, no I/O. Everything here is a
 * decision the routes and the frontend must agree on, so it is unit-testable
 * on its own and cannot drift between the two callers.
 *
 * THE ONE RULE WORTH STATING TWICE
 * `source_class` says who wrote a thing. `rights_status` says what we may do
 * with it. They are independent. A record may be 'opal-original' and still be
 * unpublishable, and a 'government-official' record is never republishable as
 * Opal work no matter how its rights are marked. Nothing in this module infers
 * one from the other.
 */

// ── Vocabularies (mirror the CHECK constraints in migration 024) ────────────

const SOURCE_CLASSES = [
  'opal-original', 'government-official', 'nonprofit', 'standardised-instrument',
  'commercial', 'provider-company', 'internal', 'unknown',
];

const RIGHTS_STATUSES = [
  'unreviewed', 'opal-owned', 'licensed-for-portal', 'official-link-only',
  'reference-only', 'restricted', 'unknown',
];

/**
 * Tiers this application can actually enforce. 'public' and 'participant' are
 * absent on purpose: there is no participant or carer login, so naming those
 * tiers would promise an audience that cannot authenticate. Editorial intent
 * for such an audience lives in `intended_audience`, which grants nothing.
 */
const ACCESS_TIERS = ['clinician', 'staff', 'admin', 'excluded-private'];

/** Aspirational audiences. Recorded for later; never consulted for access. */
const INTENDED_AUDIENCES = ['participant', 'parent-carer', 'clinician', 'staff'];

const PUBLICATION_STATES = [
  'inventory', 'rights-review', 'clinical-review', 'brand-accessibility-review',
  'approved', 'published', 'retired', 'excluded-private',
];

const CLINICAL_STATUSES = ['unreviewed', 'draft', 'clinically-reviewed', 'superseded'];

const BRAND_REVIEW_STATUSES = ['pending', 'approved', 'not-required'];

/**
 * Publication is switched off for this release. The state exists in the data
 * model so the lifecycle is complete, but nothing may enter it until the portal
 * can enforce visibility to a non-staff audience — which today it cannot,
 * because every authenticated user is staff. Flip this only alongside a real
 * participant access tier.
 */
const PUBLISH_ENABLED = false;

// ── Access ──────────────────────────────────────────────────────────────────

/**
 * Which tiers each role may read. Note that 'excluded-private' appears nowhere:
 * it is not a tier anybody reads, it is a tombstone meaning "client-derived,
 * never serve".
 */
const ROLE_TIERS = {
  owner:     ['staff', 'clinician', 'admin'],
  admin:     ['staff', 'clinician', 'admin'],
  therapist: ['staff', 'clinician'],
  read_only: ['staff'],
};

function tiersForRole(role) {
  return ROLE_TIERS[String(role || '').toLowerCase()] || [];
}

function canReadTier(role, accessTier) {
  if (accessTier === 'excluded-private') return false;
  return tiersForRole(role).indexOf(accessTier) !== -1;
}

/**
 * States whose records may appear in a listing at all. 'approved' is included
 * because that is where the existing 163 resources live and how the hub has
 * always worked; 'published' is included for when PUBLISH_ENABLED is turned on.
 * Everything else is in-review and stays out of general listings.
 */
const LISTABLE_STATES = ['approved', 'published'];

/**
 * States the staff LIBRARY browses — LISTABLE_STATES plus 'inventory'.
 *
 * 'inventory' is here by the practice owner's explicit decision (commit
 * 14a55c0 and the 2026-08-15 Resource Hub directive): the catalogued imports
 * are to be hosted and organised for staff even though nobody has walked each
 * one through the review pipeline. This does NOT fabricate an approval —
 * publication_state stays 'inventory', approvalBlockers still lists every
 * missing gate, and attribution() still refuses the Opal badge — it is a
 * presentation decision that staff may browse honestly-labelled, un-reviewed
 * documents. The in-review states are deliberately absent: 'rights-review' is
 * the admin queue (treatment says metadata only until authorship is
 * evidenced), and clinical/brand reviews are workflow, not a library.
 */
const BROWSABLE_STATES = ['approved', 'published', 'inventory'];

function isListable(resource, role) {
  if (!resource) return false;
  if (resource.access_tier === 'excluded-private') return false;
  if (resource.publication_state === 'excluded-private') return false;
  if (LISTABLE_STATES.indexOf(resource.publication_state) === -1) return false;
  return canReadTier(role, resource.access_tier);
}

/**
 * SQL fragment for the same rule, so a listing query filters in the database
 * rather than fetching and discarding. Returns null when the role may read
 * nothing at all, which callers should treat as an empty result — not as
 * "no filter".
 */
function listPredicate(role, paramIndex) {
  const tiers = tiersForRole(role);
  if (!tiers.length) return null;
  return {
    sql: `(r.access_tier = ANY($${paramIndex}::text[])
           AND r.publication_state = ANY($${paramIndex + 1}::text[])
           AND r.access_tier <> 'excluded-private'
           AND r.publication_state <> 'excluded-private')`,
    params: [tiers, LISTABLE_STATES],
  };
}

// ── Review state machine ────────────────────────────────────────────────────

/**
 * Legal publication_state transitions. Reviews can always be sent back a step,
 * because a reviewer finding a rights problem during clinical review must be
 * able to return the record rather than push it forward.
 */
const TRANSITIONS = {
  'inventory':                  ['rights-review', 'excluded-private', 'retired'],
  'rights-review':              ['clinical-review', 'inventory', 'excluded-private', 'retired'],
  'clinical-review':            ['brand-accessibility-review', 'rights-review', 'excluded-private', 'retired'],
  'brand-accessibility-review': ['approved', 'clinical-review', 'retired'],
  'approved':                   ['published', 'brand-accessibility-review', 'retired'],
  'published':                  ['retired', 'approved'],
  'retired':                    ['inventory'],
  'excluded-private':           [],           // terminal, by design
};

/**
 * @returns {{ok: boolean, reason?: string}}
 */
function canTransition(from, to) {
  if (PUBLICATION_STATES.indexOf(to) === -1) {
    return { ok: false, reason: `Unknown publication state "${to}".` };
  }
  if (from === to) return { ok: false, reason: 'Already in that state.' };
  if (from === 'excluded-private') {
    return {
      ok: false,
      reason: 'Excluded-private records are client-derived and can never be moved to a publishable state.',
    };
  }
  if (to === 'published' && !PUBLISH_ENABLED) {
    return {
      ok: false,
      reason: 'Publishing is disabled in this release: the portal cannot yet serve a non-staff audience.',
    };
  }
  const allowed = TRANSITIONS[from] || [];
  if (allowed.indexOf(to) === -1) {
    return { ok: false, reason: `Cannot go from "${from}" to "${to}".` };
  }
  return { ok: true };
}

/**
 * Hard requirements before a record may reach 'approved'. The handoff blocks
 * publication when rights, clinical owner, version or review date are missing;
 * we apply the gate one step earlier, at approval, so nothing sits "approved"
 * without provenance.
 * @returns {string[]} human-readable blockers; empty means clear.
 */
function approvalBlockers(r) {
  const out = [];
  if (!r) return ['Resource not found.'];
  if (!r.source_class || r.source_class === 'unknown') {
    out.push('Source class is still unknown — classify who authored this.');
  }
  if (!r.rights_status || r.rights_status === 'unreviewed' || r.rights_status === 'unknown') {
    out.push('Rights status has not been reviewed.');
  }
  if (r.rights_status === 'restricted' || r.rights_status === 'reference-only') {
    out.push('Rights status does not permit hosting this resource in the hub.');
  }
  if (!r.content_owner) out.push('No content owner is recorded.');
  if (!r.content_version) out.push('No content version is recorded.');
  if (!r.review_due_at) out.push('No review due date is set.');
  if (r.clinical_status !== 'clinically-reviewed') out.push('Clinical review is not complete.');
  if (r.brand_review_status === 'pending') out.push('Brand and accessibility review is still pending.');
  return out;
}

// ── File-level access (migration 026) ───────────────────────────────────────

/**
 * How narrow each tier is, ascending. 'staff' is the broadest audience in this
 * application; 'excluded-private' has no audience at all.
 */
const TIER_RESTRICTIVENESS = {
  staff: 0,
  clinician: 1,
  admin: 2,
  'excluded-private': 3,
};

/**
 * The tier that actually governs a file.
 *
 * A NULL file tier means INHERIT, so omitting it can never widen access. When
 * a file does carry its own tier, the effective tier is the MORE RESTRICTIVE of
 * the two — never the file's alone. Both directions matter:
 *
 *   resource=staff,     file=clinician  -> clinician  (file narrows it)
 *   resource=clinician, file=staff      -> clinician  (file may NOT widen it)
 *
 * An unrecognised tier on either side resolves to 'excluded-private'. Failing
 * closed on a value we cannot rank is the only safe reading, because the
 * alternative is serving a file under a tier nobody has defined.
 */
function effectiveAccessTier(resourceTier, fileTier) {
  if (fileTier === null || fileTier === undefined || fileTier === '') {
    return TIER_RESTRICTIVENESS[resourceTier] === undefined ? 'excluded-private' : resourceTier;
  }
  const r = TIER_RESTRICTIVENESS[resourceTier];
  const f = TIER_RESTRICTIVENESS[fileTier];
  if (r === undefined || f === undefined) return 'excluded-private';
  return f > r ? fileTier : resourceTier;
}

/**
 * May this role read this file, given both the resource's tier and the file's?
 * The single question a download route should ask.
 */
function canReadFile(role, resourceTier, fileTier) {
  return canReadTier(role, effectiveAccessTier(resourceTier, fileTier));
}

/**
 * States whose files may be served at all.
 *
 * Broader than LISTABLE_STATES on purpose: a resource still in review is
 * downloadable by staff authorised for its tier, because reviewing a document
 * requires opening it. What is NOT downloadable is anything withdrawn or
 * quarantined — a retired record is out of service, and an excluded-private one
 * is client-derived and must never be served to anybody.
 */
const DOWNLOADABLE_STATES = [
  'inventory', 'rights-review', 'clinical-review', 'brand-accessibility-review',
  'approved', 'published',
];

function canDownloadInState(publicationState) {
  return DOWNLOADABLE_STATES.indexOf(publicationState) !== -1;
}

// ── Who may govern ──────────────────────────────────────────────────────────

/**
 * Declaring a resource fit to serve. The owner's call alone.
 * Note that 'excluded-private' is NOT here — quarantining is protective, not a
 * declaration of fitness, and waiting for the owner to remove client-derived
 * material from circulation would be the wrong trade.
 */
const APPROVAL_STATES = ['approved', 'published'];

/**
 * Removing a record from circulation because it should never have been in the
 * hub. Any governance role may act immediately; the state is terminal, so the
 * cost of a wrong call is a record that must be re-created, never a disclosure.
 */
const QUARANTINE_STATES = ['excluded-private'];

/**
 * Advancing PAST clinical review is a clinical attestation: it asserts that a
 * qualified person judged the content safe and current. Until there is an
 * assigned-clinical-reviewer capability, only the owner may make that claim.
 * An admin can still run the rights and brand/accessibility stages, and can
 * still send a record BACK from clinical review — neither asserts anything
 * clinical.
 */
const CLINICAL_ATTESTATION = { from: 'clinical-review', to: 'brand-accessibility-review' };

const REVIEW_ROLES = ['owner', 'admin'];
const APPROVAL_ROLES = ['owner'];

/**
 * Authority is a property of the ROLE, never of merely having a session.
 * A therapist holds a valid user id and appears in `actor_user_id` on every
 * event they cause, but that identity is provenance, not permission — this
 * function is the only thing that grants it, and it consults role (plus where
 * the record is coming from and going to) and nothing else. No user id is
 * accepted, so none can be mistaken for authority.
 *
 * read_only is denied explicitly rather than by omission: the global read_only
 * write-block already stops these routes, and this is the second, local
 * statement of the same rule so a future refactor of that middleware cannot
 * silently open governance to it.
 *
 * @param {string} role
 * @param {string} toState
 * @param {string} [fromState] required to police the clinical attestation step
 * @returns {{allowed: boolean, reason?: string}}
 */
function canPerformTransition(role, toState, fromState) {
  const r = String(role || '').toLowerCase();

  if (r === 'read_only') {
    return { allowed: false, reason: 'Read-only users cannot change resource governance.' };
  }
  if (r === 'therapist') {
    return {
      allowed: false,
      reason: 'Therapists can author and submit resources, but not move them through review.',
    };
  }

  const isGovernanceRole = REVIEW_ROLES.indexOf(r) !== -1;
  if (!isGovernanceRole) {
    return { allowed: false, reason: 'You do not have permission to move resources through review.' };
  }

  // Protective: available to every governance role, without waiting.
  if (QUARANTINE_STATES.indexOf(toState) !== -1) return { allowed: true };

  if (APPROVAL_STATES.indexOf(toState) !== -1) {
    return APPROVAL_ROLES.indexOf(r) !== -1
      ? { allowed: true }
      : { allowed: false, reason: `Only the owner can move a resource to "${toState}".` };
  }

  if (fromState === CLINICAL_ATTESTATION.from && toState === CLINICAL_ATTESTATION.to
      && APPROVAL_ROLES.indexOf(r) === -1) {
    return {
      allowed: false,
      reason: 'Completing clinical review is a clinical attestation and is reserved for the owner.',
    };
  }

  return { allowed: true };
}

/**
 * `clinical_status` is the same attestation expressed as a field rather than a
 * transition, so it carries the same restriction — otherwise an admin could
 * simply set the flag and walk the record forward.
 */
function canSetClinicalStatus(role, value) {
  const r = String(role || '').toLowerCase();
  if (value !== 'clinically-reviewed') {
    return canPerformTransition(r, 'rights-review');
  }
  return APPROVAL_ROLES.indexOf(r) !== -1
    ? { allowed: true }
    : { allowed: false, reason: 'Recording a completed clinical review is reserved for the owner.' };
}

// ── Attribution ─────────────────────────────────────────────────────────────

/**
 * The publisher badge. This is the function that stops third-party work being
 * presented as Opal's, so it is deliberately conservative: ONLY an explicit
 * 'opal-original' earns the Opal badge, and an unclassified record shows its
 * publisher or "Source under review" — never Opal.
 *
 * @returns {{label: string, kind: string, opalAuthored: boolean}}
 */
function attribution(r) {
  const publisher = (r && r.source_publisher) ? String(r.source_publisher).trim() : '';
  const cls = r && r.source_class;

  if (cls === 'opal-original') {
    return { label: 'Opal Therapy', kind: 'opal', opalAuthored: true };
  }
  if (cls === 'government-official') {
    return { label: publisher || 'Official guidance', kind: 'official', opalAuthored: false };
  }
  if (cls === 'standardised-instrument') {
    return { label: publisher || 'Standardised instrument', kind: 'instrument', opalAuthored: false };
  }
  if (cls === 'unknown' || !cls) {
    return { label: publisher || 'Source under review', kind: 'unreviewed', opalAuthored: false };
  }
  // nonprofit | commercial | provider-company | internal
  return { label: publisher || 'Third party', kind: 'third-party', opalAuthored: false };
}

module.exports = {
  SOURCE_CLASSES,
  RIGHTS_STATUSES,
  ACCESS_TIERS,
  INTENDED_AUDIENCES,
  PUBLICATION_STATES,
  CLINICAL_STATUSES,
  BRAND_REVIEW_STATUSES,
  LISTABLE_STATES,
  BROWSABLE_STATES,
  TRANSITIONS,
  ROLE_TIERS,
  PUBLISH_ENABLED,
  TIER_RESTRICTIVENESS,
  DOWNLOADABLE_STATES,
  canDownloadInState,
  effectiveAccessTier,
  canReadFile,
  APPROVAL_STATES,
  QUARANTINE_STATES,
  CLINICAL_ATTESTATION,
  REVIEW_ROLES,
  APPROVAL_ROLES,
  canPerformTransition,
  canSetClinicalStatus,
  tiersForRole,
  canReadTier,
  isListable,
  listPredicate,
  canTransition,
  approvalBlockers,
  attribution,
};
