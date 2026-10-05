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
