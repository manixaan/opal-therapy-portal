'use strict';

/**
 * RECONCILE — what the returned documents say, weighed, never blindly trusted.
 *
 * Pure. Takes every candidate value for a field (one per source: each
 * returned document, plus what the record already holds from the offer)
 * and decides ONE of three outcomes:
 *
 *   reliable   the sources agree and the reading is clear → applied by itself
 *   review     one reading, or a doubtful one              → the Owner confirms
 *   conflict   the sources disagree                        → the Owner chooses
 *
 * The bar is higher for IMPORTANT fields (pay, employment type, dates that
 * bind, legal name, date of birth, bank details, licence expiries,
 * identification numbers): a lone medium reading of the surname is a
 * review; a lone high reading of a suburb is reliable.
 *
 * Nothing here chooses between disagreeing sources. A conflict is shown as
 *   Employment Hours Conflict
 *     Contract: 38 hours · Employee Form: 30.4 hours
 * and the Owner picks.
 */

const { FIELDS } = require('./onboarding-extraction');

/** Fields where a wrong value costs money, legality or identity. */
const IMPORTANT = new Set([
  'legal_first_name', 'surname', 'date_of_birth',
  'employment_type', 'start_date', 'end_date', 'hours_per_week', 'salary_annual', 'hourly_rate',
  'bsb', 'account_number', 'account_holder_name', 'super_fund_name', 'super_usi', 'super_member_number',
  'drivers_licence_number', 'drivers_licence_expiry', 'passport_number', 'passport_expiry', 'visa_expiry',
  'ahpra_registration_number', 'ahpra_expiry', 'wwcc_number', 'wwcc_expiry',
  'ndis_screening_number', 'ndis_screening_expiry', 'police_check_date', 'first_aid_expiry', 'cpr_expiry',
]);

/** The title a conflict is shown under. */
const CONFLICT_TITLES = {
  hours_per_week: 'Employment Hours', salary_annual: 'Salary', hourly_rate: 'Hourly Rate',
  employment_type: 'Employment Type', start_date: 'Commencement Date', end_date: 'End Date',
  legal_first_name: 'Legal First Name', surname: 'Surname', middle_name: 'Middle Name', date_of_birth: 'Date of Birth',
  personal_email: 'Personal Email', mobile: 'Mobile Number',
  bsb: 'Bank BSB', account_number: 'Bank Account Number', account_holder_name: 'Bank Account Name',
  drivers_licence_expiry: 'Licence Expiry', drivers_licence_number: 'Licence Number',
  passport_number: 'Passport Number', passport_expiry: 'Passport Expiry',
};
const conflictTitle = (key) => `${CONFLICT_TITLES[key] || (FIELDS[key] ? FIELDS[key].label : key)} Conflict`;

/** How a value is shown beside its source. */
function displayValue(key, value) {
  const def = FIELDS[key];
  if (value == null) return '';
  if (key === 'hours_per_week') return `${value} hours`;
  if (def && def.kind === 'money') return `$${Number(value).toLocaleString('en-AU')}${key === 'hourly_rate' ? ' per hour' : ' per annum'}`;
  if (def && def.kind === 'date') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  }
  if (key === 'employment_type') return String(value).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return String(value);
}

/** The form two values must agree in. */
function comparable(key, value) {
  const def = FIELDS[key] || {};
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  switch (def.kind) {
    case 'number': case 'money': return String(Math.round(Number(s) * 100) / 100);
    case 'phone': case 'bsb': case 'account': return s.replace(/\D/g, '');
    case 'email': return s.toLowerCase();
    case 'date': return s.slice(0, 10);
    default: return s.toLowerCase().replace(/\s+/g, ' ').replace(/[.,'"-]/g, '');
  }
}

const RANK = { high: 3, medium: 2, low: 1 };

/**
 * @param {string} key
 * @param {object[]} candidates [{ value, confidence, sourceKind:'document'|'record'|'offer', sourceLabel, sourceDocumentId, candidateId }]
 * @returns {{ outcome, value, confidence, reason, title, options:[{...candidate, display}] }}
 */
function reconcileField(key, candidates) {
  const cands = (candidates || []).filter((c) => c && c.value != null && String(c.value).trim() !== '');
  const options = cands.map((c) => ({
    candidateId: c.candidateId || null, sourceKind: c.sourceKind, sourceLabel: c.sourceLabel || (c.sourceKind === 'document' ? 'Returned document' : 'Offer terms'),
    sourceDocumentId: c.sourceDocumentId || null, value: c.value, confidence: c.confidence || 'medium', display: displayValue(key, c.value),
  }));
  if (!cands.length) return { outcome: 'review', value: null, confidence: 'low', reason: 'No value was read', title: FIELDS[key] ? FIELDS[key].label : key, options };

  // Group by comparable value.
  const groups = new Map();
  for (const o of options) {
    const k = comparable(key, o.value);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  }

  if (groups.size > 1) {
    return {
      outcome: 'conflict', value: null, confidence: 'low',
      reason: `${groups.size} sources give different values`, title: conflictTitle(key),
      options: dedupeOptions(options),
    };
  }

  // Everyone agrees: the value is the best-read copy.
  const agreed = options.slice().sort((a, b) => RANK[b.confidence] - RANK[a.confidence])[0];
  const documents = options.filter((o) => o.sourceKind === 'document');
  const best = Math.max(...options.map((o) => RANK[o.confidence] || 1));
  const important = IMPORTANT.has(key);

  let outcome; let reason;
  if (documents.length === 0) {
    // Only what we already knew — nothing new to trust or doubt.
    outcome = 'reliable'; reason = 'Matches the offer terms; nothing in the documents contradicts it';
  } else if (best === 3) {
    // A clear reading is reliable. The bar for IMPORTANT fields is not a
    // second document — it is clarity, and agreement wherever a second
    // source exists (a disagreement never reaches this branch).
    outcome = 'reliable'; reason = options.length >= 2 ? 'Sources agree and read clearly' : 'Read clearly';
  } else if (best === 2) {
    if (options.length >= 2 || !important) { outcome = 'reliable'; reason = options.length >= 2 ? 'Sources agree' : 'Legible reading'; }
    else { outcome = 'review'; reason = 'Read with some doubt, from one document only'; }
  } else {
    outcome = 'review'; reason = 'Low-confidence reading';
  }
  return { outcome, value: agreed.value, confidence: agreed.confidence, reason, title: FIELDS[key] ? FIELDS[key].label : key, options: dedupeOptions(options) };
}

/** One row per (source, value): two forms saying the same thing are still two sources. */
function dedupeOptions(options) {
  const seen = new Set();
  return options.filter((o) => {
    const k = `${o.sourceKind}|${o.sourceDocumentId || ''}|${o.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The record's own knowledge, as candidates. The offer terms are what the
 * practice agreed; a document disagreeing with them is a conflict to decide,
 * not a fact to overwrite.
 */
function recordCandidates(assignment) {
  const a = assignment || {};
  const out = [];
  const push = (key, value) => { if (value != null && String(value).trim() !== '') out.push({ key, value: String(value), confidence: 'high', sourceKind: 'offer', sourceLabel: 'Offer terms' }); };
  const name = String(a.applicant_name || '').trim().split(/\s+/);
  if (name.length >= 2) { push('legal_first_name', name[0]); push('surname', name.slice(-1)[0]); }
  push('personal_email', a.applicant_email);
  push('mobile', a.mobile);
  push('employment_type', a.employment_type);
  push('start_date', a.start_date ? String(a.start_date instanceof Date ? a.start_date.toISOString().slice(0, 10) : a.start_date).slice(0, 10) : null);
  push('end_date', a.end_date ? String(a.end_date instanceof Date ? a.end_date.toISOString().slice(0, 10) : a.end_date).slice(0, 10) : null);
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : String(Number(v)));
  push('hours_per_week', num(a.hours_per_week));
  push('job_title', a.job_title);
  if (a.pay_basis === 'annual') push('salary_annual', num(a.pay_rate));
  if (a.pay_basis === 'hourly') push('hourly_rate', num(a.pay_rate));
  return out;
}

/** Reconcile every field that has at least one document candidate. */
function reconcileAll(candidates, assignment) {
  const byKey = new Map();
  for (const c of [...(candidates || []), ...recordCandidates(assignment)]) {
    if (!FIELDS[c.key]) continue;
    if (!byKey.has(c.key)) byKey.set(c.key, []);
    byKey.get(c.key).push(c);
  }
  const out = [];
  for (const [key, cands] of byKey) {
    if (!cands.some((c) => c.sourceKind === 'document')) continue;
    out.push({ key, ...reconcileField(key, cands) });
  }
  return out;
}

module.exports = { IMPORTANT, CONFLICT_TITLES, conflictTitle, displayValue, comparable, reconcileField, reconcileAll, recordCandidates };
