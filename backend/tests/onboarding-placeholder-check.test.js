'use strict';

/**
 * PLACEHOLDER CHECK — owner decision 4 (Oct 2026): a document that still has
 * "[TO CONFIRM …]" gaps, a "PLACEHOLDER - …" stand-in file, a dev stub or an
 * empty version never reaches a starter.
 */

const JSZip = require('jszip');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const check = require('../onboarding-placeholder-check');

async function pdf(text) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 40, y: 780, size: 11, font });
  return Buffer.from(await doc.save());
}

async function docx(text) {
  const zip = new JSZip();
  zip.file('word/document.xml', `<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('textProblem', () => {
  test.each([
    ['Responsible person: [TO CONFIRM: name and role]'],
    ['effective [ to confirm date]'],
    ['Lone Worker Policy\n\nDev QA content.'],
    ['PLACEHOLDER\nStaff Handbook'],
  ])('flags %j', (text) => {
    expect(check.textProblem(text)).toBeTruthy();
  });
  test('passes finished wording', () => {
    expect(check.textProblem('The practice confirms this policy. Contact the Director on 0484 827 212.')).toBeNull();
  });
});

describe('fileProblem', () => {
  test('reads the words out of a PDF and a Word file', async () => {
    expect(await check.fileProblem({ buffer: await pdf('Notice: [TO CONFIRM: weeks] before ending this agreement'), mime: 'application/pdf', fileName: 'c.pdf' })).toMatch(/TO CONFIRM/);
    expect(await check.fileProblem({ buffer: await docx('Probation: [TO CONFIRM] months for this role'), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: 'c.docx' })).toMatch(/TO CONFIRM/);
    expect(await check.fileProblem({ buffer: await pdf('A finished employment contract between the practice and the employee.'), mime: 'application/pdf', fileName: 'c.pdf' })).toBeNull();
  });
  test('a "PLACEHOLDER - " file name or an empty file is refused without reading it', async () => {
    expect(await check.fileProblem({ buffer: Buffer.from('x'), mime: 'application/pdf', fileName: 'PLACEHOLDER - Staff Handbook.pdf' })).toMatch(/placeholder/);
    expect(await check.fileProblem({ buffer: Buffer.alloc(0), mime: 'application/pdf', fileName: 'x.pdf' })).toMatch(/empty/);
  });
});

describe('versionProblem', () => {
  test('a body with gaps, a placeholder file, or nothing at all is refused; an official link is not', async () => {
    expect(await check.versionProblem({ body: 'Policy\n[TO CONFIRM: date]' })).toMatch(/TO CONFIRM/);
    expect(await check.versionProblem({ file_name: 'PLACEHOLDER - Handbook.pdf', file_data: 'eA==' })).toMatch(/placeholder/);
    expect(await check.versionProblem({ body: '' })).toMatch(/empty/);
    expect(await check.versionProblem(null)).toMatch(/no published version/);
    expect(await check.versionProblem({ body: '', source_url: 'https://www.fairwork.gov.au/' })).toBeNull();
    expect(await check.versionProblem({ body: 'Finished policy text the practice has approved.' })).toBeNull();
  });
});
