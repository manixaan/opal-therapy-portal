/**
 * U-07 / U-08 (IA-09, IA-10): the event drawer and the booking panel are one
 * side-sheet spec — same width token and shadow, slide by transform on the
 * shared motion tokens, backdrop fades by opacity in and out (never display).
 * The move-impact modal's entry transition actually plays (@starting-style).
 */
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '../../frontend/current/mockup_v3.html'), 'utf8');
function rule(sel) {
  const at = HTML.indexOf(sel + ' {');
  expect(at).toBeGreaterThan(-1);
  return HTML.slice(at, HTML.indexOf('}', at) + 1);
}

describe('one side-sheet spec', () => {
  test('tokens exist', () => {
    expect(HTML).toContain('--sheet-w: 440px;');
    expect(HTML).toContain('--shadow-sheet: -6px 0 24px rgba(36, 31, 26, 0.13);');
    expect(HTML).toContain('--t-panel-close: 200ms;');
  });
  test.each([['.detail-drawer', '.detail-drawer.show'], ['#booking-side-panel', '#booking-side-panel.open']])('%s slides by transform on the tokens', (base, open) => {
    const b = rule(base);
    expect(b).toContain('width: var(--sheet-w);');
    expect(b).toContain('box-shadow: var(--shadow-sheet);');
    expect(b).toContain('transform: translateX(102%);');
    expect(b).toContain('transition: transform var(--t-panel-close) var(--ease-close);');
    expect(b).not.toMatch(/right: -\d+px|transition: right/);
    const o = rule(open);
    expect(o).toContain('transform: none;');
    expect(o).toContain('transition: transform var(--t-panel) var(--ease-out);');
  });
  test.each([['.detail-backdrop', '.detail-backdrop.show'], ['#booking-panel-backdrop', '#booking-panel-backdrop.open']])('%s fades by opacity both ways, never display', (base, open) => {
    const b = rule(base);
    expect(b).toContain('opacity: 0; pointer-events: none;');
    expect(b).toContain('transition: opacity var(--t-panel-close) var(--ease-close);');
    expect(b).not.toMatch(/display:\s*none/);
    const o = rule(open);
    expect(o).toContain('opacity: 1; pointer-events: auto;');
    expect(o).not.toContain('display');
  });
});

test('the impact modal transition starts from its closed look', () => {
  expect(rule('.impact-modal')).toContain('transition: transform var(--t-med) var(--ease-out), opacity var(--t-med) var(--ease-out);');
  expect(HTML).toContain('@starting-style { .impact-modal.show { opacity: 0; transform: translate(-50%, -48%) scale(0.96); } }');
});

test('reduced motion still collapses every transition', () => {
  const at = HTML.indexOf('@media (prefers-reduced-motion: reduce) {\n    *, *::before, *::after {');
  expect(at).toBeGreaterThan(-1);
  expect(HTML.slice(at, at + 300)).toContain('transition-duration: 0.01ms !important;');
});

test('U-01: the Opa button steps aside while either sheet is open', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../frontend/current/opa.css'), 'utf8');
  const at = css.indexOf('body.bsp-open #opa-fab, body.dd-open #opa-fab {');
  expect(at).toBeGreaterThan(-1);
  expect(css.slice(at, css.indexOf('}', at))).toContain('opacity: 0; visibility: hidden; pointer-events: none;');
  expect(HTML).toContain("document.body.classList.add('bsp-open');");
  expect(HTML).toContain("document.body.classList.add('dd-open');");
});
