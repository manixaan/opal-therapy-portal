'use strict';

/**
 * THE PRACTICE'S OWN DETAILS — name, ABN, ACN, phone, email, address and the
 * signatory, as the Owner has set them in onboarding settings (Oct 2026).
 *
 * These were fixed in code (a signatory constant, "Ann / Director" in three
 * email bodies, a reviewer's own address as the pack's "Return to") and the
 * settings screen could not save them. Every generated letter, contract and
 * email now reads them from here, so changing a detail is a settings change,
 * not a code change. Pure: give it the settings object.
 */

const { DEFAULT_SETTINGS } = require('./onboarding-catalogue');

const pick = (v, d) => (v != null && String(v).trim() !== '' ? String(v).trim() : d);

/** The practice profile from onboarding settings, defaults filling any gap. */
function practiceProfile(settings) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const signatory = {
    name: pick(s.offerSignatoryName, DEFAULT_SETTINGS.offerSignatoryName),
    title: pick(s.offerSignatoryTitle, DEFAULT_SETTINGS.offerSignatoryTitle),
    email: pick(s.offerSignatoryEmail, DEFAULT_SETTINGS.offerSignatoryEmail),
    phone: pick(s.offerSignatoryPhone, DEFAULT_SETTINGS.offerSignatoryPhone),
  };
  const name = pick(s.practiceName, DEFAULT_SETTINGS.practiceName);
  return {
    name,
    abn: pick(s.practiceAbn, null),
    acn: pick(s.practiceAcn, null),
    phone: pick(s.practicePhone, null),
    email: pick(s.practiceEmail, null),
    address: pick(s.practiceAddress, null),
    returnEmail: pick(s.returnEmail, pick(s.practiceEmail, signatory.email)),
    signatory,
    signOff: `${signatory.name.split(/\s+/)[0]}\n${signatory.title} | ${name}`,
  };
}

/** The sign-off the email templates were written with — replaced by the profile's. */
const TEMPLATE_SIGN_OFF = 'Ann\nDirector | Opal Therapy';

function applySignOff(body, signOff) {
  if (!signOff) return body;
  return String(body || '').split(TEMPLATE_SIGN_OFF).join(signOff);
}

/** The keys that are the practice's identity — Owner-only to change. */
const PRACTICE_KEYS = Object.freeze([
  'practiceName', 'practiceAbn', 'practiceAcn', 'practicePhone', 'practiceEmail', 'practiceAddress',
  'offerSignatoryName', 'offerSignatoryTitle', 'offerSignatoryEmail', 'offerSignatoryPhone',
  'returnEmail', 'defaultWorkLocation',
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a settings patch's practice fields. Returns field → message for
 * every problem (a 400 with field messages, never a 500).
 */
function validatePracticePatch(patch) {
  const errors = {};
  for (const k of PRACTICE_KEYS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v != null && typeof v !== 'string') { errors[k] = 'Must be text'; continue; }
    const t = String(v || '').trim();
    if (t.length > 200) errors[k] = 'Keep it under 200 characters';
    if (['practiceName', 'offerSignatoryName', 'offerSignatoryTitle'].includes(k) && !t) errors[k] = 'Required';
    if (/Email$/.test(k) && t && !EMAIL_RE.test(t)) errors[k] = 'Not a valid email address';
    if (k === 'practiceAbn' && t && t.replace(/\s/g, '').length !== 11) errors[k] = 'An ABN is 11 digits';
    if (k === 'practiceAbn' && t && !/^\d+$/.test(t.replace(/\s/g, ''))) errors[k] = 'An ABN is 11 digits';
    if (k === 'practiceAcn' && t && !/^\d{9}$/.test(t.replace(/\s/g, ''))) errors[k] = 'An ACN is 9 digits';
    if (/Phone$/.test(k) && t && !/^[\d\s()+-]{6,20}$/.test(t)) errors[k] = 'Not a valid phone number';
  }
  if ('defaultSuperFund' in patch) {
    const f = patch.defaultSuperFund;
    if (f != null && (typeof f !== 'object' || Array.isArray(f))) errors.defaultSuperFund = 'Give the fund name, ABN and USI';
    else if (f && f.abn && String(f.abn).replace(/\s/g, '').length !== 11) errors.defaultSuperFund = 'The fund ABN is 11 digits';
  }
  return errors;
}

module.exports = { practiceProfile, applySignOff, TEMPLATE_SIGN_OFF, PRACTICE_KEYS, validatePracticePatch };
