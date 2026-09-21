'use strict';

/**
 * THE CONTRACT OF EMPLOYMENT — the shipped Stage 2 master, its controls, and
 * the values written into them from the Stage 1 offer terms. Runs the real
 * docx engine against the shipped file, so a rebuild that drops a control, or
 * a scalar with no home in the master, fails here rather than in a pack.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const contract = require('../onboarding-contract-docx');
const offer = require('../onboarding-offer-docx');
const { normaliseTerms } = require('../onboarding-offer-letter');

const MASTER = fs.readFileSync(path.join(__dirname, '..', 'onboarding-templates', 'stage2', 'contract-of-employment.docx'));
const INPUT = {
  templateBuffer: MASTER,
  terms: {
    positionTitle: 'Junior Occupational Therapist', employmentType: 'full_time', startDate: '2026-10-12',
    payBasis: 'annual', payRate: 78000, hoursPerWeek: 38, probationMonths: 6,
    awardClassification: 'Health Professional Level 1, Pay Point 3', cpdAllowance: 1500,
  },
  applicant: { name: 'Harper Testwell', email: 'harper@example.com' },
  issuedAt: new Date('2026-09-21T02:00:00Z'), isTreatingTherapist: true,
};

async function read(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const runs = (x) => (x.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('').replace(/&amp;/g, '&');
  const xml = await zip.file('word/document.xml').async('string');
  return { xml, text: runs(xml), headerText: runs(await zip.file('word/header2.xml').async('string')) };
}

describe('the master', () => {
  test('carries exactly the tags the module writes, and nobody\'s details', async () => {
    const zip = await JSZip.loadAsync(MASTER);
    const parts = (await Promise.all(contract.CONTROL_PARTS.map((p) => zip.file(p).async('string')))).join('');
    const tags = new Set(parts.match(/w:tag w:val="([^"]+)"/g).map((m) => m.replace(/.*"([^"]+)"/, '$1')));
    expect([...tags].sort()).toEqual([...contract.TAGS].sort());
    expect(await contract.isContractTemplate(MASTER)).toBe(true);
    // The corrections: no contractor clauses, no home addresses, no unfinished drafting.
    const { text } = await read(MASTER);
    for (const gone of ['Rostrata', 'Watkins', 'Needs to be decide', '[Insert', 'at its own cost', 'indemnify', 'AOTA', 'HR Department']) expect(text).not.toContain(gone);
    expect(text).toContain('Opal Therapy Pty Ltd');
  });

  test('a contract without the controls is not a template — it is sent as uploaded', async () => {
    expect(await contract.isContractTemplate(offer.readTemplateBuffer())).toBe(false);
    expect(await contract.isContractTemplate(Buffer.from('not a docx'))).toBe(false);
  });
});

describe('the filled contract', () => {
  test('takes every particular from the offer terms, and leaves no placeholder', async () => {
    const { text, headerText } = await read(await contract.buildContractDocx(INPUT));
    expect(text).not.toMatch(/\[PORTAL/);
    expect(headerText).toContain('Contract of Employment | Harper Testwell');
    expect(text).toContain('Contract of Employment — Junior Occupational Therapist');
    expect(text).toContain('Dear Harper,');
    expect(text).toContain('made on 21 September 2026');
    expect(text).toContain('commences on 12 October 2026');
    expect(text).toContain('$78,000 per annum, exclusive of superannuation');
    expect(text).toContain('Health Professional Level 1, Pay Point 3');
    expect(text).toContain('$1,500 per year');
    expect(text).not.toContain('Additional terms agreed');
  });

  test('one probation length feeds every clause that mentions it', async () => {
    const { text } = await read(await contract.buildContractDocx({ ...INPUT, terms: { ...INPUT.terms, probationMonths: 3 } }));
    expect(text).toContain('The first three (3) months of your employment');
    expect(text).toContain('Three (3) months from the Commencement Date');
    expect(text).not.toContain('six (6) months of your employment');
  });

  test('says the same as the Letter of Offer', () => {
    const c = contract.buildScalars(INPUT); const l = offer.buildScalars(INPUT);
    expect(c.OPAL_COE_REMUNERATION).toBe(l.OPAL_LOO_REMUNERATION);
    expect(c.OPAL_COE_HOURS_DESCRIPTION).toBe(l.OPAL_LOO_HOURS_DESCRIPTION);
    expect(c.OPAL_COE_AWARD).toBe(l.OPAL_LOO_AWARD);
    expect(c.OPAL_COE_SUPERANNUATION).toBe(l.OPAL_LOO_SUPERANNUATION);
  });

  test('blank terms fall back to stated defaults; additional terms appear when given', async () => {
    const scalars = contract.buildScalars({ ...INPUT, terms: { positionTitle: 'Occupational Therapist', employmentType: 'full_time', startDate: '2026-10-12' } });
    expect(scalars.OPAL_COE_CPD_ALLOWANCE).toBe(contract.DEFAULTS.cpdAllowance);
    expect(scalars.OPAL_COE_PROBATION_PERIOD).toBe('six (6) months');
    expect(scalars.OPAL_COE_REMUNERATION).toBe('As set out in your Letter of Offer');
    const { text } = await read(await contract.buildContractDocx({ ...INPUT, terms: { ...INPUT.terms, additionalTerms: 'A relocation payment of $2,000.' } }));
    expect(text).toContain('Additional terms agreed for your employment: A relocation payment of $2,000.');
  });
});

describe('the CPD allowance term', () => {
  const base = { positionTitle: 'OT', employmentType: 'full_time', startDate: '2026-10-12' };
  test('is kept when valid and refused when not', () => {
    expect(normaliseTerms({ ...base, cpdAllowance: '1500' }, ['full_time']).terms.cpdAllowance).toBe(1500);
    expect(normaliseTerms({ ...base, cpdAllowance: '-5' }, ['full_time']).errors).toContain('CPD allowance is not valid');
    expect(normaliseTerms(base, ['full_time']).terms.cpdAllowance).toBeNull();
  });
});
