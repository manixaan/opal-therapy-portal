'use strict';

/**
 * Opal Assist — scanned PDFs (frontend/current/assist-composer.js).
 *
 * A PDF page with no real text layer is drawn in the browser (pdf.js) and
 * read by the portal's own OCR (/api/assist/read-image, the picture route),
 * one page at a time, at most MAX_SCAN_PAGES. Only the text is attached.
 * These tests pin the page logic and the boundaries; the OCR route itself is
 * covered by assist-read-image.test.js.
 */

const fs = require('fs');
const path = require('path');
const composer = require('../../frontend/current/assist-composer.js');

const SRC = fs.readFileSync(path.join(__dirname, '../../frontend/current/assist-composer.js'), 'utf8');

describe('scanned PDF pages', () => {
  test('a page with fewer than 20 real characters needs OCR', () => {
    expect(composer.pagesNeedingOcr(['A full page of ordinary selectable text.', '', '   \n  ', 'Page 3', 'x'.repeat(20)])).toEqual([2, 3, 4]);
    expect(composer.pagesNeedingOcr([])).toEqual([]);
  });

  test('render scale: long side about 2400 px, never above 3x', () => {
    expect(Math.round(842 * composer.scanScale(595, 842))).toBe(2400); // A4 portrait
    expect(Math.round(842 * composer.scanScale(842, 595))).toBe(2400); // A4 landscape
    expect(composer.scanScale(200, 300)).toBe(3);                       // a small page is not blown up past 3x
    expect(composer.scanScale(0, 0)).toBe(1);
  });

  test('pages join in order: own text, or what OCR read; blanks drop out', () => {
    expect(composer.joinPages(['Typed page one.', '', ''], { 2: 'Scanned page two.', 3: '' })).toBe('Typed page one.\n\nScanned page two.');
    expect(composer.joinPages(['a', 'b'])).toBe('a\n\nb');
    expect(composer.MAX_SCAN_PAGES).toBe(15);
  });
});

describe('boundaries', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  test('the only network calls are the portal OCR route (and loading its own vendored readers)', () => {
    const fetches = code.match(/fetch\(\s*'[^']*'/g) || [];
    expect([...new Set(fetches)]).toEqual(["fetch('/api/assist/read-image'"]);
    expect(code).not.toMatch(/https?:\/\//);
  });

  test('pages are read one at a time, and a busy OCR is waited for, not hammered', () => {
    expect(code).toMatch(/run = run\.then\(/);                                 // sequential chain
    expect(code).toMatch(/res\.status === 503 && j\.error === 'ocr_busy' && attempt < 4/);
  });

  test('the attachment says it was a scan and how much was read', () => {
    expect(code).toMatch(/'Scanned — text read from '/);
    expect(code).toMatch(/only the first ' \+ MAX_SCAN_PAGES \+ ' scanned pages were read/);
    expect(code).toMatch(/'--- Text read from attached scanned PDF: '/);
  });
});
