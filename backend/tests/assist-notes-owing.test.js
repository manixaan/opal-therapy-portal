'use strict';

/**
 * Opal Assist — Notes owing panel (frontend/current/assist-notes-owing.js).
 *
 * A thin client over the routes the phone and the Case Notes composer
 * already use. These tests pin:
 *   - the pure helpers (name decisions, refusal wording, labels);
 *   - the whole flow in a DOM with a fake fetch: list → write → names check
 *     → draft linked to THAT appointment → approve; discard keeps the words
 *     and makes the session owed again; "Written in Splose" + Undo;
 *   - the boundaries: only the known endpoints, the transcript only ever in
 *     a JSON body, nothing in browser storage, no console, no Splose write,
 *     and the generate button stays shut until every flagged word is answered.
 * Synthetic data only.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const FRONT = path.join(__dirname, '../../frontend/current');
const SRC = fs.readFileSync(path.join(FRONT, 'assist-notes-owing.js'), 'utf8');
const COMPOSER_SRC = fs.readFileSync(path.join(FRONT, 'assist-composer.js'), 'utf8');
const HTML = fs.readFileSync(path.join(FRONT, 'assist.html'), 'utf8');
const ASSIST_SRC = fs.readFileSync(path.join(FRONT, 'assist.js'), 'utf8');
const ui = require('../../frontend/current/assist-notes-owing.js');

const EV1 = '11111111-1111-4111-8111-111111111111';
const EV2 = '22222222-2222-4222-8222-222222222222';
const DRAFT = '33333333-3333-4333-8333-333333333333';

describe('pure helpers', () => {
  test('nameDecisions splits answered and unanswered words', () => {
    const d = ui.nameDecisions([{ word: 'Bluey' }, { word: 'Stove' }, { word: 'Pat' }, {}], { Bluey: 'person', Stove: 'word' });
    expect(d).toEqual({ confirmedNames: ['Bluey'], ignoredWords: ['Stove'], undecided: ['Pat'] });
    expect(ui.nameDecisions(null, null)).toEqual({ confirmedNames: [], ignoredWords: [], undecided: [] });
  });

  test('generateError words the server refusals', () => {
    expect(ui.generateError({ code: 'generation_unavailable' })).toMatch(/not available/);
    expect(ui.generateError({ code: 'names_not_hidden' })).toMatch(/name/);
    expect(ui.generateError({ code: 'content_blocked' })).toMatch(/declined/);
    expect(ui.generateError({ status: 429 })).toMatch(/wait a minute/);
    expect(ui.generateError({ error: 'Something else' })).toBe('Something else');
  });

  test('labels', () => {
    expect(ui.buttonLabel(0)).toBe('Notes owing');
    expect(ui.buttonLabel(3)).toBe('Notes owing · 3');
    expect(ui.sessionLabel({ clientName: 'Test Client', title: 'OT' })).toBe('Test Client');
    expect(ui.sessionLabel({ title: 'OT session' })).toBe('OT session');
    expect(ui.fmtWhen('2026-11-24T01:00:00Z')).toMatch(/24 Nov.*9:00 am/); // Perth is UTC+8
    expect(ui.fmtWhen('nonsense')).toBe('');
  });
});

describe('source boundaries', () => {
  test('calls only the existing notes-owing and case-note-draft routes', () => {
    const paths = [...new Set(SRC.match(/'\/api\/[^']*'/g))].sort();
    expect(paths).toEqual([
      "'/api/mobile/case-note-drafts/'",
      "'/api/mobile/case-note-drafts/generate'",
      "'/api/mobile/case-note-drafts/names-check'",
      "'/api/mobile/notes-owing'",
      "'/api/mobile/notes-owing/'",
    ]);
    expect(SRC).not.toMatch(/splose\.com|\/api\/splose/i);
  });

  test('no storage, no console, transcript never in a URL', () => {
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|console\./);
    // Only ids are ever put into a path.
    const encoded = code.match(/encodeURIComponent\(([^)]*)\)/g) || [];
    encoded.forEach((e) => expect(e).toMatch(/\.id\)$|\(id\)$/));
  });

  test('the page loads it, web only, and dictation stays on-device', () => {
    expect(HTML).toMatch(/<script src="\/assist-notes-owing\.js\?v=\d+"><\/script>[\s\S]*<script src="\/assist\.js\?v=\d+">/);
    expect(HTML).toMatch(/id="oa-owing"[^>]*hidden/);
    expect(ASSIST_SRC).toMatch(/S\.surface === 'web' && global\.OpalAssistNotesOwing/);
    expect(COMPOSER_SRC).toMatch(/function dictateInto/);
    expect(COMPOSER_SRC).toMatch(/rec\.processLocally !== true\) throw/);
  });
});

// ── The flow, in a DOM ─────────────────────────────────────────────────────

function setup(routes) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/assist' });
  const w = dom.window;
  const calls = [];
  const fetcher = (p, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ path: p, method, body: opts.body });
    const key = `${method} ${p}`;
    const handler = routes[key] || Object.entries(routes).find(([k]) => k.endsWith('*') && key.startsWith(k.slice(0, -1)))?.[1];
    const [status, json] = handler ? handler(opts.body) : [404, { error: 'Not found' }];
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(json) });
  };
  let copied = null;
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: (t) => { copied = t; return Promise.resolve(); } } });
  w.eval(SRC);
  const counts = [];
  const mic = { toggled: 0, released: 0 };
  const composer = {
    dictationState: () => 'ready',
    stopDictation: () => {},
    dictateInto: () => ({ toggle: () => { mic.toggled += 1; }, release: () => { mic.released += 1; } }),
  };
  w.OpalAssistNotesOwing.open({ api: fetcher, composer, onCount: (n) => counts.push(n) });
  const $ = (s) => w.document.querySelector(s);
  const click = (s) => { const el = typeof s === 'string' ? $(s) : s; el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
  const type = (text) => { const ta = $('#oa-no-text'); ta.value = text; ta.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { w, $, click, type, flush, calls, counts, mic, copied: () => copied };
}

const SESSIONS = [
  { id: EV1, title: 'OT home visit', start: '2026-11-24T01:00:00Z', end: '2026-11-24T02:00:00Z', clientName: 'Test Client' },
  { id: EV2, title: 'OT clinic', start: '2026-11-23T01:00:00Z', end: '2026-11-23T02:00:00Z', clientName: 'Other Client' },
];

describe('the panel', () => {
  test('write → names check → draft for that appointment → approve', async () => {
    const t = setup({
      'GET /api/mobile/notes-owing': () => [200, { sessions: SESSIONS, count: 2, windowDays: 7 }],
      'POST /api/mobile/case-note-drafts/names-check': () => [200, { hidden: [{ label: 'The client', count: 1 }], candidates: [{ word: 'Bluey' }] }],
      'POST /api/mobile/case-note-drafts/generate': () => [201, { caseNoteDraft: { id: DRAFT, noteBody: 'Test Client\n\nIdentify:\n\nWorked on kitchen safety.', warnings: ['Check the date'] } }],
      [`POST /api/mobile/case-note-drafts/${DRAFT}/review`]: () => [200, { caseNoteDraft: { id: DRAFT } }],
    });
    await t.flush();
    expect(t.counts).toEqual([2]);
    expect(t.w.document.querySelectorAll('.oa-no-item')).toHaveLength(2);

    t.click(`[data-no="write"][data-id="${EV1}"]`);
    expect(t.$('.oa-no-session').textContent).toMatch(/Test Client/);
    expect(t.$('[data-no="check"]').disabled).toBe(true);
    t.type('Worked on kitchen safety with Bluey.');
    t.click('[data-no="check"]');
    await t.flush();
    const check = t.calls.find((c) => c.path.endsWith('/names-check'));
    expect(check.body).toEqual(expect.objectContaining({ transcript: 'Worked on kitchen safety with Bluey.', linkedEventId: EV1 }));
    expect(check.body.linkedClientId).toBeUndefined();

    // Flagged word unanswered → no drafting.
    expect(t.$('[data-no="generate"]').disabled).toBe(true);
    t.click('[data-no="word"]');
    expect(t.$('[data-no="generate"]').disabled).toBe(false);

    // Editing the words withdraws the check.
    t.type('Worked on kitchen safety with Bluey. Good session.');
    expect(t.$('[data-no="generate"]')).toBeNull();
    t.click('[data-no="check"]'); await t.flush();
    t.click('[data-no="word"]');
    t.click('[data-no="generate"]'); await t.flush();

    const gen = t.calls.find((c) => c.path.endsWith('/generate'));
    expect(gen.method).toBe('POST');
    expect(gen.body).toEqual(expect.objectContaining({ linkedEventId: EV1, ignoredWords: ['Bluey'], confirmedNames: [] }));
    expect(t.$('.oa-no-note').textContent).toMatch(/kitchen safety/);
    expect(t.$('.oa-no-warn').textContent).toMatch(/Check the date/);
    expect(t.$('.oa-no-badge').textContent).toMatch(/read it before you approve/);
    expect(t.$('a.oa-btn').getAttribute('href')).toBe(`/#casenotes/${DRAFT}`);
    expect(t.counts[t.counts.length - 1]).toBe(1); // no longer owed
    expect(t.mic.released).toBe(1);

    t.click('[data-no="copy"]'); await t.flush();
    expect(t.copied()).toMatch(/kitchen safety/);

    t.click('[data-no="approve"]'); await t.flush();
    const review = t.calls.find((c) => c.path.endsWith('/review'));
    expect(review.body).toEqual({ decision: 'approved' });
    expect(t.$('.oa-no-badge').textContent).toMatch(/Approved/);
    // Every path carried ids only; content went in bodies.
    t.calls.forEach((c) => expect(c.path).not.toMatch(/kitchen|Bluey/));

    t.click('[data-no="next"]');
    expect(t.$('.oa-no-session').textContent).toMatch(/Other Client/);
  });

  test('a refused draft keeps the words and is not retried', async () => {
    let gens = 0;
    const t = setup({
      'GET /api/mobile/notes-owing': () => [200, { sessions: SESSIONS, count: 2 }],
      'POST /api/mobile/case-note-drafts/names-check': () => [200, { hidden: [], candidates: [] }],
      'POST /api/mobile/case-note-drafts/generate': () => { gens += 1; return [422, { code: 'content_blocked', error: 'blocked' }]; },
    });
    await t.flush();
    t.click(`[data-no="write"][data-id="${EV1}"]`);
    t.type('Session words.');
    t.click('[data-no="check"]'); await t.flush();
    t.click('[data-no="generate"]'); await t.flush(); await t.flush();
    expect(gens).toBe(1);
    expect(t.$('#oa-no-text').value).toBe('Session words.');
    expect(t.$('#oa-no-msg').textContent).toMatch(/declined.*still here/);
  });

  test('discard makes the session owed again and keeps the words', async () => {
    const t = setup({
      'GET /api/mobile/notes-owing': () => [200, { sessions: SESSIONS, count: 2 }],
      'POST /api/mobile/case-note-drafts/names-check': () => [200, { hidden: [], candidates: [] }],
      'POST /api/mobile/case-note-drafts/generate': () => [201, { caseNoteDraft: { id: DRAFT, noteBody: 'Note' } }],
      [`DELETE /api/mobile/case-note-drafts/${DRAFT}`]: () => [200, { ok: true }],
    });
    await t.flush();
    t.click(`[data-no="write"][data-id="${EV1}"]`);
    t.type('Session words.');
    t.click('[data-no="check"]'); await t.flush();
    t.click('[data-no="generate"]'); await t.flush();
    t.click('[data-no="discard"]'); await t.flush();
    expect(t.calls.some((c) => c.method === 'DELETE' && c.path === `/api/mobile/case-note-drafts/${DRAFT}`)).toBe(true);
    expect(t.$('#oa-no-compose').hidden).toBe(false);
    expect(t.$('#oa-no-text').value).toBe('Session words.');
    expect(t.counts[t.counts.length - 1]).toBe(2);
  });

  test('written in Splose, then Undo', async () => {
    const t = setup({
      'GET /api/mobile/notes-owing': () => [200, { sessions: SESSIONS, count: 2 }],
      [`POST /api/mobile/notes-owing/${EV2}/dismiss`]: () => [200, { ok: true }],
      [`DELETE /api/mobile/notes-owing/${EV2}/dismiss`]: () => [200, { ok: true }],
    });
    await t.flush();
    t.click(`[data-no="dismiss"][data-id="${EV2}"]`); await t.flush();
    expect(t.counts[t.counts.length - 1]).toBe(1);
    expect(t.$('.oa-no-item.muted').textContent).toMatch(/written in Splose/);
    t.click(`[data-no="undo"][data-id="${EV2}"]`); await t.flush();
    expect(t.counts[t.counts.length - 1]).toBe(2);
    expect(t.$('.oa-no-item.muted')).toBeNull();
  });

  test('empty and failed lists', async () => {
    let t = setup({ 'GET /api/mobile/notes-owing': () => [200, { sessions: [], count: 0 }] });
    await t.flush();
    expect(t.$('.oa-no-done').textContent).toMatch(/All caught up/);
    t = setup({ 'GET /api/mobile/notes-owing': () => [500, { error: 'Something went wrong' }] });
    await t.flush();
    expect(t.$('.oa-cf-empty.bad').textContent).toMatch(/Something went wrong/);
    expect(t.counts).toEqual([]);
  });
});
