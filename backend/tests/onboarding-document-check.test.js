'use strict';

/**
 * The portal reads an uploaded document before it counts. These build the
 * real letter of offer PDF, fill (or leave) its acceptance fields, and check
 * what the reading says — plus a Word form and the unreadable kinds.
 */

const { PDFDocument } = require('pdf-lib');
const JSZip = require('jszip');
const docx = require('../onboarding-offer-docx');
const pdf = require('../onboarding-offer-pdf');
const check = require('../onboarding-document-check');

const OT = {
  terms: {
    positionTitle: 'Occupational Therapist', employmentType: 'full_time', startDate: '2026-10-07',
    payBasis: 'annual', payRate: 90000, hoursPerWeek: 38, awardClassification: 'Health Professional Level 1, Pay Point 3',
    probationMonths: 3,
  },
  applicant: { name: 'Jane Smith', email: 'jane@example.com', mobile: '0412 000 000' },
  issuedAt: new Date('2026-09-03T02:00:00Z'), isTreatingTherapist: true,
};
const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function letterPdf(fill) {
  const out = await pdf.offerPdfFromDocx(await docx.buildOfferDocx(OT));
  const bytes = out.bytes || out.buffer || out;
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  for (const [name, value] of Object.entries(fill || {})) form.getTextField(name).setText(value);
  return Buffer.from(await doc.save());
}

describe('onboarding document check', () => {
  test('a fully completed letter of offer is ok, with the values read back', async () => {
    const buf = await letterPdf({ 'Full Name': 'Jane Smith', Signature: 'J. Smith', Date: '10/09/2026', 'Commencement Date Confirmed': '07/10/2026' });
    const r = await check.checkDocument({ buffer: buf, mime: PDF, expect: check.LETTER_OF_OFFER_EXPECT, keepValues: true });
    expect(r.status).toBe('ok');
    expect(r.method).toBe('pdf_form');
    expect(r.issues).toEqual([]);
    expect(r.fields.find((f) => f.label === 'Full Name')).toMatchObject({ filled: true, preview: 'Jane Smith' });
    expect(check.summarise(r)).toMatch(/all filled in/);
  });

  test('an unsigned letter with a blank date is flagged, and the optional row is not', async () => {
    const buf = await letterPdf({ 'Full Name': 'Jane Smith' });
    const r = await check.checkDocument({ buffer: buf, mime: PDF, expect: check.LETTER_OF_OFFER_EXPECT, keepValues: true });
    expect(r.status).toBe('attention');
    expect(r.issues.map((i) => i.code).sort()).toEqual(['blank', 'unsigned']);
    expect(check.summarise(r)).toContain('The signature line is empty');
    expect(check.summarise(r)).toContain('Date is blank');
    expect(check.summarise(r)).not.toContain('Commencement');
  });

  test('a flattened letter is read from its text', async () => {
    const buf = await letterPdf({ 'Full Name': 'Jane Smith', Signature: 'Jane Smith', Date: '10/09/2026' });
    const doc = await PDFDocument.load(buf); doc.getForm().flatten();
    const flat = Buffer.from(await doc.save());
    const r = await check.checkDocument({ buffer: flat, mime: PDF, expect: check.LETTER_OF_OFFER_EXPECT, keepValues: true });
    expect(r.method).toBe('pdf_text');
    expect(r.status).toBe('ok');
  });

  test('a returned form without an expectation lists its own blanks, and never keeps values', async () => {
    const doc = await PDFDocument.create(); const page = doc.addPage([400, 300]); const form = doc.getForm();
    const f1 = form.createTextField('Name'); f1.addToPage(page, { x: 20, y: 200, width: 200, height: 20 }); f1.setText('Jane');
    const f2 = form.createTextField('Tax file number'); f2.addToPage(page, { x: 20, y: 150, width: 200, height: 20 }); f2.setText('123 456 789');
    const f3 = form.createTextField('Signature'); f3.addToPage(page, { x: 20, y: 100, width: 200, height: 20 });
    const r = await check.checkDocument({ buffer: Buffer.from(await doc.save()), mime: PDF });
    expect(r.status).toBe('attention');
    expect(r.issues).toEqual([{ code: 'blank', message: 'Signature is blank' }]);
    expect(r.fields.every((f) => f.preview === undefined)).toBe(true);
  });

  test('a Word form: the value cell beside each label, and a placeholder content control', async () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Full Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Jane Smith</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Emergency contact</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>
      <w:p><w:sdt><w:sdtPr><w:alias w:val="Preferred name"/><w:showingPlcHdr/></w:sdtPr><w:sdtContent><w:r><w:t>Click here to enter text.</w:t></w:r></w:sdtContent></w:sdt></w:p>
      </w:body></w:document>`;
    const zip = new JSZip(); zip.file('word/document.xml', xml);
    const r = await check.checkDocument({ buffer: await zip.generateAsync({ type: 'nodebuffer' }), mime: DOCX });
    expect(r.method).toBe('docx');
    expect(r.fields.map((f) => [f.label, f.filled])).toEqual([['Preferred name', false], ['Full Name', true], ['Emergency contact', false]]);
    expect(r.issues.map((i) => i.message)).toEqual(['Preferred name is blank', 'Emergency contact is blank']);
  });

  test('a photo, a scan and a broken file are unreadable, never ok', async () => {
    expect((await check.checkDocument({ buffer: Buffer.from('x'), mime: 'image/jpeg' })).status).toBe('unreadable');
    expect((await check.checkDocument({ buffer: Buffer.from('%PDF-1.4 not really'), mime: PDF })).status).toBe('unreadable');
    const scan = await PDFDocument.create(); scan.addPage([300, 300]);
    const r = await check.checkDocument({ buffer: Buffer.from(await scan.save()), mime: PDF, expect: check.LETTER_OF_OFFER_EXPECT });
    expect(r.status).toBe('unreadable');
    expect(check.summarise(r)).toMatch(/check it by eye/);
  });
});
