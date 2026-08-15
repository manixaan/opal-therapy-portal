'use strict';

/**
 * WHODAS 2.0 — frontend guards.
 *
 * Follows the repository's existing shell-parsing convention
 * (frontend-stage3-guards, fca-frontend-helpers): the static asset is read and
 * asserted on structurally, since there is no DOM test harness.
 *
 * What is guarded here is the set of properties that would be clinically
 * dangerous to lose in a refactor: no scoring in the browser, no invented
 * severity language, no re-typeset instrument, no numeric response codes, and
 * XSS discipline on every server-supplied string.
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const JS = fs.readFileSync(path.join(FRONTEND, 'whodas.js'), 'utf8');
const CSS = fs.readFileSync(path.join(FRONTEND, 'whodas.css'), 'utf8');
const SHELL = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');

const instrument = require('../whodas/instrument');
const registry = require('../whodas/template-registry');

/**
 * Comments state the rules this file enforces, so scanning them would flag the
 * prohibition itself as a violation. These scans look at code only.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * Blank out the argument of every esc(...) call, so a value that IS escaped
 * cannot register as an unescaped interpolation. Brace-counted rather than
 * regex-matched, because the arguments contain nested parentheses.
 */
function stripEscArgs(src) {
  let out = '';
  for (let i = 0; i < src.length; i += 1) {
    if (src.startsWith('esc(', i)) {
      let depth = 1;
      let j = i + 4;
      for (; j < src.length && depth > 0; j += 1) {
        if (src[j] === '(') depth += 1;
        else if (src[j] === ')') depth -= 1;
      }
      out += 'esc(ESCAPED)';
      i = j - 1;
      continue;
    }
    out += src[i];
  }
  return out;
}

const CODE = stripComments(JS);
const SCANNABLE = stripEscArgs(CODE);

// The pure helpers are exported when the module is loaded without a DOM.
const { _helpers: helpers } = require(path.join(FRONTEND, 'whodas.js'));

describe('WHODAS frontend — wiring', () => {
  test('the shell loads the stylesheet, the module and the mount point', () => {
    expect(SHELL).toMatch(/<link rel="stylesheet" href="\/whodas\.css/);
    expect(SHELL).toMatch(/<script src="\/whodas\.js/);
    expect(SHELL).toMatch(/id="whodas-root"/);
  });

  test('pdf.js is vendored, since the repository has no bundler', () => {
    const dir = path.join(FRONTEND, 'vendor', 'pdfjs');
    expect(fs.existsSync(path.join(dir, 'pdf.min.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'pdf.worker.min.mjs'))).toBe(true);
    // Provenance and licence recorded next to the copy.
    expect(fs.readFileSync(path.join(dir, 'VENDORED.md'), 'utf8')).toMatch(/Apache-2\.0/);
  });
});

describe('WHODAS frontend — the instrument is never re-typeset', () => {
  test('no WHO question text is embedded in the module', () => {
    // A handful of exact phrases from the printed form. If any appears here,
    // someone has started rebuilding the instrument in HTML.
    const phrases = [
      'Concentrating on doing something',
      'Standing for long periods',
      'Washing your whole body',
      'Getting along with people who are close',
      'Taking care of your household responsibilities',
      'joining in community activities',
      'Extreme or cannot do',
    ];
    for (const p of phrases) {
      expect(`${p}:${CODE.includes(p)}`).toBe(`${p}:false`);
    }
  });

  test('no item id is hard-coded as a rendered question row', () => {
    // Item ids may appear in comments; they must not appear in built markup.
    const markupWithItemId = /['"`][^'"`\n]*<t[dr][^'"`\n]*D[1-6]\.\d/;
    expect(CODE).not.toMatch(markupWithItemId);
  });

  test('the document is rendered from the official PDF, not drawn', () => {
    expect(JS).toMatch(/pdf\.min\.mjs/);
    expect(JS).toMatch(/templates\/.*\/blank/);
    expect(JS).toMatch(/getDocument/);
  });

  test('the stylesheet does not restyle the document area', () => {
    // .whodas-page holds the canvas. It may have layout and a shadow, but no
    // font, colour or background that would alter how the instrument reads.
    const pageBlock = (CSS.match(/\.whodas-page \{[^}]*\}/) || [''])[0];
    expect(pageBlock).not.toMatch(/font-family|color\s*:/);
  });
});

describe('WHODAS frontend — no scoring in the browser', () => {
  test('no scoring denominators appear anywhere in the module', () => {
    // 106, 92, 144, 20, 16, 10, 12, 14, 24 are the WHO denominators. The two
    // that could not plausibly be anything else are asserted directly.
    expect(CODE).not.toMatch(/\b106\b/);
    expect(CODE).not.toMatch(/\/\s*144\b/);
    expect(CODE).not.toMatch(/st_s3[26]\s*=/);
  });

  test('the module never recodes a response into a number', () => {
    expect(CODE).not.toMatch(/collapsed/i);
    expect(CODE).not.toMatch(/recode/i);
    // No literal 0-4 or 1-5 map keyed by response name.
    expect(CODE).not.toMatch(/none\s*:\s*[01]\s*,\s*mild\s*:/);
  });

  test('formatScore only formats — it never computes', () => {
    expect(helpers.formatScore(75)).toBe('75.00');
    expect(helpers.formatScore(0)).toBe('0.00');
    expect(helpers.formatScore(null)).toBe('—');
    expect(helpers.formatScore(undefined)).toBe('—');
  });

  test('an unscorable result never renders as a number', () => {
    expect(helpers.displayScore({ scorable: false, refusal: { reason: 'no_32_item_pathway' } })).toBeNull();
    expect(helpers.displayScore({ scorable: true, overall: null })).toBeNull();
    expect(helpers.displayScore({ scorable: true, overall: { value: 0 } })).toBe(0);
    expect(helpers.displayScore(null)).toBeNull();
  });
});

describe('WHODAS frontend — no invented clinical meaning', () => {
  test('no severity classification language appears', () => {
    expect(CODE).not.toMatch(/\b(mild|moderate|severe|extreme)\s+disability\b/i);
    expect(CODE).not.toMatch(/severityBand|severityLabel|interpretScore|classifyScore/i);
  });

  test('no traffic-light styling that would imply a clinical band', () => {
    // Domain rows carry no state colouring at all.
    expect(CSS).not.toMatch(/\.whodas-domains[^{]*\{[^}]*background:\s*#(?:f|e)[0-9a-f]*(?:red|green)/i);
    expect(CSS).not.toMatch(/--severity|\.severity-/);
  });

  test('every rendered score is accompanied by its method and source', () => {
    expect(JS).toMatch(/sourceMethodology/);
    expect(JS).toMatch(/scoringVersion/);
    expect(JS).toMatch(/calculatedAt/);
    expect(JS).toMatch(/r\.label/);
  });
});

describe('WHODAS frontend — responses are semantic', () => {
  test('the response scale is never hard-coded as numerals', () => {
    expect(JS).not.toMatch(/value\s*=\s*['"][1-5]['"]/);
    expect(JS).not.toMatch(/\[\s*['"]none['"]\s*,\s*['"]mild['"].*\]\s*\.indexOf/);
  });

  test('option values come from the server field map', () => {
    expect(JS).toMatch(/o\.value/);
    expect(JS).toMatch(/f\.options/);
  });
});

describe('WHODAS frontend — XSS discipline', () => {
  test('esc() escapes every dangerous character', () => {
    expect(helpers.esc('<img src=x onerror=alert(1)>'))
      .toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(helpers.esc('"\'&')).toBe('&quot;&#39;&amp;');
    expect(helpers.esc(null)).toBe('');
    expect(helpers.esc(undefined)).toBe('');
  });

  test('server-supplied values are interpolated through esc()', () => {
    // Any `' + someVar + '` inside string-built markup must be esc()-wrapped.
    // esc() arguments are blanked out first, so only genuinely raw values
    // remain. The allowlist covers our own computed geometry (numbers we
    // produced from the field map) and `html`, which is markup a caller has
    // already escaped.
    const raw = SCANNABLE.match(/'\s*\+\s*(?!esc\()[a-zA-Z_$][\w.$]*\s*\+\s*'/g) || [];
    const allowed = /^'\s*\+\s*(box\.|wbox\.|viewport|Math\.|SCALE|html)\b/;
    expect([...new Set(raw.filter((s) => !allowed.test(s)))]).toEqual([]);
  });

  test('no innerHTML is fed a raw server string', () => {
    expect(JS).not.toMatch(/innerHTML\s*=\s*(?:data|res|row|a)\./);
  });
});

describe('WHODAS frontend — safe interaction rules', () => {
  test('completion is explicit and confirmed', () => {
    expect(JS).toMatch(/complete-confirm/);
    expect(JS).toMatch(/auditable amendment/);
  });

  test('a save conflict stops writing rather than overwriting', () => {
    expect(JS).toMatch(/stale_version/);
    expect(JS).toMatch(/setSaveState\('conflict'\)/);
  });

  test('the three save states the brief requires are all present', () => {
    for (const state of ['saving', 'saved', 'failed']) {
      expect(`${state}:${CSS.includes(`.whodas-save--${state}`)}`).toBe(`${state}:true`);
    }
    expect(JS).toMatch(/Saving…/);
    expect(JS).toMatch(/Saved/);
    expect(JS).toMatch(/Save failed/);
  });

  test('there is an explicit Save & Exit as well as autosave', () => {
    expect(JS).toMatch(/save-exit/);
    expect(JS).toMatch(/Save &amp; Exit/);
  });

  test('unsaved responses are flushed before the page unloads', () => {
    expect(JS).toMatch(/beforeunload/);
    expect(JS).toMatch(/flushSave\(\)/);
  });

  test('a failed save is retried and the responses are put back', () => {
    expect(JS).toMatch(/MAX_AUTOSAVE_RETRIES/);
    expect(JS).toMatch(/S\.pending\[k\]\s*=\s*body\.responses\[k\]/);
  });
});

describe('WHODAS frontend — accessibility', () => {
  test('controls are real radio inputs with WHO item text as their label', () => {
    expect(JS).toMatch(/type="radio"/);
    expect(JS).toMatch(/aria-label="'\s*\+\s*esc\(f\.field \+ '\. ' \+ label/);
  });

  test('focus is always visible', () => {
    expect(CSS).toMatch(/:focus-visible/);
    expect(CSS).toMatch(/\.whodas-opt input:focus-visible \+ \.whodas-opt__ring/);
  });

  test('state is never signalled by colour alone', () => {
    // The selected response draws a ring (a shape) and the missing state adds
    // a dashed border. The status chip moved to the assessment surface with
    // the history table; assessment-surface-guards.test.js asserts that it
    // still prints its own word rather than relying on its colour.
    expect(CSS).toMatch(/\.whodas-opt input:checked \+ \.whodas-opt__ring/);
    expect(CSS).toMatch(/border-style:\s*dashed/);
  });

  test('the save indicator is announced to screen readers', () => {
    expect(JS).toMatch(/role="status" aria-live="polite"/);
  });

  test('the completion gaps are keyboard-navigable to the item', () => {
    expect(JS).toMatch(/data-whodas="goto"/);
    expect(JS).toMatch(/target\.focus\(\)/);
  });
});

describe('WHODAS frontend — helpers behave', () => {
  test('missingItems mirrors the server rule for skipped work items', () => {
    const responses = {};
    instrument.ITEM_IDS.forEach((id) => { responses[id] = 'mild'; });
    delete responses['D5.5'];
    delete responses['D1.1'];

    const whenWorking = helpers.missingItems(
      instrument.ITEM_IDS, instrument.WORK_SCHOOL_ITEMS, responses, true
    );
    expect(whenWorking.sort()).toEqual(['D1.1', 'D5.5']);

    const whenNotWorking = helpers.missingItems(
      instrument.ITEM_IDS, instrument.WORK_SCHOOL_ITEMS, responses, false
    );
    expect(whenNotWorking).toEqual(['D1.1']);
  });

  test('rectToCss uses the viewport transform rather than its own arithmetic', () => {
    // A stub viewport that flips y, as pdf.js does.
    const viewport = { convertToViewportPoint: (x, y) => [x * 2, (100 - y) * 2] };
    const box = helpers.rectToCss(viewport, { x: 10, y: 20, w: 5, h: 4 });
    expect(box).toEqual({ left: 20, top: 152, width: 10, height: 8 });
  });

  test('methodLabel covers every administration method the server supports', () => {
    for (const m of instrument.ADMINISTRATION_METHODS) {
      expect(`${m}:${helpers.methodLabel(m)}`).not.toBe(`${m}:${m}`);
    }
  });
});

describe('WHODAS frontend — template keys stay in step with the registry', () => {
  test('the module hard-codes no template filename', () => {
    for (const tpl of registry.allTemplates()) {
      expect(`${tpl.filename}:${CODE.includes(tpl.filename)}`).toBe(`${tpl.filename}:false`);
    }
  });

  test('template keys are resolved from the server, not guessed', () => {
    expect(JS).toMatch(/templateKeyFor/);
    expect(JS).toMatch(/m\.templateKey/);
  });
});
