'use strict';

/**
 * THE LETTER OF OFFER DOCUMENT — the template, its controls, and the values
 * written into them. Runs the real docx engine against the shipped template,
 * so a template edit that drops a control, or a scalar the template no
 * longer has a home for, fails here rather than in front of a candidate.
 */

const JSZip = require('jszip');
const docx = require('../onboarding-offer-docx');
const email = require('../onboarding-offer-email');

const ISSUED = new Date('2026-09-03T02:00:00Z');
const OT = {
  terms: {
    positionTitle: 'Occupational Therapist', employmentType: 'full_time', startDate: '2026-10-07',
    payBasis: 'annual', payRate: 90000, hoursPerWeek: 38, awardClassification: 'Health Professional Level 1, Pay Point 3',
    probationMonths: 3,
  },
  applicant: { name: 'Jane Smith', email: 'jane@example.com', mobile: '0412 000 000' },
  issuedAt: ISSUED, isTreatingTherapist: true,
};

async function bodyText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  const header = await zip.file('word/header2.xml').async('string');
  // Text as a reader sees it: w:t runs joined without the gaps that tag
  // stripping would put between "Dear ", "Jane" and ",".
  const runs = (x) => (x.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return { xml, header, text: runs(xml), headerText: runs(header) };
}

describe('the template', () => {
  test('carries every tag the module writes, and nothing personal', async () => {
    const zip = await JSZip.loadAsync(docx.readTemplateBuffer());
    const parts = await Promise.all(docx.CONTROL_PARTS.map((p) => zip.file(p).async('string')));
    const tags = new Set(parts.join('').match(/w:tag w:val="([^"]+)"/g).map((m) => m.replace(/.*"([^"]+)"/, '$1')));
    for (const tag of docx.TAGS) expect(`${tag}:${tags.has(tag)}`).toBe(`${tag}:true`);
    for (const tag of tags) expect(docx.TAGS).toContain(tag);
    expect(parts.join('')).not.toMatch(/Hunter|emmakhunter|0426 997/);
    expect(zip.file('word/comments.xml')).toBeNull();
    // Nowhere in the package — relationships (a mailto: link) and properties included.
    for (const name of Object.keys(zip.files)) {
      if (zip.files[name].dir || /\.(png|jpe?g|emf|wmf)$/i.test(name)) continue;
      const text = await zip.file(name).async('string');
      expect(`${name}:${/Hunter|emmakhunter|0426 997|icloud/.test(text)}`).toBe(`${name}:false`);
    }
    expect(await zip.file('word/document.xml').async('string')).not.toMatch(/<w:hyperlink[^>]*><w:sdt>/);
  });

  test('the acceptance step is a body paragraph, not a list item with numbering switched off', async () => {
    // Word drops a list's indent when numId is 0; docx-preview keeps it, so the
    // preview showed an indent the letter never had. The paragraph is OPALBody.
    const zip = await JSZip.loadAsync(docx.readTemplateBuffer());
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).not.toMatch(/<w:numId w:val="0"\/>/);
    const text = (p) => (p.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('');
    const para = xml.split('</w:p>').find((p) => text(p).includes('Sign and date'));
    expect(para).toBeDefined();
    expect(para).toMatch(/<w:pStyle w:val="OPALBody"\/>/);
    expect(para).not.toMatch(/<w:numPr>/);
  });
});

describe('the scalars', () => {
  test('are derived from the terms in the letter\'s own wording', () => {
    const s = docx.buildScalars(OT);
    expect(s).toMatchObject({
      OPAL_LOO_DATE: '03/09/2026',
      OPAL_LOO_CANDIDATE_FIRST_NAME: 'Jane',
      OPAL_LOO_EMPLOYMENT_BASIS: 'Full-time, ongoing',
      OPAL_LOO_EMPLOYMENT_BASIS_LOWER: 'full-time, ongoing',
      OPAL_LOO_COMMENCEMENT_DATE: '07/10/2026',
      OPAL_LOO_COMMENCEMENT_DATE_LONG: '7 October 2026',
      OPAL_LOO_HOURS_DESCRIPTION: '38 hours per week, worked between 8:30am and 4:30pm (flexible), Monday to Friday',
      OPAL_LOO_REMUNERATION_LABEL: 'Annual Salary',
      OPAL_LOO_REMUNERATION: '$90,000 per annum, exclusive of superannuation',
      OPAL_LOO_SUPERANNUATION: 'Superannuation of 12%, in addition to your salary.',
      OPAL_LOO_PROBATION: 'Three months from the Commencement Date',
      OPAL_LOO_OFFER_CLOSING_DATE: '10/09/2026',
      OPAL_LOO_OFFER_CLOSING_DATE_LONG: '10 September 2026',
      OPAL_LOO_SIGNATORY_NAME: 'Ann Mary Mathew',
      OPAL_LOO_SIGNATORY_FIRST_NAME: 'Ann',
    });
    expect(s.OPAL_LOO_REGISTRATION_CONDITION).toMatch(/AHPRA/);
  });

  test('an hourly casual role reads as one; a non-clinical role loses the registration line', () => {
    const s = docx.buildScalars({
      terms: { positionTitle: 'Administration Officer', employmentType: 'casual', startDate: '2026-10-07', payBasis: 'hourly', payRate: 38.5 },
      applicant: { name: 'Bob Brown' }, issuedAt: ISSUED, isTreatingTherapist: false,
    });
    expect(s.OPAL_LOO_REMUNERATION_LABEL).toBe('Hourly Rate');
    expect(s.OPAL_LOO_REMUNERATION).toBe('$38.50 per hour, exclusive of superannuation, inclusive of casual loading');
    expect(s.OPAL_LOO_HOURS_DESCRIPTION).toMatch(/^Casual hours/);
    expect(s.OPAL_LOO_PROBATION).toBe('Not applicable');
    expect(s.OPAL_LOO_REGISTRATION_CONDITION).toBeNull();
  });

  test('the practice can override the signatory and the offer can override the defaults', () => {
    const s = docx.buildScalars({
      terms: { ...OT.terms, award: 'Clerks Award', payCycle: 'Monthly', superannuationRate: 12.5, offerClosingDate: '2026-09-20' },
      applicant: OT.applicant, issuedAt: ISSUED, signatory: { name: 'Sam Owner', title: 'Practice Manager' },
    });
    expect(s).toMatchObject({ OPAL_LOO_AWARD: 'Clerks Award', OPAL_LOO_PAY_CYCLE: 'Monthly', OPAL_LOO_OFFER_CLOSING_DATE: '20/09/2026', OPAL_LOO_SIGNATORY_NAME: 'Sam Owner', OPAL_LOO_SIGNATORY_TITLE: 'Practice Manager' });
    expect(s.OPAL_LOO_SUPERANNUATION).toContain('12.5%');
    expect(s.OPAL_LOO_SIGNATORY_EMAIL).toBe(docx.DEFAULT_SIGNATORY.email); // unset keys keep the default
  });
});

describe('the filled document', () => {
  test('carries the values, the header names the candidate, and no placeholder survives', async () => {
    const buf = await docx.buildOfferDocx(OT);
    const { text, headerText, xml } = await bodyText(buf);
    for (const needle of ['Dear Jane,', 'Jane Smith', 'jane@example.com', '0412 000 000', 'Occupational Therapist', '7 October 2026', '$90,000 per annum', 'Three months', '10 September 2026', 'AHPRA']) {
      expect(`${needle}:${text.includes(needle)}`).toBe(`${needle}:true`);
    }
    expect(headerText).toContain('Jane Smith');
    expect(xml).not.toMatch(/\[PORTAL/);
    expect(buf.docxStats.warnings).toEqual([]);
  });

  test('a non-clinical letter drops the registration condition line entirely', async () => {
    const buf = await docx.buildOfferDocx({
      terms: { positionTitle: 'Administration Officer', employmentType: 'part_time', startDate: '2026-10-07', hoursPerWeek: 20 },
      applicant: { name: 'Bob Brown', email: 'b@x' }, issuedAt: ISSUED, isTreatingTherapist: false,
    });
    const { text, xml } = await bodyText(buf);
    expect(text).not.toContain('AHPRA');
    expect(text).toContain('Right to work');
    expect(xml).not.toMatch(/\[PORTAL/);
  });

  test('a value that is XML is written as text, never as markup', async () => {
    const buf = await docx.buildOfferDocx({ ...OT, terms: { ...OT.terms, positionTitle: 'OT <b>&</b>' } });
    const { xml } = await bodyText(buf);
    expect(xml).toContain('OT &lt;b&gt;&amp;&lt;/b&gt;');
  });

  test('the file name is safe and dated', () => {
    expect(docx.offerFileName('Jane O\'Brien/Smith', ISSUED)).toBe("Letter of Offer - Jane O'BrienSmith - Opal Therapy - 2026-09-03.docx");
  });
});

describe('Email 1', () => {
  test('is Opal\'s wording with the name and role filled in', () => {
    const e = email.composeOfferEmail({ applicantName: 'Jane Smith', positionTitle: 'Occupational Therapist' });
    expect(e.subject).toBe('Letter of Offer - Opal Therapy');
    expect(e.body.startsWith('Hi Jane,')).toBe(true);
    expect(e.body).toContain('offer you the position of Occupational Therapist with Opal Therapy!');
    expect(e.body).toContain('within 48 hours');
    expect(e.body.trim().endsWith('Director | Opal Therapy')).toBe(true);
    expect(e.body).not.toMatch(/\[Name\]|\[Position Role\]/);
  });

  test('the HTML body keeps paragraphs and escapes', () => {
    const html = email.bodyToHtml('Hi <Jane>,\n\nLine one\nLine two');
    expect(html).toContain('<p style="margin:0 0 12px">Hi &lt;Jane&gt;,</p>');
    expect(html).toContain('Line one<br>Line two');
  });
});
