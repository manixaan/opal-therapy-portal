/**
 * U-15 — one page-header anatomy across the non-calendar tabs.
 * The .view supplies the 16 px gutter; every page title is 22/700/1.2 with a
 * 13 px ink-soft subtitle; tab-owned cards use --radius-md (12). These pins
 * stop a tab drifting back to its own 19/20/28 px title or a doubled gutter.
 */
const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const HTML = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');
const CN_CSS = fs.readFileSync(path.join(FRONTEND, 'casenotes.css'), 'utf8');

describe('U-15 page titles and gutters', () => {
  test('the .view is the single 16 px gutter', () => {
    expect(HTML).toContain('.view { display: none; padding: 16px; }');
    expect(HTML).toContain('.acct-page { padding: 0; max-width: 1280px; }');
    expect(HTML).toContain('.settings-content { flex: 1; overflow-y: auto; padding: 0 0 24px 24px; }');
  });

  test('Resources, Support, Settings and Case Notes share one title size', () => {
    expect(HTML).toContain('.acct-page > h1 { font-size: 22px; font-weight: 700; line-height: 1.2; }');
    expect(HTML).toContain('.settings-section h2 { font-size: 22px; font-weight: 700; line-height: 1.2;');
    expect(CN_CSS).toContain('#view-casenotes .cn-page-head h1 { margin: 0 0 4px; font-size: 22px; font-weight: 700; line-height: 1.2; }');
  });

  test('page subtitles are 13 px ink-soft, not muted', () => {
    expect(HTML).toContain('.acct-page > h1 + p { font-size: 13px; }');
    for (const t of ['Support Tickets', 'Resource Hub']) {
      expect(HTML).toContain(`<h1 style="margin:0 0 4px;">${t}</h1>\n  <p style="color:var(--ink-soft);`);
    }
    expect(CN_CSS).toMatch(/\.cn-page-head p \{[^}]*font-size: 13px; color: var\(--ink-soft\);/);
  });

  test('tab-owned cards use the 12 px card radius', () => {
    expect(CN_CSS).not.toContain('var(--radius-lg');
    expect(HTML).toMatch(/\.sup-table-wrap \{[^}]*border-radius: var\(--radius-md\)/);
  });
});
