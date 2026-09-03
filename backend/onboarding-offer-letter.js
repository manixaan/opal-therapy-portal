'use strict';

/**
 * LETTER OF OFFER — one renderer for every surface.
 *
 * The Owner's preview, the public response page and the emailed summary all
 * come from renderOfferLetter(), so what was approved and what the employee
 * reads are the same words by construction. Input is the frozen `terms`
 * snapshot on the offer row plus the practice name; output is escaped HTML
 * and a plain-text twin.
 *
 * Deliberately conservative: a letter of offer is an employment document. The
 * template states the position and terms, points to the enclosed
 * documentation stage for everything else, and does not invent conditions.
 */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const EMPLOYMENT_LABELS = {
  full_time: 'Full-time', part_time: 'Part-time', casual: 'Casual',
  fixed_term: 'Fixed-term', contractor: 'Contractor',
};

function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Perth',
  });
}

function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 });
}

/** The rows of the terms table, in order, from a terms snapshot. */
function termRows(terms) {
  const t = terms || {};
  const rows = [];
  const push = (label, value) => { if (value) rows.push([label, String(value)]); };

  push('Position', t.positionTitle);
  push('Employment type', EMPLOYMENT_LABELS[t.employmentType] || t.employmentType);
  push('Commencement date', fmtDate(t.startDate));
  if (t.endDate) push('End date', fmtDate(t.endDate));
  if (t.payBasis === 'annual' && fmtMoney(t.payRate)) push('Salary', `${fmtMoney(t.payRate)} per annum, plus superannuation`);
  if (t.payBasis === 'hourly' && fmtMoney(t.payRate)) push('Rate of pay', `${fmtMoney(t.payRate)} per hour, plus superannuation`);
  if (t.hoursPerWeek) push('Standard hours', `${t.hoursPerWeek} hours per week`);
  push('Award / classification', t.awardClassification);
  if (Number(t.probationMonths) > 0) push('Probationary period', `${t.probationMonths} month${Number(t.probationMonths) === 1 ? '' : 's'}`);
  push('Location', t.workLocation);
  push('Reports to', t.reportsTo);
  return rows;
}

/**
 * @param {object} p
 * @param {object} p.terms           frozen terms snapshot
 * @param {string} p.applicantName
 * @param {string} p.orgName
 * @param {string|Date} [p.issuedAt]
 * @param {string} [p.signatoryName] who approved the letter
 * @param {string|Date} [p.respondBy]
 */
function renderOfferLetter({ terms, applicantName, orgName, issuedAt, signatoryName, respondBy }) {
  const t = terms || {};
  const org = orgName || 'Opal Therapy';
  const rows = termRows(t);
  const issued = fmtDate(issuedAt || new Date());
  const firstName = String(applicantName || '').trim().split(/\s+/)[0] || 'there';
  const respond = fmtDate(respondBy);

  const paragraphs = [
    `Dear ${firstName},`,
    `On behalf of ${org}, I am pleased to offer you the position of ${t.positionTitle || 'the role discussed'}${t.employmentType ? ` on a ${(EMPLOYMENT_LABELS[t.employmentType] || t.employmentType).toLowerCase()} basis` : ''}${t.startDate && fmtDate(t.startDate) ? `, commencing on ${fmtDate(t.startDate)}` : ''}.`,
    'The principal terms of this offer are set out below. Your employment is subject to the completion of the onboarding documentation, including any statutory checks the position requires, which you will be guided through once you accept.',
  ];
  if (t.additionalTerms) paragraphs.push(String(t.additionalTerms));
  paragraphs.push(
    respond
      ? `Please indicate your acceptance by ${respond}. If you have any questions about this offer, please contact us before responding.`
      : 'Please indicate your acceptance using the secure link you were sent. If you have any questions about this offer, please contact us before responding.',
    `We look forward to welcoming you to ${org}.`,
  );

  const html = ''
    + '<div class="offer-letter">'
    + `<p class="offer-meta">${esc(issued)}</p>`
    + `<h2>Letter of Offer — ${esc(t.positionTitle || 'Employment')}</h2>`
    + paragraphs.slice(0, 3).map((p) => `<p>${esc(p)}</p>`).join('')
    + '<table class="offer-terms"><tbody>'
    + rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')
    + '</tbody></table>'
    + paragraphs.slice(3).map((p) => `<p>${esc(p)}</p>`).join('')
    + '<p class="offer-sign">Yours sincerely,</p>'
    + `<p class="offer-sign"><strong>${esc(signatoryName || org)}</strong><br>${esc(org)}</p>`
    + '</div>';

  const text = [
    issued,
    '',
    `LETTER OF OFFER — ${t.positionTitle || 'Employment'}`,
    '',
    ...paragraphs.slice(0, 3),
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    ...paragraphs.slice(3),
    '',
    'Yours sincerely,',
    signatoryName || org,
    org,
  ].join('\n');

  return { html, text, rows };
}

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
  };

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

module.exports = { renderOfferLetter, termRows, normaliseTerms, EMPLOYMENT_LABELS };
