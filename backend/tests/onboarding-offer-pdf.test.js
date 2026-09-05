'use strict';

/**
 * Letter of Offer — the PDF is read from the .docx, so it says what Word says.
 */

const { PDFDocument } = require('pdf-lib');
const docx = require('../onboarding-offer-docx');
const pdf = require('../onboarding-offer-pdf');

const OT = {
  terms: {
    positionTitle: 'Occupational Therapist', employmentType: 'full_time', startDate: '2026-10-07',
    payBasis: 'annual', payRate: 90000, hoursPerWeek: 38, awardClassification: 'Health Professional Level 1, Pay Point 3',
    probationMonths: 3,
  },
  applicant: { name: 'Jane Smith', email: 'jane@example.com', mobile: '0412 000 000' },
  issuedAt: new Date('2026-09-03T02:00:00Z'), isTreatingTherapist: true,
};

const text = (block) => block.type === 'paragraph' ? block.segments.map((s) => s.text || '').join('') : '';

describe('the model the PDF is rendered from', () => {
  test('carries the filled values as text, never as an empty form field', async () => {
    const model = await pdf.offerPdfModel(await docx.buildOfferDocx(OT));
    const all = model.blocks.map(text).join('\n');
    expect(all).toContain('Offer of Employment — Occupational Therapist');
    expect(all).toContain('Dear Jane,');
    expect(all).toContain('7 October 2026');
    expect(all).not.toMatch(/\[PORTAL/);
    expect(model.fields).toEqual([]);
    expect(model.blocks.some((b) => b.type === 'paragraph' && b.segments.some((s) => s.type === 'field'))).toBe(false);
    // The particulars table reaches the PDF with its values.
    const table = model.blocks.find((b) => b.type === 'table');
    const cells = table.rows.map((r) => r.cells.map((c) => c.map((p) => p.map((s) => s.text || '').join('')).join('')));
    expect(cells).toContainEqual(['Annual Salary', '$90,000 per annum, exclusive of superannuation']);
  });

  test('headings keep their weight and numbered clauses keep their numbers', async () => {
    const model = await pdf.offerPdfModel(await docx.buildOfferDocx(OT));
    const byText = (t) => model.blocks.find((b) => text(b).startsWith(t) || text(b).includes(t));
    expect(byText('Offer of Employment').role).toBe('h1');
    expect(byText('Conditions Precedent to Employment').role).toBe('h2');
    expect(byText('The NDIS Worker Orientation Module').role).toBe('list');
    expect(text(byText('Right to work'))).toMatch(/^1\.\s+Right to work/);
    expect(text(byText('Professional registration'))).toMatch(/^2\.\s+Professional registration/);
    expect(text(byText('NDIS Worker Screening Check'))).toMatch(/^3\.\s+/);
    // Numbering restarts for the acceptance clauses at the end of the letter.
    expect(text(byText('This Letter of Offer records the principal terms of the offer only, and the complete'))).toMatch(/^1\.\s+/);
  });

  test('a dropped condition closes the gap in the numbering', async () => {
    const model = await pdf.offerPdfModel(await docx.buildOfferDocx({ ...OT, isTreatingTherapist: false, terms: { ...OT.terms, positionTitle: 'Practice Coordinator' } }));
    const all = model.blocks.map(text).join('\n');
    expect(all).not.toContain('Professional registration');
    expect(all).toMatch(/\n2\.\s+NDIS Worker Screening Check/);
  });
});

describe('the PDF', () => {
  test('is a real, titled PDF with the letter on more than one page', async () => {
    const bytes = await pdf.offerPdfFromDocx(await docx.buildOfferDocx(OT), { title: 'Letter of Offer — Jane Smith' });
    expect(bytes.slice(0, 5).toString('latin1')).toBe('%PDF-');
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(1);
    expect(loaded.getTitle()).toBe('Letter of Offer — Jane Smith');
    expect(loaded.getAuthor()).toBe('Opal Therapy');
  });

  test('the acceptance block is a form the candidate can type into', async () => {
    const bytes = await pdf.offerPdfFromDocx(await docx.buildOfferDocx(OT));
    const loaded = await PDFDocument.load(bytes);
    const names = loaded.getForm().getFields().map((f) => f.getName());
    expect(names).toEqual(expect.arrayContaining(['Full Name', 'Signature', 'Date']));
    // The particulars table is filled, so nothing there became a field.
    expect(names).not.toContain('Position Title');
    expect(names).not.toContain('Annual Salary');
  });

  test('takes the .docx file name and changes only the extension', () => {
    expect(pdf.pdfFileName('Letter of Offer - Jane Smith - Opal Therapy - 2026-09-03.docx')).toBe('Letter of Offer - Jane Smith - Opal Therapy - 2026-09-03.pdf');
    expect(pdf.pdfFileName('edited copy.DOCX')).toBe('edited copy.pdf');
  });

  test('a file that is not a .docx is refused, not rendered as an empty letter', async () => {
    await expect(pdf.offerPdfFromDocx(Buffer.from('%PDF-1.7 not a docx'))).rejects.toThrow();
  });
});
