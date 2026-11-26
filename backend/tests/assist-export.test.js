'use strict';
/** Opal Assist — Word / PowerPoint download, built in the browser from the document on screen. */
const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');
const JSZip = require('jszip');
const ex = require('../../frontend/current/assist-export.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '../../frontend/current', f), 'utf8');
const NAMES = { CLIENT_1: 'Mia Testwell', PERSON_2: 'Jo Example' };
const NOTE = { kind: 'document', title: 'Progress report for [CLIENT_1]', blocks: [
  { t: 'p', text: 'Opening line about [CLIENT_1] & <family>.' },
  { t: 'h', text: 'Supports' },
  { t: 'li', lead: 'Communication', text: 'Calm, clear "boundaries" with [PERSON_2].' },
  { t: 'li', text: 'Line one\nline two' },
  { t: 'h', text: 'Plan' },
  { t: 'p', text: 'Review in 12 weeks.' },
] };

function wellFormed(xml) {
  const errors = [];
  new DOMParser({ onError: (level, msg) => { if (level !== 'warning') errors.push(msg); } }).parseFromString(xml, 'application/xml');
  return errors;
}

describe('Word download', () => {
  const parts = ex.docxParts(NOTE, NAMES, 'full');
  test('every part is well-formed XML', () => {
    Object.entries(parts).forEach(([name, xml]) => expect([name, wellFormed(xml)]).toEqual([name, []]));
  });
  test('names are put back, text is escaped, headings and dot points carry their styles', () => {
    const d = parts['word/document.xml'];
    expect(d).toContain('Progress report for Mia Testwell');
    expect(d).toContain('Opening line about Mia Testwell &amp; &lt;family&gt;.');
    expect(d).not.toMatch(/\[CLIENT_1\]|\[PERSON_2\]/);
    expect(d).toContain('<w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">Supports</w:t>');
    expect(d).toMatch(/ListBullet"\/><\/w:pPr><w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">Communication: <\/w:t>/);
    expect(d).toContain('<w:br/><w:t xml:space="preserve">line two</w:t>');
  });
  test('first-name style follows the page setting', () => {
    expect(ex.docxParts(NOTE, NAMES, 'first')['word/document.xml']).toContain('Opening line about Mia &amp;');
  });
  test('content types declare every part the package carries', () => {
    expect(parts['[Content_Types].xml']).toContain('/word/document.xml');
    expect(parts['[Content_Types].xml']).toContain('/word/numbering.xml');
  });
});

describe('PowerPoint download', () => {
  test('a title slide, then one slide per heading; text before the first heading gets its own slide', () => {
    const slides = ex.slidesFor(ex.restored(NOTE, NAMES, 'full'));
    expect(slides.map((s) => s.title)).toEqual(['Progress report for Mia Testwell', 'Progress report for Mia Testwell', 'Supports', 'Plan']);
    expect(slides[0].cover).toBe(true);
  });
  test('a long section splits across slides marked (cont.)', () => {
    const blocks = [{ t: 'h', text: 'Risks' }].concat(Array.from({ length: 9 }, (_, i) => ({ t: 'li', text: 'Point ' + i })));
    const slides = ex.slidesFor({ blocks });
    expect(slides.map((s) => s.title)).toEqual(['Risks', 'Risks (cont.)']);
    expect(slides[0].blocks).toHaveLength(6);
  });
  test('every part is well-formed, every slide is declared and related', () => {
    const parts = ex.pptxParts(NOTE, NAMES, 'full');
    Object.entries(parts).forEach(([name, xml]) => expect([name, wellFormed(xml)]).toEqual([name, []]));
    const slideNames = Object.keys(parts).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
    expect(slideNames).toHaveLength(4);
    slideNames.forEach((s) => {
      expect(parts['[Content_Types].xml']).toContain('/' + s);
      expect(parts['ppt/_rels/presentation.xml.rels']).toContain(s.replace('ppt/', ''));
    });
    const all = slideNames.map((s) => parts[s]).join('');
    expect(all).toContain('Calm, clear &quot;boundaries&quot; with Jo Example.');
    expect(all).not.toMatch(/\[CLIENT_1\]|\[PERSON_2\]/);
  });
  test('every shape carries a geometry — Keynote drops shapes without one and shows blank slides', () => {
    const parts = ex.pptxParts(NOTE, NAMES, 'full');
    Object.keys(parts).filter((k) => /slide(Master|Layout)?\d+\.xml$/.test(k)).forEach((k) => {
      const shapes = parts[k].match(/<p:sp>/g) || [];
      expect([k, (parts[k].match(/<a:prstGeom prst="rect">/g) || []).length]).toEqual([k, shapes.length]);
    });
  });
  test('an empty document still makes a valid one-slide deck', () => {
    const parts = ex.pptxParts({ blocks: [] }, {}, 'first');
    expect(Object.keys(parts).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))).toHaveLength(1);
  });
});

describe('privacy of the download', () => {
  test('the file name never carries a name — tokens read as roles', () => {
    expect(ex.fileName(NOTE, 'docx')).toBe('Progress report for the client.docx');
    expect(ex.fileName({ title: 'a/b:c*?', blocks: [] }, 'pptx')).toBe('a b c.pptx');
    expect(ex.fileName({ kind: 'casenote', blocks: [] }, 'docx')).toBe('Case note.docx');
  });
  test('the builder makes no network call except loading the portal\'s own jszip', () => {
    const src = read('assist-export.js');
    expect(src).not.toMatch(/fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|\/api\//);
    expect([...new Set(src.match(/src = '[^']+'/g))]).toEqual(["src = '/vendor/jszip.min.js'"]);
  });
  test('download buttons are on the web page only, and the builder loads before assist.js', () => {
    const page = read('assist.html');
    expect(page.indexOf('<script src="/assist-export.js?v=')).toBeGreaterThan(page.indexOf('<script src="/assist-doc.js?v='));
    expect(page.indexOf('<script src="/assist-export.js?v=')).toBeLessThan(page.indexOf('<script src="/assist.js?v='));
    expect(read('assist.js')).toMatch(/S\.surface !== 'web' \? \[\['Insert into document'[\s\S]*?\]\] : \[[\s\S]*?exportDoc\('docx'[\s\S]*?exportDoc\('pptx'/);
  });
});

test('writes real .docx and .pptx samples when ASSIST_EXPORT_SAMPLES is set (manual check in Word / Keynote)', async () => {
  const dir = process.env.ASSIST_EXPORT_SAMPLES;
  if (!dir) return;
  for (const [fmt, parts] of [['docx', ex.docxParts(NOTE, NAMES, 'full')], ['pptx', ex.pptxParts(NOTE, NAMES, 'full')]]) {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', parts['[Content_Types].xml']);
    Object.keys(parts).forEach((k) => { if (k !== '[Content_Types].xml') zip.file(k, parts[k]); });
    fs.writeFileSync(path.join(dir, 'sample.' + fmt), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  }
});
