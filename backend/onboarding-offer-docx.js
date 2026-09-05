'use strict';

/**
 * LETTER OF OFFER — the .docx, filled from the record.
 *
 * The template (onboarding-templates/letter-of-offer-v1.docx) is Opal's own
 * letter with every person-specific value replaced by a Word content control
 * tagged OPAL_LOO_* — the same mechanism the FCA report and the progress-note
 * letter use, filled by the same engine (fca/docx-engine.js). Nothing here
 * invents a term: every value comes from the offer terms the Owner entered,
 * the practice's signatory details, or a stated default in DEFAULTS below.
 *
 * buildOfferDocx({ terms, applicant, signatory, issuedAt }) → Buffer
 */

const fs = require('fs');
const path = require('path');
const { composeDocx } = require('./fca/docx-engine');

const TEMPLATE_FILENAME = 'letter-of-offer-v1.docx';
const TEMPLATE_VERSION = 1;
const TEMPLATE_FILE = path.join(__dirname, 'onboarding-templates', TEMPLATE_FILENAME);
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Parts of the package that carry controls. header2 is the running header. */
const CONTROL_PARTS = ['word/document.xml', 'word/header2.xml'];

/** Controls that own a whole line, dropped when the value is absent. */
const OPTIONAL_LINE_TAGS = ['OPAL_LOO_REGISTRATION_CONDITION'];

/** Practice-level defaults, overridable per offer through the terms. */
const DEFAULTS = {
  award: 'Health Professionals and Support Services Award 2020 (MA000027)',
  superannuationRate: 12,
  payCycle: 'Fortnightly',
  workPattern: 'worked between 8:30am and 4:30pm (flexible), Monday to Friday',
  offerOpenDays: 7,
  registrationCondition: 'Professional registration — current general registration as an occupational therapist with the '
    + 'Occupational Therapy Board of Australia, via AHPRA, free of any condition, undertaking or restriction that would '
    + 'prevent or restrict the performance of Your Role.',
};

/** The practice signatory. Overridable through onboarding settings (offerSignatory*). */
const DEFAULT_SIGNATORY = {
  name: 'Ann Mary Mathew',
  title: 'Director',
  email: 'ann.mathew@opaltherapy.com.au',
  phone: '0484 827 212',
};

const TAGS = [
  'OPAL_LOO_DATE', 'OPAL_LOO_CANDIDATE_FULL_NAME', 'OPAL_LOO_CANDIDATE_FIRST_NAME', 'OPAL_LOO_CANDIDATE_EMAIL',
  'OPAL_LOO_CANDIDATE_MOBILE', 'OPAL_LOO_POSITION_TITLE', 'OPAL_LOO_EMPLOYMENT_BASIS', 'OPAL_LOO_EMPLOYMENT_BASIS_LOWER',
  'OPAL_LOO_COMMENCEMENT_DATE', 'OPAL_LOO_COMMENCEMENT_DATE_LONG', 'OPAL_LOO_SIGNATORY_NAME', 'OPAL_LOO_SIGNATORY_FIRST_NAME',
  'OPAL_LOO_SIGNATORY_TITLE', 'OPAL_LOO_SIGNATORY_EMAIL', 'OPAL_LOO_SIGNATORY_PHONE', 'OPAL_LOO_HOURS_DESCRIPTION',
  'OPAL_LOO_AWARD', 'OPAL_LOO_CLASSIFICATION', 'OPAL_LOO_REMUNERATION_LABEL', 'OPAL_LOO_REMUNERATION',
  'OPAL_LOO_SUPERANNUATION', 'OPAL_LOO_PAY_CYCLE', 'OPAL_LOO_PROBATION', 'OPAL_LOO_OFFER_CLOSING_DATE',
  'OPAL_LOO_OFFER_CLOSING_DATE_LONG', 'OPAL_LOO_REGISTRATION_CONDITION',
];

let templateCache = null;
function readTemplateBuffer() {
  if (!templateCache) templateCache = fs.readFileSync(TEMPLATE_FILE);
  return templateCache;
}

// ── Formatting ──────────────────────────────────────────────────────────────

const PERTH = 'Australia/Perth';
const toDate = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
const dmy = (v) => { const d = toDate(v); return d ? d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: PERTH }) : null; };
const long = (v) => { const d = toDate(v); return d ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: PERTH }) : null; };
const money = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const whole = Number.isInteger(v);
  return v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
};
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

const BASIS = {
  full_time: 'Full-time, ongoing', part_time: 'Part-time, ongoing', casual: 'Casual',
  fixed_term: 'Full-time, fixed-term', contractor: 'Independent contractor',
};
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function employmentBasis(terms) {
  let basis = BASIS[terms.employmentType] || terms.employmentType || '';
  if (terms.employmentType === 'fixed_term' && terms.endDate && long(terms.endDate)) {
    basis = `Fixed-term, ending ${long(terms.endDate)}`;
  }
  return basis;
}

function hoursDescription(terms) {
  const h = Number(terms.hoursPerWeek);
  const pattern = terms.workPattern || DEFAULTS.workPattern;
  if (terms.employmentType === 'casual') {
    return Number.isFinite(h) && h > 0
      ? `Casual hours as offered and accepted, anticipated at approximately ${h} hours per week`
      : 'Casual hours as offered and accepted from time to time';
  }
  if (!Number.isFinite(h) || h <= 0) return `Ordinary hours ${pattern}`;
  return `${h} hours per week, ${pattern}`;
}

function remuneration(terms) {
  const rate = money(terms.payRate);
  if (!rate) return { label: 'Remuneration', value: 'As set out in your Contract of Employment' };
  if (terms.payBasis === 'hourly') {
    return { label: 'Hourly Rate', value: `${rate} per hour, exclusive of superannuation${terms.employmentType === 'casual' ? ', inclusive of casual loading' : ''}` };
  }
  return { label: 'Annual Salary', value: `${rate} per annum, exclusive of superannuation` };
}

function probation(terms) {
  const m = Number(terms.probationMonths);
  if (!Number.isFinite(m) || m <= 0) return 'Not applicable';
  const word = WORDS[m] ? WORDS[m].replace(/^./, (c) => c.toUpperCase()) : String(m);
  return `${word} month${m === 1 ? '' : 's'} from the Commencement Date`;
}

function offerClosingDate(terms, issuedAt) {
  if (terms.offerClosingDate && toDate(terms.offerClosingDate)) return toDate(terms.offerClosingDate);
  const d = new Date(issuedAt || Date.now());
  d.setDate(d.getDate() + DEFAULTS.offerOpenDays);
  return d;
}

/**
 * Every scalar the template can take, from the record. Exposed so the
 * preview/what-will-change UI and the tests can see exactly what is written.
 */
function buildScalars({ terms, applicant, signatory, issuedAt, isTreatingTherapist }) {
  const t = terms || {};
  // Only defined overrides replace a default; an unset settings key keeps Ann's details.
  const sig = { ...DEFAULT_SIGNATORY };
  for (const [k, v] of Object.entries(signatory || {})) if (v != null && String(v).trim() !== '') sig[k] = v;
  const issued = issuedAt || new Date();
  const closing = offerClosingDate(t, issued);
  const pay = remuneration(t);
  const basis = employmentBasis(t);
  const superRate = Number(t.superannuationRate) > 0 ? Number(t.superannuationRate) : DEFAULTS.superannuationRate;

  return {
    OPAL_LOO_DATE: dmy(issued),
    OPAL_LOO_CANDIDATE_FULL_NAME: String(applicant.name || '').trim(),
    OPAL_LOO_CANDIDATE_FIRST_NAME: firstName(applicant.name),
    OPAL_LOO_CANDIDATE_EMAIL: applicant.email || '',
    OPAL_LOO_CANDIDATE_MOBILE: applicant.mobile || '',
    OPAL_LOO_POSITION_TITLE: t.positionTitle || '',
    OPAL_LOO_EMPLOYMENT_BASIS: basis,
    OPAL_LOO_EMPLOYMENT_BASIS_LOWER: basis.toLowerCase(),
    OPAL_LOO_COMMENCEMENT_DATE: dmy(t.startDate) || '',
    OPAL_LOO_COMMENCEMENT_DATE_LONG: long(t.startDate) || '',
    OPAL_LOO_SIGNATORY_NAME: sig.name,
    OPAL_LOO_SIGNATORY_FIRST_NAME: firstName(sig.name),
    OPAL_LOO_SIGNATORY_TITLE: sig.title,
    OPAL_LOO_SIGNATORY_EMAIL: sig.email,
    OPAL_LOO_SIGNATORY_PHONE: sig.phone,
    OPAL_LOO_HOURS_DESCRIPTION: hoursDescription(t),
    OPAL_LOO_AWARD: t.award || DEFAULTS.award,
    OPAL_LOO_CLASSIFICATION: t.awardClassification || 'As set out in your Contract of Employment',
    OPAL_LOO_REMUNERATION_LABEL: pay.label,
    OPAL_LOO_REMUNERATION: pay.value,
    OPAL_LOO_SUPERANNUATION: `Superannuation of ${superRate}%, in addition to your ${t.payBasis === 'hourly' ? 'hourly rate' : 'salary'}.`,
    OPAL_LOO_PAY_CYCLE: t.payCycle || DEFAULTS.payCycle,
    OPAL_LOO_PROBATION: probation(t),
    OPAL_LOO_OFFER_CLOSING_DATE: dmy(closing),
    OPAL_LOO_OFFER_CLOSING_DATE_LONG: long(closing),
    // A non-clinical role has no registration condition; the line is dropped.
    OPAL_LOO_REGISTRATION_CONDITION: isTreatingTherapist === false ? null : (t.registrationCondition || DEFAULTS.registrationCondition),
  };
}

const OPTIONS = {
  label: 'Letter of Offer',
  controlParts: CONTROL_PARTS,
  customSectionAnchor: null,
  buildCustomSection: null,
  multilineTags: [],
  dropParagraphWhenEmpty: OPTIONAL_LINE_TAGS,
  rebuildToc: false,
};

/** Fill the template — the shipped one, or `input.templateBuffer` (the
 *  practice's edited wording, onboarding-offer-template.js). Throws if a
 *  placeholder would survive. */
async function buildOfferDocx(input) {
  const scalarData = buildScalars(input);
  const excludedTags = Object.keys(scalarData).filter((k) => scalarData[k] === null);
  const buffer = await composeDocx({
    templateBuffer: Buffer.isBuffer(input.templateBuffer) && input.templateBuffer.length ? input.templateBuffer : readTemplateBuffer(),
    manifest: { scalarData, excludedTags, sections: [] },
    options: OPTIONS,
  });
  await assertNoPlaceholders(buffer);
  return buffer;
}

async function assertNoPlaceholders(buffer) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  for (const part of CONTROL_PARTS) {
    const xml = await zip.file(part)?.async('string');
    if (xml && /\[PORTAL\s+[—–-]/.test(xml)) {
      throw new Error(`Letter of Offer: a placeholder survived in ${part}`);
    }
  }
}

function offerFileName(applicantName, issuedAt) {
  const stem = String(applicantName || 'Candidate').replace(/[^A-Za-z0-9 .'-]/g, '').trim().replace(/\s+/g, ' ');
  const d = toDate(issuedAt) || new Date();
  return `Letter of Offer - ${stem} - Opal Therapy - ${d.toISOString().slice(0, 10)}.docx`;
}

module.exports = {
  TEMPLATE_FILENAME, TEMPLATE_VERSION, TEMPLATE_FILE, DOCX_MIME, CONTROL_PARTS, TAGS, DEFAULTS, DEFAULT_SIGNATORY,
  buildScalars, buildOfferDocx, offerFileName, readTemplateBuffer,
  _internals: { employmentBasis, hoursDescription, remuneration, probation, offerClosingDate },
};
