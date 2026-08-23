'use strict';

/**
 * SERVICE AGREEMENT — MODE A, "complete using portal information".
 *
 *   resolvePortalValues({ splose, profile, currentPlan, goals, user, organisation })
 *     → { values, sources, missing }
 *
 * Pure: no database, no network, no clock. The caller loads the layers (with
 * fca/data-layers.js, which the FCA report and the letter already share) and
 * this decides what each field should say and where it came from.
 *
 * ── WHAT THE PORTAL ACTUALLY KNOWS ─────────────────────────────────────────
 * Being precise about this matters more than it sounds, because a service
 * agreement asks for a great deal the portal has never stored. Of the 61
 * portal-authority fields, this resolver can fill roughly a third. The rest
 * are genuinely unknown, and the honest thing — the thing that keeps the
 * document trustworthy — is to leave them blank and say so, rather than infer
 * them.
 *
 * KNOWN, from Splose (the system of record for identity):
 *   full name, NDIS number, address, email, phone, date of birth
 * KNOWN, from fca_client_profiles (durable local supplements):
 *   preferred name, date of birth where Splose has none, representative
 *   details as free text
 * KNOWN, from fca_client_ndis_plans / _goals:
 *   plan start, plan end, the participant's recorded goals
 * KNOWN, from the signed-in user:
 *   provider signatory name and role
 *
 * NOT KNOWN ANYWHERE, and therefore never guessed:
 *   funding management type, plan manager, invoice recipient, emergency
 *   contacts, communication and accessibility preferences, cultural safety
 *   preferences, interpreter needs, continuity plan, every consent, and every
 *   agreed support and rate.
 *
 * Those last are not an oversight in this file — there is no column for them
 * anywhere in the database. They are collected in the wizard as instance data,
 * which is also where the field-authority model puts them.
 *
 * ── REPRESENTATIVE DETAILS ARE FREE TEXT, AND STAY THAT WAY ────────────────
 * `fca_client_profiles.nominee_details` is one TEXT column. letter-routes.js
 * established the only split anybody should make of it — first line is the
 * person, the rest is their address — and explicitly refuses to infer a role
 * or an organisation from the words. The same restraint applies here: the
 * first line becomes the representative's name and NOTHING becomes their
 * relationship or their legal authority, because a service agreement that
 * asserts somebody is a plan nominee when the text said "mum" is a document
 * making a legal claim nobody checked.
 *
 * ── NOTHING IS WRITTEN BACK ────────────────────────────────────────────────
 * This resolver produces values for ONE agreement. Correcting a phone number
 * in the wizard changes that agreement and nothing else — not the participant
 * profile, not Splose, not the master. Writing back is a separate, explicit
 * act through the profile routes that already exist.
 */

const map = require('./template-map');
const { asDate } = require('./manifest');

/** A usable string, or null. */
function present(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** First non-null of several candidates, with the source that supplied it. */
function firstOf(candidates) {
  for (const [value, source] of candidates) {
    const v = present(value);
    if (v !== null) return { value: v, source };
  }
  return null;
}

/**
 * @param {object|null} splose        the Splose patient record
 * @param {object|null} profile       fca_client_profiles row
 * @param {object|null} currentPlan   the current fca_client_ndis_plans row
 * @param {Array}       goals         fca_client_ndis_goals rows
 * @param {object|null} user          the signed-in user (provider signatory)
 * @param {object}      organisation  { values, sources } from ./organisation.js
 */
function resolvePortalValues({
  splose = null,
  profile = null,
  currentPlan = null,
  goals = [],
  user = null,
  organisation = null,
} = {}) {
  const values = Object.create(null);
  const sources = Object.create(null);

  const set = (tag, resolved) => {
    if (!resolved) return;
    values[tag] = resolved.value;
    sources[tag] = resolved.source;
  };

  // ── Participant identity — Splose is authoritative ───────────────────────
  // The profile is deliberately NOT consulted for these. A stale local copy of
  // a name or an NDIS number silently shadowing the live record is the exact
  // failure fca/resolve-scalars.js was written to prevent, and a service
  // agreement is a worse place for it than a report.
  set('OPAL_PARTICIPANT_FULL_NAME', firstOf([[splose?.fullName, 'splose']]));
  set('OPAL_PARTICIPANT_NDIS_NUMBER', firstOf([[splose?.ndisNumber, 'splose']]));
  set('OPAL_PARTICIPANT_EMAIL', firstOf([[splose?.email, 'splose']]));
  set('OPAL_PARTICIPANT_PHONE', firstOf([
    [splose?.mobilePhone, 'splose'],
    [splose?.phone, 'splose'],
  ]));
  set('OPAL_PARTICIPANT_ADDRESS', firstOf([[splose?.formattedAddress, 'splose']]));

  // Date of birth: Splose first, then the profile, which exists precisely
  // because Splose does not always carry one.
  const dob = firstOf([
    [splose?.dateOfBirth, 'splose'],
    [profile?.date_of_birth, 'client_profile'],
  ]);
  if (dob) set('OPAL_PARTICIPANT_DATE_OF_BIRTH', { value: asDate(dob.value), source: dob.source });

  set('OPAL_PARTICIPANT_PREFERRED_NAME', firstOf([
    [profile?.preferred_name, 'client_profile'],
    [splose?.preferredName, 'splose'],
  ]));

  // ── Plan dates ───────────────────────────────────────────────────────────
  const planStart = firstOf([[currentPlan?.plan_start, 'ndis_plan']]);
  if (planStart) {
    set('OPAL_PARTICIPANT_PLAN_START_DATE', { value: asDate(planStart.value), source: planStart.source });
  }
  const planEnd = firstOf([[currentPlan?.plan_end, 'ndis_plan']]);
  if (planEnd) {
    set('OPAL_PARTICIPANT_PLAN_END_DATE', { value: asDate(planEnd.value), source: planEnd.source });
  }

  // ── Goals ────────────────────────────────────────────────────────────────
  // Rendered one per line so the multiline control shows them as a list rather
  // than a paragraph of run-together sentences.
  const goalTexts = (Array.isArray(goals) ? goals : [])
    .map((g) => present(g && (g.goal_text || g.text)))
    .filter(Boolean);
  if (goalTexts.length) {
    set('OPAL_PARTICIPANT_GOALS', { value: goalTexts.join('\n'), source: 'ndis_plan' });
  }

  // ── Representative — first line only, nothing inferred ───────────────────
  const nominee = present(profile?.nominee_details);
  if (nominee) {
    const firstLine = present(nominee.split('\n')[0]);
    if (firstLine) {
      set('OPAL_REPRESENTATIVE_FULL_NAME', { value: firstLine, source: 'client_profile' });
    }
    // Relationship, authority, phone and email are NOT parsed out. See the
    // file header: guessing them makes the document assert a legal
    // relationship nobody verified.
  }

  // ── Provider signatory — the person issuing the agreement ────────────────
  if (user) {
    set('OPAL_PROVIDER_SIGNATORY_NAME', firstOf([
      [user.display_name, 'portal_user'],
      [user.name, 'portal_user'],
    ]));
    set('OPAL_PROVIDER_SIGNATORY_ROLE', firstOf([[user.role_title, 'portal_user']]));
  }

  // ── Organisation — owner-controlled, merged in as-is ─────────────────────
  if (organisation && organisation.values) {
    for (const [tag, value] of Object.entries(organisation.values)) {
      const v = present(value);
      if (v === null) continue;
      values[tag] = v;
      sources[tag] = (organisation.sources && organisation.sources[tag]) || 'organisation_settings';
    }
  }

  // ── What is still unknown ────────────────────────────────────────────────
  // Server- and e-sign-authority tags are excluded: they are not the portal's
  // to resolve and reporting them as "missing" would tell a staff member to go
  // and find a signature that does not exist yet. Same reasoning as
  // fca/document-id.js's "issued, not looked up".
  const missing = map.SCALAR_TAGS.filter((tag) => {
    const f = map.SCALAR_BY_TAG[tag];
    if (f.authority === map.AUTHORITY.SERVER || f.authority === map.AUTHORITY.ESIGN) return false;
    return !present(values[tag]);
  });

  return { values, sources, missing };
}

/**
 * Merge a resolution with the values a user has typed into the wizard.
 *
 * User input wins — that is the whole point of showing the resolved values in
 * editable fields — but ONLY for portal-authority tags. A posted ABN, agreement
 * reference or signature is discarded rather than accepted, so the trust
 * boundary holds no matter what a browser sends.
 *
 * @returns {{ values, sources, rejected: string[] }}
 */
function mergeUserInput(resolved, formData) {
  const values = { ...(resolved.values || {}) };
  const sources = { ...(resolved.sources || {}) };
  const rejected = [];

  for (const [tag, raw] of Object.entries(formData || {})) {
    if (!map.SCALAR_BY_TAG[tag]) continue;                 // unknown tag: ignore
    if (!map.writableBy(tag, map.AUTHORITY.PORTAL)) {
      rejected.push(tag);
      continue;
    }
    const v = present(raw);
    if (v === null) {
      // An explicit clear. The field becomes blank rather than falling back to
      // the resolved value — a user who deleted a phone number meant to.
      delete values[tag];
      sources[tag] = null;
    } else {
      values[tag] = v;
      sources[tag] = 'manual';
    }
  }

  return { values, sources, rejected };
}

module.exports = {
  resolvePortalValues,
  mergeUserInput,
  _internals: { present, firstOf },
};
