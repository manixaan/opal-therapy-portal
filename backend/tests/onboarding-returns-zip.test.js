'use strict';

/** A ZIP of returns: each entry is a document; the archive cannot make the server do more than a file could. */

const JSZip = require('jszip');
const { expandZip, isZipMime } = require('../onboarding-returns-zip');

async function zipOf(entries) {
  const z = new JSZip();
  for (const [name, content] of Object.entries(entries)) z.file(name, content);
  return z.generateAsync({ type: 'nodebuffer' });
}

describe('expandZip', () => {
  test('every accepted entry becomes a file with its folder kept as the title', async () => {
    const buf = await zipOf({ 'Returns/contract.txt': 'signed contract', 'Returns/ID/passport.pdf': '%PDF-1.4 fake', 'notes.docx': 'PK' });
    const { files, rejected } = await expandZip(buf);
    expect(rejected).toEqual([]);
    expect(files.map((f) => [f.fileName, f.fileMime, f.title])).toEqual([
      ['contract.txt', 'text/plain', 'Returns / contract.txt'],
      ['passport.pdf', 'application/pdf', 'Returns/ID / passport.pdf'],
      ['notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'notes.docx'],
    ]);
    expect(files[0].buffer.toString()).toBe('signed contract');
  });

  test('Finder noise is skipped silently; other types and nested archives are refused by name', async () => {
    const inner = await zipOf({ 'x.txt': 'x' });
    const buf = await zipOf({ '__MACOSX/._contract.txt': 'junk', '.DS_Store': 'junk', 'Thumbs.db': 'junk', 'macro.xlsm': 'x', 'again.zip': inner, 'ok.txt': 'ok' });
    const { files, rejected } = await expandZip(buf);
    expect(files.map((f) => f.fileName)).toEqual(['ok.txt']);
    expect(rejected.map((r) => r.fileName).sort()).toEqual(['again.zip', 'macro.xlsm']);
    expect(rejected.find((r) => r.fileName === 'again.zip').reason).toMatch(/not opened/);
  });

  test('size and count limits are applied from the declared size, before inflating', async () => {
    const big = Buffer.alloc(3000, 'a');
    const buf = await zipOf({ 'a.txt': big, 'b.txt': big, 'c.txt': 'small', 'd.txt': 'small' });
    const { files, rejected } = await expandZip(buf, { maxEntryBytes: 2500, maxTotalBytes: 100000, maxEntries: 3 });
    expect(files.map((f) => f.fileName)).toEqual(['c.txt']);
    expect(rejected.map((r) => [r.fileName, r.reason])).toEqual([
      ['a.txt', 'That file is too large (10 MB limit).'],
      ['b.txt', 'That file is too large (10 MB limit).'],
      ['d.txt', 'The ZIP holds more than 3 files; the rest were not read.'],
    ]);
    const total = await expandZip(await zipOf({ 'a.txt': big, 'b.txt': big }), { maxTotalBytes: 4000 });
    expect(total.files.map((f) => f.fileName)).toEqual(['a.txt']);
    expect(total.rejected[0].reason).toMatch(/too large once unpacked/);
  });

  test('something that is not a ZIP is reported, not thrown', async () => {
    const { files, rejected } = await expandZip(Buffer.from('%PDF-1.4 not an archive'));
    expect(files).toEqual([]);
    expect(rejected[0].reason).toMatch(/could not be opened/);
    expect(isZipMime('application/zip')).toBe(true);
    expect(isZipMime('application/x-zip-compressed')).toBe(true);
    expect(isZipMime('application/pdf')).toBe(false);
  });
});
