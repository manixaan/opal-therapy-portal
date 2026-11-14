'use strict';

/**
 * Case Notes workspace (frontend/current/casenotes-workspace.js, 14 Nov 2026):
 * a week of case-noting blocks, one note per client, Opal Assist writing each
 * up through the governed draft routes. Pure helpers, the clinical promises
 * (as source guards, like the composer's), and the real flow in jsdom.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const FRONTEND = path.join(__dirname, '../../frontend/current');
const SRC = fs.readFileSync(path.join(FRONTEND, 'casenotes-workspace.js'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const HTML = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');
const H = require('../../frontend/current/casenotes-workspace.js');

describe('helpers', () => {
  test('weeks run Monday to Sunday and step by seven days', () => {
    expect(H.cnwWeekOf('2026-11-14', 0)).toEqual({ from: '2026-11-09', to: '2026-11-15' });   // a Saturday
    expect(H.cnwWeekOf('2026-11-16', 0)).toEqual({ from: '2026-11-16', to: '2026-11-22' });   // a Monday
    expect(H.cnwWeekOf('2026-11-15', -1)).toEqual({ from: '2026-11-02', to: '2026-11-08' });  // a Sunday, back one
    expect(H.cnwWeekOf('2026-12-30', 1)).toEqual({ from: '2027-01-04', to: '2027-01-10' });
    expect(H.cnwWeekOf('nope', 0)).toBeNull();
  });
  test('labels, clock, Perth dates, notes done', () => {
    expect(H.cnwWeekLabel({ from: '2026-11-09', to: '2026-11-15' })).toBe('9 – 15 Nov 2026');
    expect(H.cnwWeekLabel({ from: '2026-11-30', to: '2026-12-06' })).toBe('30 Nov – 6 Dec 2026');
    expect(H.cnwWeekLabel({ from: '2026-12-28', to: '2027-01-03' })).toBe('28 Dec 2026 – 3 Jan 2027');
    expect(H.cnwClock(3725)).toBe('1:02:05');
    expect(H.cnwClock(65)).toBe('1:05');
    expect(H.cnwPerthYmd(Date.parse('2026-11-14T17:00:00Z'))).toBe('2026-11-15');            // 1am Sunday in Perth
    expect(H.cnwNotesDone({ clients: [{ clientId: 1 }, { clientId: 2 }], notes: { 2: { draftId: 'x' } } })).toBe(1);
  });
});

describe('clinical promises (source guards)', () => {
  test('mounted in the Case Notes tab and loaded after the composer; New case note opens it', () => {
    expect(HTML).toContain('<div id="cnw-root" hidden></div>');
    expect(HTML).toMatch(/<script src="\/casenotes-compose\.js\?v=\d+" defer><\/script>\n<script src="\/casenotes-workspace\.js\?v=\d+" defer><\/script>/);
    const CN = fs.readFileSync(path.join(FRONTEND, 'casenotes.js'), 'utf8');
    expect(CN).toContain('data-cnw="open"');
  });
  test('only the governed draft routes and the block listing — no model door', () => {
    const paths = CODE.match(/'\/api\/[^']*'/g) || [];
    expect(new Set(paths)).toEqual(new Set(["'/api/mobile/case-note-drafts'", "'/api/nf2f/blocks?from='", "'/api/events/'"]));
    for (const banned of ['/api/mobile/ai/', '/api/ai', '/api/opa', '/api/assist', 'bedrock', 'anthropic', 'userId', 'user_id']) {
      expect(CODE).not.toContain(banned);
    }
  });
  test('names are checked first, an edit withdraws the check, failures keep the text', () => {
    expect(CODE).toContain('if (!p.names || p.generating || !p.text.trim()) return;');
    expect(CODE).toContain('if (d.undecided.length) {');
    expect(CODE).toContain('if (p.names) { p.names = null; p.decisions = {}; }');
    const write = CODE.slice(CODE.indexOf('async function writeUp('), CODE.indexOf('async function review('));
    const fail = write.slice(write.indexOf('if (!r.ok) {'), write.indexOf('p.draft = r.caseNoteDraft'));
    expect(fail).not.toMatch(/p\.text\s*=|writeUp\(|api\(/);
  });
  test('no clinical text logged or stored in the browser; no browser dialogs; drafts stay drafts', () => {
    expect(CODE).not.toMatch(/console\s*\./);
    expect(CODE).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(CODE).not.toMatch(/global\.(confirm|prompt|alert)\s*\(|[^.\w](confirm|prompt|alert)\s*\(/);
    for (const banned of ['Approve', 'Finalise', 'finalise', 'Send to Splose', 'Sign off', 'Publish', "/review'"]) {
      expect(CODE).not.toContain(banned);
    }
  });
});

describe('the flow in a page', () => {
  const windows = [];
  afterEach(() => { while (windows.length) windows.pop().close(); });   // stops the timer tick
  function env() {
    const dom = new JSDOM('<div id="cn-root"></div><div id="cnw-root" hidden></div>', { runScripts: 'outside-only', url: 'http://localhost/' });
    const w = dom.window;
    windows.push(w);
    const calls = [];
    const block = { eventId: 'b1', title: 'Case noting', kind: 'case-noting', start: '2026-11-10T02:00:00Z', end: '2026-11-10T03:00:00Z',
      clients: [{ clientId: '11', clientName: 'Al Able' }, { clientId: '12', clientName: 'Bo Baker' }],
      timer: { status: 'IDLE', elapsedSeconds: 0, limitSeconds: 3600 }, notes: {} };
    w.fetch = async (url, o) => {
      calls.push([(o && o.method) || 'GET', url, o && o.body ? JSON.parse(o.body) : null]);
      const json = (x, status = 200) => ({ ok: status < 400, status, json: async () => x });
      if (url.startsWith('/api/nf2f/blocks')) return json({ blocks: [block] });
      if (url === '/api/events/b1/nf2f') return json({ timer: { status: 'IDLE', elapsedSeconds: 0, limitSeconds: 3600 } });
      if (url.startsWith('/api/mobile/case-note-drafts?nf2fEventId=')) return json({ caseNoteDrafts: [] });
      if (url.endsWith('/names-check')) return json({ hidden: [{ label: 'Client', count: 1 }], candidates: [{ word: 'Rosa' }] });
      if (url.endsWith('/generate')) return json({ caseNoteDraft: { id: 'd1', noteBody: 'Therapy Session\n\nIdentify: …', reviewStatus: 'review_required' }, draftId: 'd1', reviewStatus: 'review_required' }, 201);
      return json({}, 404);
    };
    w.eval(SRC);
    const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
    const $ = (sel) => w.document.querySelector(sel);
    const click = (sel) => $(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    return { w, calls, flush, $, click };
  }

  test('week → block → per-client panel → names check → Opal Assist draft linked to the block', async () => {
    const { w, calls, flush, $, click } = env();
    w.CaseNotesWorkspace.open(); await flush();
    expect($('#cn-root').hidden).toBe(true);
    expect(calls[0][1]).toMatch(/^\/api\/nf2f\/blocks\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    expect($('.cnw-block').textContent).toMatch(/2 clients · 0 of 2 notes written/);

    click('[data-cnw="block"]'); await flush();
    expect(w.document.querySelectorAll('.cnw-panel').length).toBe(2);
    expect($('[data-nf2f-start="b1"]')).not.toBeNull();             // the calendar block's own timer button

    const ta = $('#cnw-text-12');
    ta.value = 'Emailed the school about Rosa and the plan.';
    ta.dispatchEvent(new w.Event('input', { bubbles: true }));
    click('[data-cnw="check"][data-cnw-client="12"]'); await flush();
    expect(calls.find((c) => c[1].endsWith('/names-check'))[2]).toMatchObject({ linkedClientId: '12', nf2fEventId: 'b1' });
    expect($('[data-cnw="write"][data-cnw-client="12"]').disabled).toBe(true);   // Rosa not answered yet

    click('[data-cnw="cand-word"][data-cnw-client="12"]');
    click('[data-cnw="write"][data-cnw-client="12"]'); await flush();
    const gen = calls.find((c) => c[1].endsWith('/generate'))[2];
    expect(gen).toMatchObject({ linkedClientId: '12', nf2fEventId: 'b1', ignoredWords: ['Rosa'], confirmedNames: [] });
    expect($('.cnw-draft-body').textContent).toContain('Therapy Session');
    expect($('[data-cnw="review"]').getAttribute('data-cnw-draft')).toBe('d1');
    expect($('#cnw-text-11')).not.toBeNull();                        // the other client is untouched
  });

  test('editing after the names check withdraws it', async () => {
    const { w, flush, $, click } = env();
    w.CaseNotesWorkspace.open(); await flush();
    click('[data-cnw="block"]'); await flush();
    const ta = $('#cnw-text-11');
    ta.value = 'Phone call.'; ta.dispatchEvent(new w.Event('input', { bubbles: true }));
    click('[data-cnw="check"][data-cnw-client="11"]'); await flush();
    expect($('[data-cnw="write"][data-cnw-client="11"]')).not.toBeNull();
    ta.value = 'Phone call with the coordinator.'; ta.dispatchEvent(new w.Event('input', { bubbles: true }));
    expect($('[data-cnw="write"][data-cnw-client="11"]')).toBeNull();
    expect($('[data-cnw="check"][data-cnw-client="11"]')).not.toBeNull();
  });
});
