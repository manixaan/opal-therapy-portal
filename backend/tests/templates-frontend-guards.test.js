'use strict';

/**
 * TEMPLATES FRONTEND GUARDS — static assertions over the shipped frontend.
 *
 * These are the properties a reviewer would otherwise have to re-check by
 * hand on every change: the tab is in the right place and behind the right
 * role, the surface cannot be torn out mid-keystroke, no binding syntax is
 * rendered to a person, and nothing is highlighted yellow.
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const SHELL = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');
const RH = fs.readFileSync(path.join(FRONTEND, 'resourcehub.js'), 'utf8');
const TPL = fs.readFileSync(path.join(FRONTEND, 'templates.js'), 'utf8');
const CSS = fs.readFileSync(path.join(FRONTEND, 'templates.css'), 'utf8');

describe('Resource Hub navigation', () => {
  test('Templates sits after Assigned Learning and before Professional development', () => {
    const nav = RH.slice(RH.indexOf('function renderNav()'), RH.indexOf('function nav('));

    const iLearning = nav.indexOf("['learning',");
    const iTemplates = nav.indexOf("['templates', 'Templates']");
    const iPd = nav.indexOf("['pd', 'Professional development']");

    expect(iLearning).toBeGreaterThan(-1);
    expect(iTemplates).toBeGreaterThan(-1);
    expect(iPd).toBeGreaterThan(-1);
    expect(iLearning).toBeLessThan(iTemplates);
    expect(iTemplates).toBeLessThan(iPd);
  });

  test('the order of the whole bar is Home, Library, Saved, Learning, Templates, PD, Assessments, Admin', () => {
    const nav = RH.slice(RH.indexOf('function renderNav()'), RH.indexOf('function nav('));
    const order = ["'home'", "'library'", "'saved'", "'learning'", "'templates'", "'pd'", "'instruments'", "'admin'"]
      .map((k) => nav.indexOf(k));
    expect(order.every((n) => n > -1)).toBe(true);
    expect(order.slice().sort((a, b) => a - b)).toEqual(order);
  });

  test('the tab is role-gated, and admin is NOT offered it', () => {
    expect(RH).toMatch(/if \(canUseTemplates\(\)\) items\.push\(\['templates', 'Templates'\]\)/);
    const fn = RH.slice(RH.indexOf('function canUseTemplates()'));
    const body = fn.slice(0, fn.indexOf('}') + 1);
    expect(body).toContain("role() === 'therapist'");
    expect(body).toContain("role() === 'read_only'");
    expect(body).toContain('isOwner()');
    // The mirror of requireTemplateRead: admin must not appear.
    expect(body).not.toMatch(/isAdminRole\(\)|'admin'/);
  });

  test('existing role-aware tabs are untouched', () => {
    expect(RH).toMatch(/if \(canSeeInstruments\(\)\) items\.push\(\['instruments', 'Assessments'\]\)/);
    expect(RH).toMatch(/if \(canAdmin\(\)\) items\.push\(\['admin', 'Admin'\]\)/);
  });

  test('the hub renders no body for Templates — the sibling mount owns it', () => {
    // resourcehub.js rebuilds its subtree on every render; a form living there
    // would lose what the user was typing.
    expect(RH).toMatch(/else if \(S\.view === 'templates'\) body = '';/);
  });
});

describe('the shell wires the surface', () => {
  test('templates.js and templates.css are loaded, with cache-bust pins', () => {
    // js v=5: two-step editor panel, contents-mirroring outline with
    // drag-to-reorder, multi-article A4 pagination fix.
    // css v=5: the stepper and outline styles.
    expect(SHELL).toContain('<link rel="stylesheet" href="/templates.css?v=5" />');
    expect(SHELL).toContain('<script src="/templates.js?v=5" defer></script>');
  });

  test('templates.js loads AFTER docx-preview, which its live preview needs', () => {
    expect(SHELL.indexOf('/vendor/docx-preview.min.js'))
      .toBeLessThan(SHELL.indexOf('/templates.js?v=5'));
  });

  test('the mount is a sibling of #rh2-root, not inside it', () => {
    expect(SHELL).toContain('<div id="templates-root" hidden></div>');
    const panel = SHELL.slice(SHELL.indexOf('<div id="rh2-root"></div>'));
    expect(panel.indexOf('<div id="templates-root" hidden></div>')).toBeGreaterThan(0);
  });

  test('resourcehub.js is re-pinned, because this change edits it', () => {
    // The pin is shared by every feature that edits the file — the shell
    // ships the union under the newest version. r29 makes the Owner's
    // preview launch its walkthrough tiles for real.
    expect(SHELL).toContain('<script src="/resourcehub.js?v=r36" defer></script>');
  });
});

describe('nothing implementation-facing reaches a person', () => {
  test('no OPAL_ binding identifier is ever rendered as user-visible text', () => {
    // data-tag / data-chip are DOM hooks built from a variable; a literal
    // OPAL_… in the markup would mean a tag on screen.
    const literals = TPL.match(/['"`]OPAL_[A-Z0-9_]*/g);
    expect(literals === null ? [] : literals).toEqual([]);
  });

  test('the source legend describes ORIGINS, not mechanisms', () => {
    const legend = TPL.slice(TPL.indexOf('var SOURCE_LABEL'), TPL.indexOf('function sourceClass'));
    expect(legend).toContain('From the client record');
    expect(legend).toContain('Not yet completed');
    expect(legend).not.toMatch(/OPAL_|splose\b.*:.*['"]splose|binding|tag\b/i);
  });

  test('the export promise is stated to the user in plain terms', () => {
    expect(TPL).toMatch(/independent files/i);
    expect(TPL).toMatch(/no connection back to Opal/i);
  });
});

describe('the live preview stays usable on a long template', () => {
  test('the field form is mounted once, not re-rendered on input', () => {
    // onFieldInput must not call render(); it repaints only the chips.
    const fn = TPL.slice(TPL.indexOf('function onFieldInput'), TPL.indexOf('function setSaveState'));
    expect(fn).not.toMatch(/\brender\(\)/);
    expect(fn).toMatch(/scheduleSave\(\)/);
  });

  test('a save repaints the chips and the preview, never the inputs', () => {
    const fn = TPL.slice(TPL.indexOf('async function save()'), TPL.indexOf('/** Source chips'));
    expect(fn).toContain('repaintChips()');
    expect(fn).toContain('refreshPreview()');
    expect(fn).not.toMatch(/\brender\(\)/);
  });

  test('preview refreshes are revision-guarded so a slow reply cannot overwrite a fast one', () => {
    const fn = TPL.slice(TPL.indexOf('async function refreshPreview'));
    expect(fn).toMatch(/var rev = \+\+S\.preview\.rev/);
    expect((fn.match(/if \(rev !== S\.preview\.rev\) return/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  test('the preview is staged off-screen and swapped under the reader scroll position', () => {
    const fn = TPL.slice(TPL.indexOf('async function refreshPreview'));
    expect(fn).toContain("doc.createElement('div')");
    expect(fn).toMatch(/var top = host\.scrollTop/);
    expect(fn).toMatch(/host\.scrollTop = top/);
  });

  test('a download flushes any pending edit first', () => {
    const fn = TPL.slice(TPL.indexOf('download: async function'));
    expect(fn).toMatch(/if \(S\.dirty \|\| S\.saving\) await save\(\)/);
  });
});

describe('unfinished fields are not highlighted yellow', () => {
  test('the stylesheet declares no yellow anywhere', () => {
    // Comments are stripped first: the file's own "NO YELLOW" note is the
    // reason this holds, so it must not be what trips the assertion.
    const declarations = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

    const hexes = (declarations.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toUpperCase());
    // Yellow-ish: red and green high, blue markedly lower.
    const yellows = hexes.filter((h) => {
      const v = h.slice(1);
      if (v.length !== 6 && v.length !== 3) return false;
      const p = v.length === 3 ? v.split('').map((c) => parseInt(c + c, 16))
        : [v.slice(0, 2), v.slice(2, 4), v.slice(4, 6)].map((c) => parseInt(c, 16));
      return p[0] > 200 && p[1] > 180 && p[2] < 140;
    });
    expect(yellows).toEqual([]);
    expect(declarations).not.toMatch(/\byellow\b|\bgold\b|\bkhaki\b/i);
    expect(declarations).not.toMatch(/mark\s*\{|background:\s*Mark\b/);
  });

  test('the missing-value chip is a neutral dashed outline, not a fill', () => {
    const rule = CSS.slice(CSS.indexOf('.tpl-chip-missing'));
    const block = rule.slice(0, rule.indexOf('}') + 1);
    expect(block).toContain('border-style: dashed');
    expect(block).not.toMatch(/background:\s*(?!none)/);
  });

  test('the intent is recorded where the next person will read it', () => {
    expect(CSS).toMatch(/NO YELLOW/);
  });
});

describe('the preview pane matches the renderer it actually uses', () => {
  test('the className passed to docx-preview is the one the stylesheet targets', () => {
    // docx-preview prefixes every emitted class with the `className` option.
    // These two drifting apart is silent: the document still renders, but as
    // one unstyled ribbon with no page boundaries.
    expect(TPL).toMatch(/className: 'tpl-docx-render'/);
    expect(CSS).toContain('.tpl-docx-render-wrapper');
  });

  test('pages are styled as a stack of separate sheets, outranking the injected sheet', () => {
    // docx-preview injects its own stylesheet into the host, so an equally
    // specific rule loses on source order — the same trap fca.css documents.
    expect(CSS).toMatch(/#templates-root \.tpl-preview-host \.tpl-docx-render-wrapper > section/);
    const rule = CSS.slice(CSS.indexOf('#templates-root .tpl-preview-host'));
    expect(rule.slice(0, rule.indexOf('}'))).toMatch(/margin: 0/);
  });
});

describe('the content panel is the outline the contents page prints', () => {
  test('heading sizes are always concrete — no "Default" the reader must resolve', () => {
    const options = TPL.slice(TPL.indexOf('var LEVEL_OPTIONS'), TPL.indexOf('function levelSelectHtml'));
    expect(options).not.toContain('Default');
    expect(options).toContain('Heading');
    expect(options).toContain('Subheading');
    expect(options).toContain('Minor heading');
  });

  test('rows are reordered by pointer drag, with a keyboard fallback on the grip', () => {
    expect(TPL).toMatch(/addEventListener\('pointerdown', onGripDown\)/);
    expect(TPL).toMatch(/'pointermove', onGripMove/);
    expect(TPL).toMatch(/gripKey/);
    // The blocks making room slide, the held block does not.
    expect(CSS).toMatch(/\.tpl-secrow-shift \{ transition: transform/);
  });

  test('the A4 splitter walks EVERY article on a page, not only the first', () => {
    // docx-preview emits a second <article> where section properties change —
    // the Contents page carries the TOC in one and Participant Details in the
    // next. Splitting only the first clipped the second under the pinned page.
    const fn = TPL.slice(TPL.indexOf('function splitPage'), TPL.indexOf('/** Wait for images'));
    expect(fn).toMatch(/tagName === 'ARTICLE'/);
    expect(fn).not.toMatch(/querySelector\(':scope > article'\)/);
  });
});

describe('the surface only appears on its own destination', () => {
  test('visibility follows the hub data-view, like the FCA and letter mounts', () => {
    expect(TPL).toMatch(/hub\.dataset\.view === 'templates'/);
    expect(TPL).toMatch(/MutationObserver/);
    expect(TPL).toMatch(/attributeFilter: \['data-view'\]/);
  });
});
