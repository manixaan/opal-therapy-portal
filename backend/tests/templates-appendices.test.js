'use strict';

/**
 * TEMPLATE APPENDICES — unit tests over the pure parts of
 * templates/appendices.js: lettering, the headings written into the master's
 * Appendices section, and the PDF merge. No database.
 */

const JSZip = require('jszip');
const { PDFDocument } = require('pdf-lib');

const catalogue = require('../templates/catalogue');
const {
  appendixLetter,
  describeAppendix,
  insertAppendixEntries,
  mergeAppendixPdfs,
  inspectUploadedPdf,
  serialiseAppendix,
} = require('../templates/appendices');

async function pdfWithPages(n) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([595.28, 841.89]);
  return Buffer.from(await doc.save());
}

describe('appendix lettering', () => {
  test('A through Z, then AA', () => {
    expect(appendixLetter(0)).toBe('A');
    expect(appendixLetter(25)).toBe('Z');
    expect(appendixLetter(26)).toBe('AA');
    expect(appendixLetter(27)).toBe('AB');
  });

  test('the description names the kind, the file and the page count — never bytes', () => {
    expect(describeAppendix({ kind: 'pdf', filename: 'OT report.pdf', page_count: 3 }))
      .toBe('Attached PDF · OT report.pdf · 3 pages');
    expect(describeAppendix({ kind: 'whodas', page_count: 1 }))
      .toBe('WHODAS 2.0 completed assessment · 1 page');
  });

  test('the public shape carries ids and sizes only', () => {
    const s = serialiseAppendix({
      id: 'x', kind: 'pdf', title: 'T', filename: 'f.pdf', page_count: 2, byte_size: 10,
      whodas_assessment_id: null, created_at: 'now', file_data: 'SECRET',
    }, 1);
    expect(s).toEqual({
      id: 'x', letter: 'B', kind: 'pdf', title: 'T', filename: 'f.pdf', pageCount: 2,
      byteSize: 10, assessmentId: null, createdAt: 'now',
    });
    expect(JSON.stringify(s)).not.toContain('SECRET');
  });
});

describe('insertAppendixEntries', () => {
  const master = catalogue.readMaster(catalogue.getTemplate('fca'));

  test('writes a lettered heading and a description into the Appendices section, in order', async () => {
    const out = await insertAppendixEntries(master, [
      { kind: 'pdf', title: 'Sensory report', filename: 'sensory.pdf', page_count: 4 },
      { kind: 'whodas', title: 'WHODAS 2.0 — March 2026', page_count: 2 },
    ]);
    const xml = await (await JSZip.loadAsync(out)).file('word/document.xml').async('string');

    const a = xml.indexOf('Appendix A — Sensory report');
    const b = xml.indexOf('Appendix B — WHODAS 2.0 — March 2026');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(xml).toContain('Attached PDF · sensory.pdf · 4 pages. The full document follows this report in the PDF download.');

    // Inside the Appendices section control, after its own content.
    const sectionAt = xml.indexOf('w:val="OPAL_SECTION_APPENDICES"');
    expect(a).toBeGreaterThan(sectionAt);
    // A real heading, so the contents list picks it up.
    const headingPara = xml.slice(xml.lastIndexOf('<w:p>', a), a);
    expect(headingPara).toContain('OPAL–Heading2');
    expect(headingPara).toContain('<w:outlineLvl w:val="1"/>');
  });

  test('no appendices leaves the bytes untouched', async () => {
    expect(await insertAppendixEntries(master, [])).toBe(master);
  });
});

describe('mergeAppendixPdfs', () => {
  test('adds one divider page per appendix followed by that appendix\'s pages', async () => {
    const base = await pdfWithPages(3);
    const a = await pdfWithPages(2);
    const b = await pdfWithPages(5);
    const merged = await mergeAppendixPdfs(base, [
      { letter: 'A', title: 'First', description: 'Attached PDF', bytes: a },
      { letter: 'B', title: 'Second', description: 'Attached PDF', bytes: b },
    ]);
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(3 + (1 + 2) + (1 + 5));
  });

  test('a missing attachment still gets its divider, so the gap is visible', async () => {
    const base = await pdfWithPages(1);
    const merged = await mergeAppendixPdfs(base, [
      { letter: 'A', title: 'Lost', description: 'WHODAS 2.0 completed assessment', bytes: null },
    ]);
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(2);
  });

  test('an unreadable attachment does not sink the export', async () => {
    const base = await pdfWithPages(1);
    const merged = await mergeAppendixPdfs(base, [
      { letter: 'A', title: 'Broken', description: 'Attached PDF', bytes: Buffer.from('%PDF-1.4 garbage') },
    ]);
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(2);
  });

  test('nothing to merge returns the report as-is', async () => {
    const base = await pdfWithPages(2);
    expect(await mergeAppendixPdfs(base, [])).toBe(base);
  });
});

describe('inspectUploadedPdf', () => {
  test('returns the page count of a real PDF', async () => {
    expect(await inspectUploadedPdf(await pdfWithPages(4))).toBe(4);
  });

  test('refuses non-PDF bytes and empty input with a coded error', async () => {
    await expect(inspectUploadedPdf(Buffer.from('hello'))).rejects.toMatchObject({ code: 'not_a_pdf' });
    await expect(inspectUploadedPdf(Buffer.alloc(0))).rejects.toMatchObject({ code: 'invalid_file' });
    await expect(inspectUploadedPdf(Buffer.from('%PDF-1.7 nope'))).rejects.toMatchObject({ code: 'invalid_pdf' });
  });
});
