'use strict';

/**
 * Every returned document is read, whatever shape it comes back in: a
 * registry certificate with a text layer, the Word copy of a pack form, the
 * prose contract, and — through local OCR — a scan. Same value rules as the
 * fillable PDFs, and no model anywhere.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { PDFDocument, StandardFonts } = require('pdf-lib');

jest.mock('../onboarding-ocr', () => ({ ocrDocument: jest.fn() }));
const ocr = require('../onboarding-ocr');
const reader = require('../onboarding-document-reader');

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const cand = (r, key) => (r.reading.candidates.find((c) => c.key === key) || {}).value;
const messages = (r) => r.reading.check.issues.map((i) => i.message);

/** A one-page PDF with a real text layer: label at the left, value beside it. */
async function certificatePdf(title, rows) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText(title, { x: 50, y: 760, size: 18, font });
  rows.forEach(([label, value], i) => { page.drawText(`${label}:`, { x: 50, y: 700 - i * 26, size: 11, font }); page.drawText(value, { x: 260, y: 700 - i * 26, size: 11, font }); });
  return Buffer.from(await doc.save());
}

/** A PDF with a page and nothing legible on it — what a scan looks like to a text reader. */
async function scanPdf() { const doc = await PDFDocument.create(); doc.addPage([595, 842]); return Buffer.from(await doc.save()); }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
const tbl = (rows) => `<w:tbl>${rows.map((cells) => `<w:tr>${cells.map((c) => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
async function docx(parts) {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parts.join('')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const NED_PARTS = ({ citizen = '☒ Yes☐ No', visa = '' } = {}) => [
  p('OPAL THERAPY'), p('New Employee Details'),
  p('Employee Details'),
  tbl([['First Name:', 'Harper'], ['Middle Name:', 'Quinn'], ['Last Name:', 'Testwell'], ['Date of Birth:', '14/03/1997'], ['Employment Start Date:', '28/09/2026'], ['Role/Position Title:', 'Occupational Therapist'], ['Australian Citizen?', citizen]]),
  p('Emergency Contact Details'),
  tbl([['Name:', 'Jordan Testwell'], ['Relationship to Employee:', 'Sibling'], ['Mobile:', '0491 570 157']]),
  p('Bank Details'),
  tbl([['Account Name:', 'Harper Q Testwell'], ['BSB:', '066-000'], ['Account Number:', '12345678'], ['Superannuation Fund Name:', 'AustralianSuper'], ['Super Member Number / USI:', 'TEST0004567 / USI STA0100AU']]),
  p("Driver's Licence Details"),
  tbl([['Licence Number:', '7654321'], ['State / Territory of Issue:', 'WA'], ['Licence Class:', 'C'], ['Expiry Date:', '14/03/2031'], ["Copy of Driver's Licence (front and back) Attached:", '☐ Attached☐ To follow']]),
  p('Working Rights and Identity Verification'),
  tbl([['Passport Number:', ''], ['Visa Grant Number / VEVO Check (if applicable):', visa]]),
  p('Working With Children Check (WWCC)'),
  tbl([['WWCC Number:', 'WWC0004567'], ['State / Territory of Issue:', 'WA'], ['Expiry Date:', '01/07/2029']]),
  p('Employee Declaration'), p('I, Harper Quinn Testwell consent to this information being collected, held and used for employment and emergency use only.'),
  tbl([['Signature:', 'Harper Quinn Testwell'], ['Date:', '21/09/2026']]),
];

beforeEach(() => { ocr.ocrDocument.mockReset(); });

describe('a certificate with a text layer', () => {
  test('its number and expiry are read from the labels printed on it, with the name and date of birth', async () => {
    const r = await reader.readDocument({ buffer: await certificatePdf("Driver's Licence", [['Full name', 'Harper Quinn Testwell'], ['Date of birth', '14/03/1997'], ['Licence number', '7654321'], ['State of issue', 'WA'], ['Expiry date', '14/03/2031']]), mime: PDF, kindHint: 'drivers_licence' });
    expect(r.text.source).toBe('text_layer');
    expect(r.reading.kind).toBe('drivers_licence');
    expect(cand(r, 'drivers_licence_number')).toBe('7654321');
    expect(cand(r, 'drivers_licence_expiry')).toBe('2031-03-14');
    expect(cand(r, 'surname')).toBe('Testwell');
    expect(cand(r, 'date_of_birth')).toBe('1997-03-14');
    expect(r.reading.check.status).toBe('ok');
    expect(r.reading.candidates.every((c) => c.confidence === 'high')).toBe(true);
    expect(ocr.ocrDocument).not.toHaveBeenCalled();
  });

  test('what is expected and cannot be found is named, never guessed', async () => {
    const r = await reader.readDocument({ buffer: await certificatePdf('Working With Children Check', [['Full name', 'Harper Quinn Testwell'], ['WWCC number', 'WWC0004567']]), mime: PDF, kindHint: 'wwcc' });
    expect(cand(r, 'wwcc_number')).toBe('WWC0004567');
    expect(cand(r, 'wwcc_expiry')).toBeUndefined();
    expect(r.reading.check.status).toBe('attention');
    expect(messages(r).join(' ')).toMatch(/expiry could not be read/i);
  });

  test('the text names the document when the file name does not', async () => {
    const r = await reader.readDocument({ buffer: await certificatePdf('National Police Check Certificate', [['Certificate reference number', 'NPC-TEST-004567'], ['Date of issue', '15/08/2026']]), mime: PDF, kindHint: null });
    expect(r.reading.kind).toBe('police_check');
    expect(cand(r, 'police_check_date')).toBe('2026-08-15');
  });
});

describe('a scan or a photograph', () => {
  test('a page with no text layer goes to local OCR; what comes back is proposed for checking, never as certain', async () => {
    ocr.ocrDocument.mockResolvedValue({ status: 'ocr', pages: ['Certificate of Registration\nFull name: Harper Quinn Testwell\nAHPRA registration number: OCC0001234567\nRegistration expiry date: 30/11/2026'], chars: 120, confidence: 88, pageCount: 1, truncated: false });
    const r = await reader.readDocument({ buffer: await scanPdf(), mime: PDF, kindHint: 'ahpra' });
    expect(ocr.ocrDocument).toHaveBeenCalledTimes(1);
    expect(r.text).toMatchObject({ source: 'ocr', confidence: 88 });
    expect(cand(r, 'ahpra_registration_number')).toBe('OCC0001234567');
    expect(cand(r, 'ahpra_expiry')).toBe('2026-11-30');
    expect(r.reading.candidates.every((c) => c.confidence === 'medium')).toBe(true);
    expect(r.reading.check).toMatchObject({ method: 'ocr', textSource: 'ocr', ocrConfidence: 88 });
  });

  test('an image is read the same way', async () => {
    ocr.ocrDocument.mockResolvedValue({ status: 'ocr', pages: ['Working With Children Check\nWWCC number: WWC0004567\nExpiry date: 01/07/2029'], chars: 60, confidence: 91, pageCount: 1, truncated: false });
    const r = await reader.readDocument({ buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mime: 'image/png', kindHint: 'wwcc' });
    expect(cand(r, 'wwcc_expiry')).toBe('2029-07-01');
  });

  test('nothing legible is reported as nothing read', async () => {
    ocr.ocrDocument.mockResolvedValue({ status: 'no_text', pages: [''], chars: 0, confidence: null, pageCount: 1, truncated: false });
    const r = await reader.readDocument({ buffer: await scanPdf(), mime: PDF, kindHint: 'ahpra' });
    expect(r).toEqual({ text: expect.objectContaining({ source: 'none' }), reading: null });
  });
});

describe('the Word copy of the New Employee Details', () => {
  test('is read against the same spec as the fillable PDF — sections keep "Name", "Expiry Date" and "State" apart', async () => {
    const r = await reader.readDocument({ buffer: await docx(NED_PARTS()), mime: DOCX, kindHint: null });
    expect(r.text.source).toBe('word');
    expect(r.reading.kind).toBe('new_employee_details');
    expect(cand(r, 'legal_first_name')).toBe('Harper');
    expect(cand(r, 'date_of_birth')).toBe('1997-03-14');
    expect(cand(r, 'emergency_name')).toBe('Jordan Testwell');
    expect(cand(r, 'bsb')).toBe('066-000');
    expect(cand(r, 'super_usi')).toBe('STA0100AU');
    expect(cand(r, 'super_member_number')).toBe('TEST0004567');
    expect(cand(r, 'drivers_licence_expiry')).toBe('2031-03-14');
    expect(cand(r, 'wwcc_expiry')).toBe('2029-07-01');
    expect(r.reading.signed).toBe('present');
  });

  test('a completed section implies its unticked box — a licence number means the licence section applies', async () => {
    const r = await reader.readDocument({ buffer: await docx(NED_PARTS()), mime: DOCX });
    expect(cand(r, 'drivers_licence_number')).toBe('7654321');
  });

  test('but a box the employee ticked is never overruled by what they typed elsewhere', async () => {
    const r = await reader.readDocument({ buffer: await docx(NED_PARTS({ citizen: '☒ Yes☐ No', visa: 'Not applicable - Australian citizen' })), mime: DOCX });
    expect(messages(r).join(' ')).not.toMatch(/more than one box is ticked/);
    expect(messages(r).join(' ')).not.toMatch(/Permanent resident/);
  });
});

describe('the prose contract', () => {
  const CONTRACT = [
    p('This Employment Contract is made on this 21 September 2026 by and between: Opal Therapy, and'),
    p('Harper Quinn Testwell, residing at 27 Sample Street, Victoria Park WA 6100.'),
    p('This agreement will commence on the date on which a signed copy of this agreement is returned by the Employee to the Company.'),
    p('Commencement Date: The Employee’s employment will commence on 28 September 2026.'),
    p("Fixed-term/Indefinite: The Employee's employment is indefinite. The role is full-time."),
    p('The Employee will be based at 11 Rostrata Av, Willetton WA 6155 or any other location as directed by the Employer.'),
    p('The Employee will receive a gross annual salary of AUD 92,000.00.'), p('The salary includes compensation for standard working hours of 38 hours per week'),
    p('Harper Quinn Testwell  (signed electronically)'), p('Signature of Employee'), p('Harper Quinn Testwell'), p('Full name of signatory'), p('Date: 21/09/2026'),
  ];
  test('its terms are read from its sentences; the agreement\'s own "will commence on the date…" clause is not a start date', async () => {
    const r = await reader.readDocument({ buffer: await docx(CONTRACT), mime: DOCX });
    expect(r.reading.kind).toBe('contract');
    expect(cand(r, 'start_date')).toBe('2026-09-28');
    expect(cand(r, 'salary_annual')).toBe('92000');
    expect(cand(r, 'hours_per_week')).toBe('38');
    expect(cand(r, 'employment_type')).toBe('full_time');
    expect(cand(r, 'postcode')).toBe('6100');
    expect(r.reading.signed).toBe('present');
    expect(r.reading.check.status).toBe('ok');
  });

  test('an unsigned contract, or one still carrying its placeholders, is not read as complete', async () => {
    const blank = CONTRACT.slice(0, 8).map((x) => x.replace('AUD 92,000.00', 'AUD--------------')).concat([p('__________________________________'), p('Signature of Employee'), p('__________________________________'), p('Full name of signatory'), p('Date')]);
    const r = await reader.readDocument({ buffer: await docx(blank), mime: DOCX });
    expect(r.reading.signed).toBe('missing');
    expect(cand(r, 'salary_annual')).toBeUndefined();
    expect(messages(r).join(' ')).toMatch(/Annual salary is blank/);
  });
});

describe('no model reads a returned document', () => {
  test('neither the reader nor the OCR module reaches the AI gateway, a vendor SDK or the network', () => {
    for (const file of ['onboarding-document-reader.js', 'onboarding-ocr.js', 'onboarding-ocr-worker.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      expect(src).not.toMatch(/require\(['"]\.\/ai\/|@anthropic-ai|bedrock|axios|https?:\/\//i);
    }
  });
  test('the OCR language data is shipped with the portal, not fetched when a document arrives', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'onboarding-ocr.js'), 'utf8');
    expect(src).toContain("@tesseract.js-data/eng");
    expect(src).toContain('langPath');
    expect(fs.existsSync(path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int', 'eng.traineddata.gz'))).toBe(true);
  });
});
