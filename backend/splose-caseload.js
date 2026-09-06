'use strict';

/**
 * SPLOSE CASELOAD SCOPING — the one answer to "may this user see this client?"
 *
 * Mirrors GET /api/splose/my-patients (routes.js) so a second reader of the
 * client directory cannot drift from the first:
 *   - read_only accounts are refused outright (practice-management PII);
 *   - owner/admin see the practice directory;
 *   - a therapist sees ONLY clients whose OPEN Splose case is assigned to
 *     their linked practitioner, and an unmapped therapist fails closed.
 *
 * Splose is the source of truth for clients — there is no local client table
 * — so every check here is a live read through splose-api (never a direct
 * HTTP call). Callers get a small, PII-minimal client shape: id, name,
 * suburb, and the formatted address for the case-note header.
 */

const sploseApi = require('./splose-api');

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Shape check only — authorisation is loadOwnClient's job. */
function isSploseClientId(s) {
  return CLIENT_ID_RE.test(String(s || ''));
}

class CaseloadError extends Error {
  constructor(code, status, message) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

/**
 * The patient ids the caller may see: a Set for a therapist, or null meaning
 * "practice-wide" (owner/admin). Throws CaseloadError for read_only and for
 * a therapist with no practitioner mapping — both are policy refusals, not
 * lookups that happened to miss.
 */
async function allowedPatientIds(req) {
  const role = req.user?.role;
  if (role === 'read_only') {
    throw new CaseloadError('splose_read_only_denied', 403,
      'Read-only accounts cannot access practice-management data');
  }
  if (role === 'owner' || role === 'admin') return null;
  const own = req.user?.tp_splose_practitioner_id || null;
  if (!own) {
    throw new CaseloadError('practitioner_mapping_required', 403,
      'Your account is not linked to a Splose practitioner yet. Ask the practice owner to complete your therapist profile.');
  }
  const cases = (await sploseApi.fetchAllCases())
    .filter((c) => !c.archived && !c.deletedAt && c.isOpen !== false);
  return new Set(cases
    .filter((c) => String(c.practitionerId) === String(own))
    .map((c) => String(c.patientId)));
}

function toClient(p) {
  const fullName = (p.fullName || `${p.firstname || ''} ${p.lastname || ''}`).trim();
  return {
    id: String(p.id),
    fullName: fullName || null,
    suburb: p.suburb || null,
    formattedAddress: p.formattedAddress || null,
  };
}

/** The caller's clients, sorted by name. */
async function listOwnClients(req) {
  const allowed = await allowedPatientIds(req);
  const patients = await sploseApi.getPatients();
  const mine = allowed ? patients.filter((p) => allowed.has(String(p.id))) : patients;
  const clients = mine.map(toClient)
    .sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || ''), 'en-AU'));
  return { clients, scope: allowed ? 'caseload' : 'practice' };
}

/**
 * One client the caller may link to, or null. "Not yours" and "does not
 * exist" are deliberately indistinguishable (same rule as loadOwnEvent in
 * case-note-routes). Policy refusals still throw CaseloadError; a Splose
 * transport failure propagates so the route can answer 502, never 400.
 */
async function loadOwnClient(req, clientId) {
  if (!isSploseClientId(clientId)) return null;
  const allowed = await allowedPatientIds(req);
  if (allowed && !allowed.has(String(clientId))) return null;
  let p;
  try {
    p = await sploseApi.getPatient(String(clientId));
  } catch (err) {
    if (err?.response?.status === 404) return null;
    throw err;
  }
  if (!p || p._raw?.archived || p._raw?.deletedAt) return null;
  return toClient(p);
}

module.exports = { isSploseClientId, CaseloadError, allowedPatientIds, listOwnClients, loadOwnClient };
