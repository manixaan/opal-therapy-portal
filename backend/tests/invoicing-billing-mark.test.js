'use strict';

/**
 * The calendar's "Bill this session" control (invoicing.js): the default
 * option says what the completion rule does for this session, the wording
 * fits, and the select leaves room for its arrow so nothing is cut off.
 */

const fs = require('fs');
const path = require('path');
const FRONTEND = path.join(__dirname, '../../frontend/current');
const JS = fs.readFileSync(path.join(FRONTEND, 'invoicing.js'), 'utf8');
const CSS = fs.readFileSync(path.join(FRONTEND, 'invoicing.css'), 'utf8');

function helpers(settings) {
  const src = JS.slice(JS.indexOf('  function completionRule()'), JS.indexOf('  // ── Actions (delegated)'));
  return new Function('state', src + '; return { autoLabel, autoHelp };')({ settings });
}

test('the default option names what the completion rule does', () => {
  expect(helpers({ settings: { completionRule: 'PAST_CONFIRMED' } }).autoLabel()).toBe('Automatic — bill once it has happened');
  expect(helpers({ settings: { completionRule: 'EXPLICIT_ONLY' } }).autoLabel()).toBe('Automatic — only once marked Completed');
  expect(helpers(null).autoLabel()).toBe('Automatic (completion rule)');
  expect(helpers({ settings: { completionRule: 'EXPLICIT_ONLY' } }).autoHelp()).toMatch(/only after you mark it Completed/);
});

test('the control reads as a question about this session and loads the rule when it opens', () => {
  expect(JS).toContain('>Bill this session</label>');
  expect(JS).not.toContain('Default (per completion rule)');
  expect(JS).toContain("var settingsReady = state.settings ? Promise.resolve() : get('/settings')");
});

test('the select leaves room for its arrow', () => {
  expect(CSS).toMatch(/\.inv-cal-billing select \{[^}]*padding: 4px 28px 4px 8px;/);
});

describe('the Invoicing tab loads however it is opened', () => {
  const { JSDOM } = require('jsdom');
  const flush = (ms) => new Promise((r) => setTimeout(r, ms));
  function page() {
    const dom = new JSDOM('<body><div class="tab" data-tab="invoicing"></div><section id="view-invoicing" class="view"><div class="inv-page" id="inv-root"><div class="inv-note">Loading invoicing…</div></div></section><div id="calendar-toolbar"></div></body>',
      { runScripts: 'outside-only', url: 'http://localhost/' });
    const calls = [];
    dom.window.fetch = async (url) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => ({}) }; };
    dom.window.eval(JS);
    return { dom, calls };
  }

  test('a view restored after the load-time check (reload on #invoicing, Back/Forward) still loads', async () => {
    const { dom, calls } = page();
    await flush(400);                                        // past the 300 ms load-time boot
    expect(calls.some((u) => /\/api\/invoicing\/overview/.test(u))).toBe(false);
    dom.window.document.getElementById('view-invoicing').classList.add('active');   // the route restored late
    await flush(100);
    expect(calls.some((u) => /\/api\/invoicing\/overview/.test(u))).toBe(true);
    expect(dom.window.document.getElementById('inv-root').textContent).not.toMatch(/^Loading invoicing…$/);
  });
});
