'use strict';

/**
 * LETTER OF OFFER — the terms.
 *
 * normaliseTerms() is the one gate every set of offer terms passes through
 * before it is stored: Start Onboarding and the offer editor both use it.
 * The letter itself is a .docx filled from these terms — see
 * onboarding-offer-docx.js.
 */

const EMPLOYMENT_LABELS = {
  full_time: 'Full-time', part_time: 'Part-time', casual: 'Casual',
  fixed_term: 'Fixed-term', contractor: 'Contractor',
};

/**
 * Normalise and validate the terms a caller supplies. Returns { terms, errors }.
 * Unknown keys are dropped; nothing here is stored without passing through.
 */
function normaliseTerms(input, engineEmploymentTypes) {
  const b = input || {};
  const errors = [];
  const s = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
  const num = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : NaN; };
  const date = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? NaN : String(v).slice(0, 10); };

  const terms = {
    positionTitle: s(b.positionTitle, 150),
    employmentType: s(b.employmentType, 20),
    startDate: date(b.startDate),
    endDate: date(b.endDate),
    payBasis: s(b.payBasis, 10),
    payRate: num(b.payRate),
    hoursPerWeek: num(b.hoursPerWeek),
    awardClassification: s(b.awardClassification, 150),
    probationMonths: num(b.probationMonths),
    workLocation: s(b.workLocation, 150),
    reportsTo: s(b.reportsTo, 150),
    additionalTerms: s(b.additionalTerms, 4000),
    // Letter-only particulars (048). Blank means the template default.
    award: s(b.award, 200),
    payCycle: s(b.payCycle, 40),
    workPattern: s(b.workPattern, 200),
    offerClosingDate: date(b.offerClosingDate),
    superannuationRate: num(b.superannuationRate),
  };
  if (Number.isNaN(terms.offerClosingDate)) errors.push('Offer closing date is not a valid date');
  if (Number.isNaN(terms.superannuationRate) || (terms.superannuationRate != null && (terms.superannuationRate < 0 || terms.superannuationRate > 30))) errors.push('Superannuation rate is not valid');

  if (!terms.positionTitle) errors.push('Position is required');
  if (!engineEmploymentTypes.includes(terms.employmentType)) errors.push('Employment type is not recognised');
  if (terms.startDate === null) errors.push('Commencement date is required');
  if (Number.isNaN(terms.startDate)) errors.push('Commencement date is not a valid date');
  if (Number.isNaN(terms.endDate)) errors.push('End date is not a valid date');
  if (terms.payBasis && !['annual', 'hourly'].includes(terms.payBasis)) errors.push('Pay basis must be annual or hourly');
  if (Number.isNaN(terms.payRate) || (terms.payRate != null && (terms.payRate < 0 || terms.payRate > 10000000))) errors.push('Pay rate is not valid');
  if (terms.payRate != null && !terms.payBasis) errors.push('Pay basis is required when a rate is given');
  if (Number.isNaN(terms.hoursPerWeek) || (terms.hoursPerWeek != null && (terms.hoursPerWeek < 0 || terms.hoursPerWeek > 80))) errors.push('Standard hours must be between 0 and 80');
  if (Number.isNaN(terms.probationMonths) || (terms.probationMonths != null && (terms.probationMonths < 0 || terms.probationMonths > 12 || !Number.isInteger(terms.probationMonths)))) errors.push('Probation must be a whole number of months, up to 12');

  return { terms, errors };
}

module.exports = { normaliseTerms, EMPLOYMENT_LABELS };
