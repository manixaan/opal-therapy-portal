'use strict';

/**
 * ONE SYNC BUTTON (21 Nov 2026).
 *
 * "Blocks to review" (block-review.js) was its own Calendar toolbar button
 * and modal beside the Sync button. It now lives in the Sync popup as the
 * "To check" tab, and the Sync button's count includes it. Both modules are
 * browser IIFEs, so they run here against a minimal fake DOM.
 */

const fs = require('fs');
const path = require('path');

const FRONT = path.join(__dirname, '..', '..', 'frontend', 'current');
const SYNC = fs.readFileSync(path.join(FRONT, 'splose-sync.js'), 'utf8');
const BR = fs.readFileSync(path.join(FRONT, 'block-review.js'), 'utf8');

describe('Sync popup carries the block review', () => {
  test('TABS has a "To check" review tab after the three calendars', () => {
    const m = SYNC.match(/var TABS = (\[[^\n]*\]);/);
    expect(m).toBeTruthy();
    const tabs = Function('return ' + m[1])();
    expect(tabs.map((t) => t.key)).toEqual(['outlook', 'splose', 'portal', 'review']);
    expect(tabs[3].label).toBe('To check');
  });

  test('the review tab renders block review inline and detaches on close / tab switch', () => {
    expect(SYNC).toMatch(/S\.tab === 'review'[\s\S]{0,120}renderInto\(body, foot\)/);
    expect(SYNC).toMatch(/function closePanel\(\) \{[\s\S]{0,120}\.detach\(\)/);
    expect(SYNC).toMatch(/function switchTab[\s\S]{0,160}\.detach\(\)/);
  });

  test('the Sync button count adds the blocks to check', () => {
    expect(SYNC).toMatch(/var n = waiting \+ toCheck;/);
  });

  test('the Loading placeholder goes in before load(), so a tile chip keeps its card focused', () => {
    const open = SYNC.slice(SYNC.indexOf('function openPanel(tab)'));
    expect(open.indexOf("innerHTML = '<div class=\"ssp-empty\">Loading")).toBeLessThan(open.indexOf('review().load('));
    expect(open).toMatch(/!p\.querySelector\('\.ssp-body'\)\.contains\(doc\.activeElement\)/);
  });

  test('Escape inside an open address list does not close the popup', () => {
    expect(SYNC).toMatch(/e\.defaultPrevented \|\| e\.__brPacOpen\) return;/);
  });
});

describe('block-review.js no longer adds its own toolbar button', () => {
  function run({ withSync }) {
    const made = [];
    const removed = [];
    const existing = withSync ? { remove() { removed.push('btn'); } } : null;
    const add = { parentNode: { insertBefore(el) { made.push(el); } } };
    const doc = {
      readyState: 'complete',
      getElementById(id) { return id === 'cal-block-review-btn' ? existing : null; },
      querySelector(sel) { return sel === '#view-calendar .btn-add-event' ? add : null; },
      querySelectorAll() { return []; },
      createElement() { return { addEventListener() {}, classList: { toggle() {} }, setAttribute() {} }; },
    };
    const paints = [];
    const win = {
      SploseSync: withSync ? { paint() { paints.push(1); }, isReviewOpen() { return false; }, open() {}, close() {} } : undefined,
    };
    const fn = new Function('window', 'document', 'setTimeout', 'setInterval', 'MutationObserver', BR);
    fn(win, doc, () => {}, () => {}, undefined);
    return { win, made, removed, paints };
  }

  test('with the Sync popup present: no button is made, a stale one is removed', () => {
    const r = run({ withSync: true });
    r.win.BlockReview._state.blocks = [{ eventId: 'a' }];
    expect(r.win.BlockReview.count()).toBe(1);
    expect(typeof r.win.BlockReview.renderInto).toBe('function');
    expect(typeof r.win.BlockReview.detach).toBe('function');
  });

  test('start() no longer depends on the toolbar button existing', () => {
    expect(BR).toMatch(/function start\(\) \{\s*if \(!document\.getElementById\('view-calendar'\)\) return;/);
    expect(BR).toMatch(/if \(sync\(\)\) \{ if \(btn\) btn\.remove\(\); return null; \}/);
  });
});
