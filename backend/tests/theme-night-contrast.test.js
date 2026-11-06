'use strict';
/**
 * Night mode: calendar blocks must stand out and stay readable. Worked out from
 * theme.css itself (WCAG contrast), so a colour change that dims them fails here.
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../frontend/current/theme.css'), 'utf8');
const hex = (name) => { const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i')); if (!m) throw new Error(`no ${name}`); return m[1]; };
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (c) => { const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const over = (fg, alpha, bg) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));

const TILES = ['therapy', 'initial', 'assessment', 'mdt', 'report', 'travel', 'admin', 'meeting', 'cpd', 'lunch', 'personal', 'sick', 'annual', 'teams', 'outlook', 'leave'];
const GRID = rgb(hex('bg'));

test.each(TILES)('%s tile: text is readable and the tile stands off the grid', (t) => {
  const bg = rgb(hex(`c-${t}-bg`));
  expect(contrast(rgb(hex('tile-fg')), bg)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(rgb(hex('tile-fg-soft')), bg)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(bg, GRID)).toBeGreaterThanOrEqual(1.5);
});

test('every family of travel block has bright text on stripes that show against the grid', () => {
  const blocks = [...css.matchAll(/\.travel-overlay[^{]*\{\s*--tr:\s*(\d+),\s*(\d+),\s*(\d+);\s*color:\s*(#[0-9a-f]{6})/gi)];
  expect(blocks).toHaveLength(3); // between sessions, start of day, end of day
  blocks.forEach((m) => {
    const hue = [+m[1], +m[2], +m[3]];
    const light = over(hue, 0.20, GRID); const strong = over(hue, 0.32, GRID);
    expect(contrast(rgb(m[4]), strong)).toBeGreaterThanOrEqual(4.5); // worst stripe
    expect(contrast(light, GRID)).toBeGreaterThanOrEqual(1.3);       // the block itself is visible
    expect(contrast(hue, GRID)).toBeGreaterThanOrEqual(5);           // the side bar
  });
});

test('the day theme is untouched: every travel rule here is night-only, and the inline dimming is undone', () => {
  const lines = css.split('\n').filter((l) => /^[^/ ].*\.travel-overlay/.test(l));
  expect(lines.length).toBeGreaterThan(0);
  lines.forEach((l) => expect(l).toMatch(/^:root\[data-theme="dark"\]/));
  expect(css).toMatch(/\.travel-overlay \.t-ico \{ opacity: 1 !important; \}/);
});
