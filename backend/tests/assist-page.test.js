'use strict';
/** Opal Assist page — the pure token helpers the page renders with. */
const { splitTokens, restoreTokens } = require('../../frontend/current/assist.js');

test('splitTokens separates prose from tokens', () => {
  expect(splitTokens('Hi [CLIENT_1], ring [PHONE_1].')).toEqual([
    { text: 'Hi ' }, { token: 'CLIENT_1' }, { text: ', ring ' }, { token: 'PHONE_1' }, { text: '.' },
  ]);
});
test('restoreTokens puts names back and leaves unknown tokens bracketed', () => {
  expect(restoreTokens('Hi [CLIENT_1], see [CLIENT_2].', { CLIENT_1: 'Aiden Blackwood-Tan' })).toBe('Hi Aiden Blackwood-Tan, see [CLIENT_2].');
});

describe('Word document tools', () => {
  const fs = require('fs'); const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/current/assist-word-format.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../../frontend/current/assist.html'), 'utf8');

  test('formatting is code, never a network call: the file cannot send the document anywhere', () => {
    expect(src).not.toMatch(/fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|\/api\//);
  });
  test('loaded only inside Word', () => {
    expect(page).toMatch(/if \(sf === 'word'\) document\.write\('<script src="\/assist-word-format\.js\?v=\d+">/);
    expect(src).toMatch(/get\('surface'\) !== 'word'\) return;/);
  });
  test('the standard carries Opal colours on the reference structure', () => {
    expect(src).toContain("primary: '#2F5651'");
    expect(src).toMatch(/'Heading 1':\s+\[14, true,\s+'primary', 18, 12, true\]/);
    expect(src).toContain("font: 'Arial'");
  });
  test('no invisible control characters hide in the source', () => {
    const bad = [...src].filter((ch) => { const c = ch.charCodeAt(0); return (c < 32 && c !== 10 && c !== 9 && c !== 13) || c === 160; });
    expect(bad).toEqual([]);
  });
});

describe('shared tool bar, Excel tools and the Word template', () => {
  const fs = require('fs'); const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '../../frontend/current', f), 'utf8');

  test('the tool bar sends the instruction and the surface — nothing else — and only to the actions endpoint', () => {
    const src = read('assist-tools.js');
    expect(src.match(/fetch\(/g)).toHaveLength(1);
    expect(src).toContain("fetch('/api/assist/actions'");
    expect(src).toContain('body: JSON.stringify({ surface: surface, instruction: instruction })');
  });

  test('the Excel tools make no network call at all', () => {
    expect(read('assist-excel-format.js')).not.toMatch(/fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|\/api\//);
  });

  test('plain keyword rules pick the tools without asking the server', () => {
    const g = { document: { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } }, location: { search: '?surface=word' } };
    new Function('window', 'globalThis', 'URLSearchParams', read('assist-tools.js'))(g, g, URLSearchParams);
    ['format', 'tidy', 'pages', 'toc', 'check'].forEach((id) => g.OpalAssistTools._register(id, id, () => {}));
    expect(g.OpalAssistTools._localMatch('please remove any blank pages and make sure the contents page is updated')).toEqual(['tidy', 'toc']);
    expect(g.OpalAssistTools._localMatch('format to Opal standards and make headings start on a new page')).toEqual(['format', 'pages']);
    expect(g.OpalAssistTools._localMatch('are any appendices missing?')).toEqual(['check']);
    expect(g.OpalAssistTools._localMatch('write me a poem')).toEqual([]);
  });

  test('every tool the server can name exists in the pane, and the reverse', () => {
    const { ACTIONS } = require('../assist-routes');
    for (const [surface, file] of [['word', 'assist-word-format.js'], ['excel', 'assist-excel-format.js']]) {
      const ids = [...read(file).matchAll(/\['([a-z]+)', '[^']+', [A-Za-z]+\]/g)].map((m) => m[1]).sort();
      expect(ids).toEqual(Object.keys(ACTIONS[surface]).sort());
    }
  });

  test('the Word template is built from the same standard as the pane', async () => {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(__dirname, '../../frontend/current/office/Opal-Document-Template.dotx')));
    const styles = await zip.file('word/styles.xml').async('string');
    const doc = await zip.file('word/document.xml').async('string');
    const types = await zip.file('[Content_Types].xml').async('string');
    expect(types).toContain('wordprocessingml.template.main+xml');
    expect(styles).toMatch(/w:styleId="Heading1".*?<w:pageBreakBefore\/>.*?w:color="2F5651".*?<w:sz w:val="28"\/>/s);
    expect(styles).toContain('w:styleId="OpalTable"');
    expect(doc).toContain('w:top="1701" w:right="720" w:bottom="1134" w:left="720"');
    expect(doc).toMatch(/TOC \\o "1-3"/);
    // Not one hard page break, and no client text: every paragraph is a placeholder written by the build script.
    expect(doc).not.toContain('w:type="page"');
    const pane = read('assist-word-format.js');
    expect(pane).toContain("primary: '#2F5651'");
  });
});
