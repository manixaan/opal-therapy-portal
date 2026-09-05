'use strict';

/**
 * INTERVIEW PREPARATION — FRONTEND SURFACE GUARDS.
 *
 * The portal frontend has no browser test harness, so — exactly as
 * assessment-surface-guards.test.js does for the assessment surface — these
 * are STATIC guards. They read interview.js, interview.css and the shell, and
 * assert the properties that would otherwise only be caught by a person
 * noticing them in production:
 *
 *   - every interpolated value is escaped before it reaches innerHTML;
 *   - no answer field carries a maxlength, ever, anywhere;
 *   - the tab is permission-gated, and the gate is not the only control;
 *   - the module is node-requireable, so this file can load it;
 *   - the wiring the shell needs (stylesheet, script, view, mount, dispatch)
 *     is all actually present.
 *
 * Crude by design. If a refactor renames these, update the assertions
 * alongside it rather than deleting them.
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const JS = fs.readFileSync(path.join(FRONTEND, 'interview.js'), 'utf8');
const CSS = fs.readFileSync(path.join(FRONTEND, 'interview.css'), 'utf8');
const SHELL = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');
const NAV = fs.readFileSync(path.join(FRONTEND, 'navigation.js'), 'utf8');

const { esc, progressOf, answerIsEmpty, recordTitle, statusLabel } =
  require(path.join(FRONTEND, 'interview.js'));

/** Strip comments and every esc() argument, so the scan sees only real sinks. */
function scannable(code) {
  const noComments = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // Blank out esc(...) arguments: `esc(x.y)` becomes `esc()`, so an escaped
  // interpolation cannot be mistaken for a raw one.
  return noComments.replace(/\besc\((?:[^()]|\([^()]*\))*\)/g, 'esc()');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Escaping
// ═══════════════════════════════════════════════════════════════════════════

describe('every value reaching innerHTML is escaped', () => {
  test('esc() escapes all five characters and is null-safe', () => {
    expect(esc('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(esc(`"q" & 'single'`)).toBe('&quot;q&quot; &amp; &#39;single&#39;');
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc(0)).toBe('0');
  });

  test('no bare identifier is concatenated between two quoted literals', () => {
    // The house rule from assessment.js: '…' + ident + '…' must be esc(ident).
    //
    // The exemptions are the two kinds of value that CANNOT come from a
    // stranger: HTML fragments this file has already built and escaped
    // (actions, cells, rows, body, …), and numbers/ids this file controls
    // (a loop counter, a progress count, a class name it chose itself).
    // Everything a server row supplies must be escaped.
    const ALLOWED = new RegExp('^\'\\s*\\+\\s*('
      + [
        // already-built, already-escaped HTML fragments
        'h', 'out', 'html', 'body', 'cells', 'rows', 'filters', 'actions',
        'detailHtml', 'ownerActions', 'statusOptions', 'opts\\.footer',
        // values this module computed itself, never a server string
        'progress\\.answered', 'progress\\.total', 'cls', 'attrs', 'type',
        'response\\.status',
        // CSS-selector fragments, already restricted by selectorKey/selectorId,
        // and confirm()-dialog text — none of them reach innerHTML (asserted
        // in the two tests below).
        'safe', 'safeField', 'safeUser', 'who',
      ].join('|')
      + ')\\b');
    const raw = scannable(JS).match(/'\s*\+\s*(?!esc\()[a-zA-Z_$][\w.$]*\s*\+\s*'/g) || [];
    const offenders = [...new Set(raw.filter((s) => !ALLOWED.test(s)))];
    expect(offenders).toEqual([]);
  });

  test('a server-supplied key can never be concatenated into a CSS selector', () => {
    // Question keys come from the record's frozen template snapshot — a row in
    // the database — and are used inside querySelectorAll attribute selectors.
    // They pass through selectorKey() first, which admits only the character
    // set the template grammar guarantees.
    expect(JS).toMatch(/function selectorKey\(v\)/);
    expect(JS).toMatch(/\/\^\[a-z0-9_\]\+\$\/\.test\(value\)/);
    const selectors = JS.match(/querySelectorAll\('[^']*' \+ [a-zA-Z_$][\w.$]*/g) || [];
    for (const call of selectors) {
      expect(call).toMatch(/\+ (safe|safeField|safeUser)\b/);
    }
  });

  test('the exempted identifiers really are ours, not a server row', () => {
    // `who` and `key` are the two exemptions worth naming: `who` is a
    // candidate name and `key` a template key. Both reach only a confirm()
    // dialog and a URL segment respectively — never innerHTML.
    expect(JS).toMatch(/var who = row \? row\.candidateName : 'this applicant';/);
    expect(JS).toMatch(/await portalConfirm\('Permanently delete the interview record for ' \+ who/);
    expect(JS).not.toMatch(/innerHTML[\s\S]{0,200}\+ who \+/);
  });

  test('the candidate name — the one value a stranger controls — is escaped everywhere it renders', () => {
    const uses = JS.match(/[\w.]*candidateName/g) || [];
    expect(uses.length).toBeGreaterThan(3);
    // Every render-time use goes through esc() or textContent, never raw.
    expect(scannable(JS)).not.toMatch(/\+\s*r\.candidateName/);
    expect(scannable(JS)).not.toMatch(/\$\{[^}]*candidateName/);
  });

  test('the module does not reuse the shell\'s escapeHtml, which leaves the apostrophe', () => {
    expect(JS).not.toMatch(/\bescapeHtml\s*\(/);
    expect(JS).toMatch(/function esc\(v\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  The rule the whole feature rests on
// ═══════════════════════════════════════════════════════════════════════════

describe('no answer field is ever length-limited or fixed-height', () => {
  test('nothing in the module emits a maxlength', () => {
    // Comments are stripped: the header promises "no maxlength" in prose, and
    // that sentence must not be what satisfies its own test.
    const code = JS
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code.toLowerCase()).not.toContain('maxlength');
    expect(code.toLowerCase()).not.toContain('max-length');
    expect(code).not.toMatch(/\bsize=/);
  });

  test('narrative answers are real textareas, not inputs', () => {
    expect(JS).toMatch(/<textarea class="iv-answer"/);
  });

  test('the textarea grows AND shrinks with its content', () => {
    // Resetting to 'auto' before reading scrollHeight is the one ordering
    // that lets the box shrink again when a paragraph is deleted.
    expect(JS).toMatch(/el\.style\.height = 'auto';[\s\S]{0,120}el\.scrollHeight/);
    expect(JS).toMatch(/function autoGrow\(el\)/);
    // …and it runs on every keystroke, not only at render.
    expect(JS).toMatch(/matches\('textarea\.iv-answer'\)\) autoGrow\(el\)/);
  });

  test('the stylesheet does not cap the answer box', () => {
    const block = CSS.slice(CSS.indexOf('.iv-answer {'), CSS.indexOf('.iv-answer:hover'));
    expect(block).toMatch(/min-height/);
    expect(block).not.toMatch(/max-height/);
    expect(block).not.toMatch(/overflow-y:\s*scroll/);
  });

  test('the document is ONE page — sections are scrolled to, never swapped out', () => {
    // A paged wizard would unmount answers; the section strip only scrolls.
    expect(JS).toMatch(/scrollIntoView/);
    expect(JS).not.toMatch(/\.iv-section[^\n]*display:\s*none/);
    expect(CSS).not.toMatch(/\.iv-section\s*\{[^}]*display:\s*none/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Saving
// ═══════════════════════════════════════════════════════════════════════════

describe('nothing typed is lost', () => {
  test('autosave is debounced rather than fired on every keystroke', () => {
    expect(JS).toMatch(/var AUTOSAVE_MS = \d+;/);
    expect(JS).toMatch(/clearTimeout\(S\.saveTimer\)/);
    expect(JS).toMatch(/S\.saveTimer = global\.setTimeout/);
  });

  test('a failed save re-queues the changes instead of dropping them', () => {
    const flush = JS.slice(JS.indexOf('async function flush()'), JS.indexOf('/** Update the header'));
    expect(flush).toMatch(/if \(!res\.ok\)/);
    expect(flush).toMatch(/S\.pending = pending;/);
    expect(flush).toMatch(/S\.dirty = true;/);
    // Newer keystrokes must win over the re-queued older ones.
    expect(flush).toMatch(/Object\.keys\(S\.pending\)\.forEach\(function \(k\) \{ pending\[k\] = S\.pending\[k\]; \}\);/);
  });

  test('the unload guard is armed only while something is genuinely unsaved', () => {
    expect(JS).toMatch(/beforeunload/);
    expect(JS).toMatch(/if \(S\.view !== 'record' \|\| !S\.record \|\| !hasUnsaved\(\)\) return undefined;/);
  });

  test('leaving a field and leaving the tab both flush first', () => {
    expect(JS).toMatch(/doc\.addEventListener\('focusout'/);
    expect(JS).toMatch(/wrapped\.__ivHooked = true;/);
  });

  test('Save & Exit persists before it navigates', () => {
    const saveNow = JS.slice(JS.indexOf('async function saveNow('), JS.indexOf('async function completeInterview'));
    expect(saveNow).toMatch(/var ok = await flush\(\);/);
    expect(saveNow).toMatch(/if \(!ok\) \{[\s\S]*?return; \}/);
    expect(saveNow).toMatch(/if \(andExit\) backToLibrary\(true\);/);
  });

  test('the header refreshes in place — a save never unmounts a textarea', () => {
    // Re-rendering the document after every autosave would take the
    // interviewer's cursor with it. Only the three things a save can change
    // are written directly into the DOM.
    const fn = JS.slice(JS.indexOf('function refreshHeader()'), JS.indexOf('// ── Field capture'));
    expect(fn).toMatch(/chipEl\.textContent = statusLabel/);
    expect(fn).toMatch(/h1\.textContent = recordTitle/);
    expect(fn).toMatch(/progressEl\.textContent = progress\.answered/);
    expect(fn).not.toMatch(/render\(\)/);
    expect(fn).not.toMatch(/innerHTML/);
    // …and the answered count tracks the typing, not only the save.
    expect(JS).toMatch(/function markDirty\(\) \{[\s\S]*?refreshHeader\(\);/);
  });

  test('the save state is announced, not just coloured', () => {
    expect(JS).toMatch(/id="iv-savebar" role="status" aria-live="polite"/);
    expect(JS).toMatch(/text = 'Last saved '/);
    expect(JS).toMatch(/text = 'Unsaved changes'/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Validation posture
// ═══════════════════════════════════════════════════════════════════════════

describe('the form does not over-validate — it is a note-taking tool', () => {
  test('no question is marked required in the rendered markup', () => {
    const fieldRenderers = JS.slice(JS.indexOf('function fieldLongtext'), JS.indexOf('function detailsPanel'));
    expect(fieldRenderers).not.toMatch(/\brequired\b/);
    expect(fieldRenderers).not.toMatch(/aria-required/);
  });

  test('completing with blank questions warns and proceeds — it never blocks', () => {
    const complete = JS.slice(JS.indexOf('async function completeInterview'), JS.indexOf('async function reopenInterview'));
    expect(complete).toMatch(/questions are still blank/);
    expect(complete).toMatch(/await portalConfirm\(/);
    expect(complete).toMatch(/Completing an interview with blank questions is fine/);
  });

  test('destructive actions confirm first, and deletion says it cannot be undone', () => {
    expect(JS).toMatch(/Archive this interview\?/);
    expect(JS).toMatch(/Permanently delete the interview record/);
    expect(JS).toMatch(/This cannot be undone\. Archive it instead if you may need it later\./);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Accessibility
// ═══════════════════════════════════════════════════════════════════════════

describe('accessibility', () => {
  test('every rating option carries its category and its number in the label', () => {
    // Not a row of bare circles: the accessible name is
    // "Communication — 3", and the numeral is visible.
    expect(JS).toMatch(/<label for="' \+ esc\(id\) \+ '"><span class="iv-sr-only">' \+ esc\(row\.label\) \+ ' — <\/span>'/);
    expect(JS).toMatch(/role="group" aria-labelledby="iv-ratings-h"/);
  });

  test('the selected rating is not indicated by colour alone', () => {
    const checked = CSS.slice(CSS.indexOf('.iv-ratings-cell input:checked + label'));
    expect(checked).toMatch(/background:/);
    expect(checked).toMatch(/border-color:/);
    expect(checked).toMatch(/color: #fff/);
  });

  test('status chips carry text, never colour alone', () => {
    expect(JS).toMatch(/function chip\(status\) \{[\s\S]*?esc\(statusLabel\(status\)\)/);
  });

  test('every control has a real label', () => {
    expect(JS).toMatch(/<label class="iv-q-label" for="/);
    expect(JS).toMatch(/<legend class="iv-q-label">/);
    expect(JS).toMatch(/<legend class="iv-sr-only">/);
  });

  test('the modal traps focus, restores it, and closes on Escape', () => {
    expect(JS).toMatch(/_modalReturnFocus = doc\.activeElement;/);
    expect(JS).toMatch(/if \(e\.key === 'Escape'\) \{ closeModal\(\); return; \}/);
    expect(JS).toMatch(/if \(e\.shiftKey && doc\.activeElement === first\)/);
    expect(JS).toMatch(/aria-modal/);
  });

  test('focus-visible styling exists for every interactive element', () => {
    for (const sel of ['.iv-btn:focus-visible', '.iv-answer:focus-visible',
      '.iv-input:focus-visible', '.iv-option input:focus-visible',
      '.iv-strip-btn:focus-visible', '.iv-ratings-cell input:focus-visible + label']) {
      expect(`${sel}:${CSS.includes(sel)}`).toBe(`${sel}:true`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Module hygiene
// ═══════════════════════════════════════════════════════════════════════════

describe('module conventions', () => {
  test('it is one IIFE exporting one global', () => {
    expect(JS).toMatch(/\(function \(global\) \{/);
    expect(JS).toMatch(/global\.Interviews = \{/);
    expect(JS.trimEnd().endsWith("})(typeof window !== 'undefined' ? window : null);")).toBe(true);
  });

  test('the pure helpers are exported BEFORE anything touches the DOM', () => {
    const exportsAt = JS.indexOf('if (typeof module !== \'undefined\' && module.exports) module.exports = helpers;');
    const domAt = JS.indexOf('var doc = global && global.document;');
    expect(exportsAt).toBeGreaterThan(-1);
    expect(exportsAt).toBeLessThan(domAt);
    // …which is what makes this very require() work.
    expect(typeof progressOf).toBe('function');
    expect(typeof answerIsEmpty).toBe('function');
  });

  test('no inline onclick carrying a server id — every action is delegated on data-iv', () => {
    expect(JS).not.toMatch(/onclick="/);
    expect(JS).toMatch(/data-iv="/);
    expect(JS).toMatch(/e\.target\.closest\('\[data-iv\]'\)/);
  });

  test('every entry point makes its own view visible before rendering into it', () => {
    // A tab view is display:none while another tab is active, so rendering
    // into it without switching first paints a screen nobody can see and
    // nothing errors. All four public entry points switch first.
    expect(JS).toMatch(/function ensureVisible\(\)/);
    expect(JS).toMatch(/if \(view && view\.classList\.contains\('active'\)\) return;/);
    for (const fn of ['function open\\(\\)', 'async function openRecord\\(id\\)',
      'async function openPreview\\(key\\)', 'async function openAccess\\(\\)']) {
      expect(JS).toMatch(new RegExp(fn + ' \\{\\s*\\n\\s*ensureVisible\\(\\);'));
    }
  });

  test('an in-flight library load never paints over the screen the user moved to', () => {
    const fn = JS.slice(JS.indexOf('async function loadLibrary()'), JS.indexOf('async function loadRecords'));
    expect(fn.match(/if \(S\.view !== 'library'\)/g) || []).toHaveLength(2);
  });

  test('the delegated listeners refuse anything outside this module', () => {
    expect(JS).toMatch(/function inRoot\(node\)/);
    expect(JS).toMatch(/if \(!t \|\| !inRoot\(t\)\) return;/);
  });

  test('every fetch is same-origin, credentialed, and under the module\'s own API prefix', () => {
    expect(JS).toMatch(/var API = '\/api\/interviews';/);
    const fetches = JS.match(/fetch\([^)]*\)/g) || [];
    expect(fetches).toHaveLength(1);
    expect(fetches[0]).toBe('fetch(API + path, init)');
    expect(JS).toMatch(/credentials: 'include'/);
    expect(JS).not.toMatch(/https?:\/\//);
  });

  test('no candidate detail is ever put in a query string', () => {
    // Searching is the one query the module sends, and it is what the user
    // typed into the filter box — never an answer, and never an identity.
    const qs = JS.match(/encodeURIComponent\([^)]*\)/g) || [];
    for (const call of qs) {
      expect(call).not.toMatch(/candidateName|responses|answer|ratings/);
    }
  });

  test('the CSS uses the portal\'s design tokens rather than reinventing them', () => {
    expect(CSS).toMatch(/var\(--accent\)/);
    expect(CSS).toMatch(/var\(--radius-lg\)/);
    expect(CSS).toMatch(/var\(--space-\d\)/);
    // Every selector is prefixed, so nothing collides with the shell.
    const selectors = CSS.match(/^\.[a-zA-Z][\w-]*/gm) || [];
    expect(selectors.filter((s) => !s.startsWith('.iv-'))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Shell wiring
// ═══════════════════════════════════════════════════════════════════════════

describe('the shell actually loads and gates the module', () => {
  test('the stylesheet and script are linked', () => {
    expect(SHELL).toContain('<link rel="stylesheet" href="/interview.css?v=1" />');
    expect(SHELL).toContain('<script src="/interview.js?v=2" defer></script>');
  });

  test('the tab and its view exist, and the mount point is inside the view', () => {
    expect(SHELL).toContain('<button class="tab" data-tab="interviews"');
    expect(SHELL).toContain('<section class="view" id="view-interviews">');
    expect(SHELL).toContain('<div id="iv-root" class="iv-root"></div>');
    const view = SHELL.slice(SHELL.indexOf('id="view-interviews"'), SHELL.indexOf('id="view-profile"'));
    expect(view).toContain('id="iv-root"');
  });

  test('the tab starts hidden and is revealed only by the permission filter', () => {
    const tab = SHELL.slice(SHELL.indexOf('data-tab="interviews"'), SHELL.indexOf('data-tab="settings"'));
    expect(tab).toContain('style="display:none;"');
    expect(SHELL).toContain("var PERMISSION_TABS = { interviews: 'interviews.access' };");
    expect(SHELL).toMatch(/return allowed\.filter\(tabPermissionHeld\);/);
  });

  test('the More-menu builder cannot re-reveal a tab the filter removed', () => {
    expect(SHELL).toContain("if (!allowed.includes(tabName)) return;");
    expect(SHELL).toContain('if (!moved) menu.removeChild(title);');
  });

  test('opening the tab boots the module', () => {
    expect(SHELL).toContain(
      "if (name === 'interviews' && window.Interviews && typeof window.Interviews.open === 'function') window.Interviews.open();");
  });

  test('no role\'s PRIMARY nav gained the tab — it is a delegated capability, not a role', () => {
    const nav = SHELL.slice(SHELL.indexOf('var ROLE_NAV = {'), SHELL.indexOf('var ACCESS_DENIED_MESSAGE'));
    const primaries = nav.match(/primary: \[[^\]]*\]/g) || [];
    expect(primaries.length).toBeGreaterThanOrEqual(4);
    for (const p of primaries) expect(p).not.toContain('interviews');
    // It IS offered to the owner and to admin, via a menu group.
    expect(nav.match(/\['Recruitment', \['interviews'\]\]/g)).toHaveLength(2);
    // …and to nobody else.
    const therapist = nav.slice(nav.indexOf('therapist: {'));
    expect(therapist).not.toContain('interviews');
  });

  test('navigation.js knows the tab and its record address', () => {
    expect(NAV).toMatch(/'interviews',/);
    expect(NAV).toContain("} else if (out.tab === 'interviews') {");
    expect(NAV).toContain("} else if (s.tab === 'interviews') {");
    expect(NAV).toContain("} else if (tab === 'interviews') {");
    expect(NAV).toContain('pushInterview: function (id) {');
    expect(NAV).toContain('function interviewRecordId() {');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Pure helpers
// ═══════════════════════════════════════════════════════════════════════════

describe('exported helpers', () => {
  const template = {
    sections: [{
      key: 's1',
      questions: [
        { key: 'a', type: 'longtext', label: 'A' },
        { key: 'b', type: 'checkboxes', label: 'B', options: [{ key: 'x', label: 'X' }] },
        { key: 'c', type: 'choice', label: 'C', options: [{ key: 'y', label: 'Y' }] },
        { key: 'd', type: 'ratings', label: 'D', rows: [{ key: 'r', label: 'R' }] },
      ],
    }],
  };

  test('an answer of whitespace is not an answer', () => {
    expect(answerIsEmpty({ type: 'longtext' }, '   \n ')).toBe(true);
    expect(answerIsEmpty({ type: 'longtext' }, 'x')).toBe(false);
    expect(answerIsEmpty({ type: 'checkboxes' }, [])).toBe(true);
    expect(answerIsEmpty({ type: 'checkboxes' }, ['x'])).toBe(false);
    expect(answerIsEmpty({ type: 'choice' }, { option: null })).toBe(true);
    expect(answerIsEmpty({ type: 'choice' }, { option: 'y' })).toBe(false);
    expect(answerIsEmpty({ type: 'ratings' }, {})).toBe(true);
    expect(answerIsEmpty({ type: 'ratings' }, { r: 3 })).toBe(false);
  });

  test('progress agrees with the server\'s own count', () => {
    expect(progressOf(template, {})).toEqual({ total: 4, answered: 0, percent: 0 });
    expect(progressOf(template, { a: 'x', d: { r: 3 } }))
      .toEqual({ total: 4, answered: 2, percent: 50 });
  });

  test('the page title names the applicant', () => {
    expect(recordTitle({ templateName: 'Occupational Therapist Interview', candidateName: 'Jane Smith' }))
      .toBe('Occupational Therapist Interview — Jane Smith');
    expect(recordTitle({ templateName: 'X', candidateName: '' })).toBe('X');
    expect(recordTitle(null)).toBe('Interview');
  });

  test('status labels are the four the server publishes', () => {
    expect(statusLabel('in_progress')).toBe('In Progress');
    expect(statusLabel('completed')).toBe('Completed');
    expect(statusLabel('archived')).toBe('Archived');
    expect(statusLabel('draft')).toBe('Draft');
    expect(statusLabel('something_new')).toBe('something_new');
  });
});
