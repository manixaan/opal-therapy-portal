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

  test('cursor and detail tools are picked by plain words, without stealing the older rules', () => {
    const g = { document: { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } }, location: { search: '?surface=word' } };
    new Function('window', 'globalThis', 'URLSearchParams', read('assist-tools.js'))(g, g, URLSearchParams);
    ['format', 'tidy', 'pages', 'toc', 'check', 'break', 'section', 'header', 'footer', 'style', 'table', 'layout', 'margins', 'orientation', 'firstpage', 'refs', 'recs', 'write', 'rephrase', 'strengthen', 'finding', 'formatcheck'].forEach((id) => g.OpalAssistTools._register(id, id, () => {}));
    const m = g.OpalAssistTools._localMatch;
    expect(m('insert a page break here')).toEqual(['break']);
    expect(m('add a section break')).toEqual(['section']);
    expect(m('set the header to "Functional Capacity Assessment"')).toEqual(['header']);
    expect(m('footer with page numbers')).toEqual(['footer']);
    expect(m('make this a heading 2')).toEqual(['style']);
    expect(m('insert a 4 x 3 table')).toEqual(['table']);
    expect(m('update the table of contents')).toEqual(['toc']);
    expect(m('attach the layout')).toEqual(['layout']);
    expect(m('set narrow margins')).toEqual(['margins']);
    expect(m('make it landscape')).toEqual(['orientation']);
    expect(m('different header on the first page')).toEqual(['firstpage']);
    expect(m('cover page footer')).toEqual(['firstpage']);
    expect(m('fix the captions and cross references')).toEqual(['refs']);
    expect(m('put the recommendations in the overview table')).toEqual(['recs']);
    expect(m('rephrase this for the parents')).toEqual(['rephrase']);
    expect(m('strengthen this recommendation')).toEqual(['strengthen']);
    expect(m('write the key finding')).toEqual(['finding']);
    expect(m('are any appendices missing?')).toEqual(['check']);
    expect(m('run a format check')).toEqual(['formatcheck']);
    expect(m('format this to the Opal standard')).toEqual(['format']);
    // A question never runs a tool that changes the document by keyword alone.
    expect(m('make headings start on a new page')).toEqual(['pages']);
  });

  test('the person\'s own words reach the tool: the detail is parsed in the pane, never supplied by the model', async () => {
    const seen = [];
    const g = { document: { addEventListener() {}, querySelector() { return null; }, getElementById() { return null; } }, location: { search: '?surface=word' } };
    new Function('window', 'globalThis', 'URLSearchParams', read('assist-tools.js'))(g, g, URLSearchParams);
    g.OpalAssistTools._register('header', 'Set header', (typed) => { seen.push(typed); return 'ok'; });
    global.document = g.document; // the bar's status line looks the element up on the bare global
    try { await g.OpalAssistTools.run(['header'], 'header "Report"'); } finally { delete global.document; }
    expect(seen).toEqual(['header "Report"']);
  });

  test('the front row is the FCA workflow; page setup and cursor tools are reachable by words only', () => {
    const src = read('assist-word-format.js');
    const visible = [...src.matchAll(/\['([a-z]+)', '[^']+', [A-Za-z]+(?:\('[a-z]+'\))?\]/g)].map((m) => m[1]);
    expect(visible).toEqual(['formatcheck', 'format', 'check', 'refs', 'recs', 'table', 'toc', 'write', 'rephrase', 'strengthen', 'finding']);
    const hidden = [...src.matchAll(/\['([a-z]+)', '[^']+', [A-Za-z]+, true\]/g)].map((m) => m[1]);
    expect(hidden).toEqual(expect.arrayContaining(['margins', 'orientation', 'firstpage', 'header', 'footer', 'break', 'section']));
    // Writing shortcuts never call the model themselves: they fill the chat box and the person presses Send.
    expect(src).toContain("box.value = WRITING[kind]; box.focus();");
    expect(src).not.toMatch(/fetch\s*\(|XMLHttpRequest|sendBeacon|\/api\//);
  });

  test('format check findings carry a locator and, where safe, a fix; Fix all runs from the end of the document', () => {
    const fmt = read('assist-word-format.js'); const tools = read('assist-tools.js');
    // Every finding has show:; rules that need judgement carry fix: null rather than a guess.
    expect((fmt.match(/F\.push\(\{ rule: '[a-z]+', text: /g) || []).length).toBeGreaterThanOrEqual(12);
    expect(fmt).toMatch(/rule: 'jump'[^\n]*fix: null/);
    expect(fmt).toMatch(/rule: 'fakehead'[^\n]*fix: null/);
    expect(fmt).toMatch(/rule: 'toc'[^\n]*fix: updateContents/);
    expect(fmt).toContain("select('Select')");
    expect(tools).toContain('fixable.slice().reverse().reduce(');
    expect(fmt).not.toMatch(/fetch\s*\(|XMLHttpRequest|sendBeacon|\/api\//);
  });

  test('the finish check knows the FCA master: unfilled prompts, guidance blocks, OPAL headings', () => {
    const g = { document: { addEventListener() {} }, location: { search: '?surface=word' }, OpalAssistTools: { mount() {} } };
    new Function('window', 'globalThis', 'URLSearchParams', read('assist-word-format.js'))(g, g, URLSearchParams);
    const w = g.OpalAssistWordFormat;
    expect(w._levelOf({ style: 'OPAL – Heading 2' })).toBe(2);
    expect(w._levelOf({ styleBuiltIn: 'Heading1' })).toBe(1);
    expect(w._levelOf({ style: 'OPAL – Body' })).toBe(0);
    expect(w._UNFILLED.test('[Describe initiation, drive, interest]')).toBe(true);
    expect(w._UNFILLED.test('[PARTICIPANT GOAL / MEASURABLE OUTCOME]')).toBe(true);
    expect(w._UNFILLED.test('The participant [name withheld] attended.')).toBe(false);
    expect(w._UNFILLED.test('Aiden reported fatigue after 20 minutes.')).toBe(false);
  });

  test('Word detail parsers: wording, style and table size', () => {
    const g = { document: { addEventListener() {} }, location: { search: '?surface=word' }, OpalAssistTools: { mount() {} } };
    new Function('window', 'globalThis', 'URLSearchParams', read('assist-word-format.js'))(g, g, URLSearchParams);
    const w = g.OpalAssistWordFormat;
    expect(w._wordingFor('header', 'set the header to "Functional Capacity Assessment"')).toBe('Functional Capacity Assessment');
    expect(w._wordingFor('footer', 'footer: Opal Therapy with page numbers')).toBe('Opal Therapy');
    expect(w._wordingFor('header', "fix Noah's header")).toBe('');
    expect(w._styleFor('make this a heading 2')[1]).toBe('Heading2');
    expect(w._styleFor('turn it into the subtitle')[1]).toBe('Subtitle');
    expect(w._styleFor('make it nicer')).toBeNull();
    expect(w._tableSizeFor('insert a 4 x 3 table')).toEqual([4, 3]);
    expect(w._tableSizeFor('table with 5 rows and 2 columns')).toEqual([5, 2]);
    expect(w._tableSizeFor('a 99 by 99 table')).toEqual([30, 10]);
    expect(w._tableSizeFor('add a table')).toEqual([3, 3]);
  });

  test('the layout summary goes to the chat only as selected content — the guarded, reviewed channel', () => {
    const src = read('assist-word-format.js');
    expect(src).toContain('global.OpalAssist.setSelection(summary)');
    expect(src).not.toMatch(/fetch\s*\(|XMLHttpRequest|sendBeacon|\/api\//);
    // The summary loads paragraph text only to pick out headings; body paragraphs are never pushed into it.
    expect(src).toMatch(/if \(l && outline < 150\)/);
  });

  test('inside Word the prompt admits it cannot operate Word and names the tools; elsewhere it says nothing of them', () => {
    const { buildSystemPrompt } = require('../assist/assist-prompt');
    const word = buildSystemPrompt({ user: { name: 'Sam T' }, surface: 'word' });
    expect(word).toContain('You cannot see or operate Word');
    expect(word).toContain('Attach layout to chat');
    expect(word).toContain('Set margins');
    expect(word).not.toContain('are not something the pane can change');
    // Page setup is gated in the pane on the desktop-only API set, never assumed.
    expect(read('assist-word-format.js')).toMatch(/if \(!supportsDesktop\('1\.3'\)\) return Promise\.resolve\(OLD_WORD\);[\s\S]*pageSetup/);
    expect(buildSystemPrompt({ user: { name: 'Sam T' }, surface: 'web' })).not.toContain('HELPING WITH WORD');
  });

  test('every tool the server can name exists in the pane, and the reverse', () => {
    const { ACTIONS } = require('../assist-routes');
    for (const [surface, file] of [['word', 'assist-word-format.js'], ['excel', 'assist-excel-format.js']]) {
      const ids = [...read(file).matchAll(/\['([a-z]+)', '[^']+', [A-Za-z]+(?:\('[a-z]+'\))?(?:, true)?\]/g)].map((m) => m[1]).sort();
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
