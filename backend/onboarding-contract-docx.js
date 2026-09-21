'use strict';

/**
 * CONTRACT OF EMPLOYMENT — the .docx, filled from the record.
 *
 * The Stage 2 master (onboarding-templates/stage2/contract-of-employment.docx,
 * built by scripts/build-contract-template.js) carries every person-specific
 * value as a Word content control tagged OPAL_COE_*. They are filled from the
 * same facts as the Letter of Offer — the offer terms the Owner entered in
 * Stage 1, the practice signatory, and the offer's stated defaults — so the
 * letter and the contract can never disagree.
 *
 * A contract the practice uploaded WITHOUT the controls is its own document
 * and passes through untouched (isContractTemplate).
 *
 * buildContractDocx({ templateBuffer, terms, applicant, signatory, issuedAt }) → Buffer
 */

const JSZip = require('jszip');
const { composeDocx } = require('./fca/docx-engine');
const offerDocx = require('./onboarding-offer-docx');

const TAG_PREFIX = 'OPAL_COE_';
const CONTROL_PARTS = ['word/document.xml', 'word/header2.xml'];
/** Controls that own a whole line, dropped when the value is absent. */
const OPTIONAL_LINE_TAGS = ['OPAL_COE_ADDITIONAL_TERMS'];

const TAGS = [
  'DATE', 'EMPLOYEE_FULL_NAME', 'EMPLOYEE_FIRST_NAME', 'EMPLOYEE_EMAIL', 'POSITION_TITLE', 'EMPLOYMENT_BASIS',
  'EMPLOYMENT_BASIS_LOWER', 'COMMENCEMENT_DATE', 'WORK_LOCATION', 'REPORTS_TO', 'HOURS_DESCRIPTION', 'AWARD',
  'CLASSIFICATION', 'REMUNERATION_LABEL', 'REMUNERATION', 'SUPERANNUATION', 'PAY_CYCLE', 'PAY_CYCLE_LOWER',
  'PROBATION', 'PROBATION_PERIOD', 'CPD_ALLOWANCE', 'ADDITIONAL_TERMS', 'SIGNATORY_NAME', 'SIGNATORY_TITLE',
  'SIGNATORY_EMAIL', 'SIGNATORY_PHONE',
].map((t) => TAG_PREFIX + t);

const DEFAULTS = {
  probationMonths: 6, // the offer editor's own default
  workLocation: 'Hybrid — the Perth metropolitan area',
  cpdAllowance: 'an amount approved by the Company each year',
};

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const PERTH = 'Australia/Perth';
const long = (v) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: PERTH }) : ''; };
const money = (n) => Number(n).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 });

/** "six (6) months" — the one probation length every clause that mentions it reads from. */
function probationPeriod(terms) {
  const given = Number(terms.probationMonths);
  const m = Number.isFinite(given) && given > 0 ? given : DEFAULTS.probationMonths;
  return `${WORDS[m] || m} (${m}) month${m === 1 ? '' : 's'}`;
}

function cpdAllowance(terms) {
  const v = Number(terms.cpdAllowance);
  return Number.isFinite(v) && v > 0 ? `${money(v)} per year` : DEFAULTS.cpdAllowance;
}

/** Every scalar the contract can take, from the record. */
function buildScalars({ terms, applicant, signatory, issuedAt, isTreatingTherapist }) {
  const t = terms || {};
  const loo = offerDocx.buildScalars({ terms: t, applicant: applicant || {}, signatory, issuedAt, isTreatingTherapist });
  const reportsTo = t.reportsTo || `${loo.OPAL_LOO_SIGNATORY_NAME} (${loo.OPAL_LOO_SIGNATORY_TITLE})`;
  const values = {
    DATE: long(issuedAt || new Date()),
    EMPLOYEE_FULL_NAME: loo.OPAL_LOO_CANDIDATE_FULL_NAME,
    EMPLOYEE_FIRST_NAME: loo.OPAL_LOO_CANDIDATE_FIRST_NAME,
    EMPLOYEE_EMAIL: loo.OPAL_LOO_CANDIDATE_EMAIL,
    POSITION_TITLE: loo.OPAL_LOO_POSITION_TITLE,
    EMPLOYMENT_BASIS: loo.OPAL_LOO_EMPLOYMENT_BASIS,
    EMPLOYMENT_BASIS_LOWER: loo.OPAL_LOO_EMPLOYMENT_BASIS_LOWER,
    COMMENCEMENT_DATE: loo.OPAL_LOO_COMMENCEMENT_DATE_LONG,
    WORK_LOCATION: t.workLocation || DEFAULTS.workLocation,
    REPORTS_TO: reportsTo,
    HOURS_DESCRIPTION: loo.OPAL_LOO_HOURS_DESCRIPTION,
    AWARD: loo.OPAL_LOO_AWARD,
    CLASSIFICATION: t.awardClassification || 'As notified to you in writing by the Company',
    REMUNERATION_LABEL: loo.OPAL_LOO_REMUNERATION_LABEL,
    REMUNERATION: t.payRate != null && t.payRate !== '' ? loo.OPAL_LOO_REMUNERATION : 'As set out in your Letter of Offer',
    SUPERANNUATION: loo.OPAL_LOO_SUPERANNUATION,
    PAY_CYCLE: loo.OPAL_LOO_PAY_CYCLE,
    PAY_CYCLE_LOWER: String(loo.OPAL_LOO_PAY_CYCLE).toLowerCase(),
    PROBATION: `${probationPeriod(t).replace(/^./, (c) => c.toUpperCase())} from the Commencement Date`,
    PROBATION_PERIOD: probationPeriod(t),
    CPD_ALLOWANCE: cpdAllowance(t),
    ADDITIONAL_TERMS: t.additionalTerms ? String(t.additionalTerms).trim() : null,
    SIGNATORY_NAME: loo.OPAL_LOO_SIGNATORY_NAME,
    SIGNATORY_TITLE: loo.OPAL_LOO_SIGNATORY_TITLE,
    SIGNATORY_EMAIL: loo.OPAL_LOO_SIGNATORY_EMAIL,
    SIGNATORY_PHONE: loo.OPAL_LOO_SIGNATORY_PHONE,
  };
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [TAG_PREFIX + k, v]));
}

const OPTIONS = {
  label: 'Contract of Employment',
  controlParts: CONTROL_PARTS,
  customSectionAnchor: null,
  buildCustomSection: null,
  multilineTags: ['OPAL_COE_ADDITIONAL_TERMS'],
  dropParagraphWhenEmpty: OPTIONAL_LINE_TAGS,
  rebuildToc: false,
};

/** Is this .docx the fillable master (or the practice's edit of it)? */
async function isContractTemplate(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return false;
  try {
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml')?.async('string');
    return !!xml && xml.includes(`w:val="${TAG_PREFIX}`);
  } catch { return false; }
}

/** Fill the master. Throws if a placeholder would survive. */
async function buildContractDocx(input) {
  const scalarData = buildScalars(input);
  const excludedTags = Object.keys(scalarData).filter((k) => scalarData[k] === null);
  const buffer = await composeDocx({
    templateBuffer: input.templateBuffer,
    manifest: { scalarData, excludedTags, sections: [] },
    options: OPTIONS,
  });
  const zip = await JSZip.loadAsync(buffer);
  for (const part of CONTROL_PARTS) {
    const xml = await zip.file(part)?.async('string');
    if (xml && /\[PORTAL\s+[—–-]/.test(xml)) throw new Error(`Contract of Employment: a placeholder survived in ${part}`);
  }
  return buffer;
}

function contractFileName(applicantName) {
  const stem = String(applicantName || 'Employee').replace(/[^A-Za-z0-9 .'-]/g, '').trim().replace(/\s+/g, ' ');
  return `Contract of Employment - ${stem} - Opal Therapy.docx`;
}

module.exports = {
  TAG_PREFIX, TAGS, CONTROL_PARTS, DEFAULTS,
  buildScalars, buildContractDocx, isContractTemplate, contractFileName,
  _internals: { probationPeriod, cpdAllowance },
};
