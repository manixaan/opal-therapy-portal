'use strict';

/**
 * Structural invariants for the FCA document-preview lifecycle.
 *
 * These are static, and deliberately kept alongside the behavioural suites
 * rather than replaced by them: fca-wizard-behaviour.test.js proves what the
 * mounted wizard DOES, and these pin the shape that keeps it doing it — no
 * step-number gate, one status model, a bounded request, a canvas that is not
 * theme-dependent. The defects they catch are the ones that actually shipped:
 * a preview that could never start, and a canvas that rendered black.
 */

const fs = require('fs');
const path = require('path');

const JS = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'current', 'fca.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'current', 'fca.css'), 'utf8');

/** The body of a named function declaration, to the next top-level `function`. */
function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf('\n  function ', start + 10);
  return src.slice(start, next > start ? next : start + 4000);
}

describe('the preview starts on any step where the panel is visible', () => {
  test('no hard-coded wizard-step gate schedules the preview', () => {
    // The original defect: `if (S.step === 5)` was the only trigger, while the
    // preview aside is persistent. On every other step nothing requested a
    // render, so the panel sat on "Preparing document preview…" with no
    // request in flight and no error to retry — unrecoverable by design.
    expect(JS).not.toMatch(/S\.step === 5\s*\)\s*\{\s*scheduleExactPreview/);
    expect(JS).not.toMatch(/S\.step === 5 \|\| S\.step === 6/);
  });

  test('the render is gated on lifecycle conditions, not on a step number', () => {
    const body = fnBody(JS, 'ensureExactPreview');
    expect(body).toContain('previewVisible()');      // 1. mounted and visible
    expect(body).toContain('exactSignature()');      // 2. enough data to compose
    expect(body).toMatch(/status === 'ready'/);      // 3. a valid preview exists
    expect(body).toMatch(/status === 'rendering'/);  // 4. a request already running
    // …and "a valid preview exists" means one that is still drawn: re-entering
    // the step rebuilds the panel, so a matching signature is not enough.
    expect(body).toContain('previewPages().length');
  });

  test('the signature covers everything the document is composed from', () => {
    const body = fnBody(JS, 'exactSignature');
    ['selectedTags()', 'sectionOrder', 'customList()', 'currentExcluded()', 'S.overrides']
      .forEach((part) => expect(body).toContain(part));
  });

  test('every wizard render passes through the gate', () => {
    expect(JS).toContain('ensureExactPreview();');
  });
});

describe('the loading state always resolves', () => {
  test('there is an explicit status model rather than boolean flags', () => {
    expect(JS).toMatch(/status: 'idle'/);
    for (const s of ['scheduled', 'rendering', 'ready', 'error']) {
      expect(JS).toContain(`'${s}'`);
    }
    // The old flags are gone, so no code path can leave them disagreeing.
    expect(JS).not.toMatch(/S\.exact\.rendering\s*=/);
    expect(JS).not.toMatch(/S\.exact\.rendered\s*=\s*true/);
  });

  test('a request cannot hang indefinitely', () => {
    expect(JS).toMatch(/EXACT_TIMEOUT_MS\s*=\s*\d+/);
    const body = fnBody(JS, 'runExactPreview');
    expect(body).toContain('AbortController');
    expect(body).toMatch(/setTimeout\(/);
    expect(body).toContain('EXACT_TIMEOUT_MS');
  });

  test('a timeout surfaces as an actionable error, not silence', () => {
    const body = fnBody(JS, 'runExactPreview');
    expect(body).toMatch(/AbortError.*timed_out|timed_out.*AbortError/s);
    expect(body).toMatch(/status = 'error'/);
  });

  test('the preparing message belongs to the idle state and nothing else', () => {
    // Its one appearance is inside the idle branch, and only when no document
    // has ever been drawn — a panel showing a document never claims to be
    // preparing one.
    const CODE = JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    expect((CODE.match(/Preparing document preview/g) || []).length).toBe(1);
    expect(JS).toMatch(/status === 'idle' && !e\.renderedSig\) \{[\s\S]{0,200}Preparing document preview/);
  });

  test('a routine update is an overlay, never a replacement', () => {
    // The document already on screen stays there while the next one composes.
    expect(JS).toMatch(/status === 'rendering' \|\| e\.status === 'scheduled'/);
    expect(JS).toContain('Updating preview…');
    const body = fnBody(JS, 'paintExact');
    expect(body).not.toContain('fca-docx-host');
    expect(body).not.toContain('fca-docx-fit');
    expect(body).toContain('fca-preview-overlay');
  });

  test('the error state offers Try again', () => {
    expect(JS).toMatch(/data-fca="preview-refresh">Try again<\/button>/);
  });
});

describe('concurrent and repeated renders', () => {
  test('rapid changes are debounced rather than each firing a request', () => {
    expect(JS).toMatch(/function scheduleExactPreview\(delay, force\)/);
    expect(JS).toMatch(/clearTimeout\(exactTimer\)/);
  });

  test('an in-flight request is aborted when superseded', () => {
    const body = fnBody(JS, 'runExactPreview');
    expect(body).toMatch(/S\.exact\.ctrl[\s\S]{0,80}abort\(\)/);
  });

  test('a stale response cannot overwrite a newer one', () => {
    const body = fnBody(JS, 'runExactPreview');
    // Guarded on both the success and the failure path.
    const guards = body.match(/rev !== S\.exact\.rev/g) || [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
  });

  test('an identical render is not repeated unless Refresh forces it', () => {
    const body = fnBody(JS, 'runExactPreview');
    expect(body).toMatch(/!force && S\.exact\.renderedSig === sig/);
    expect(JS).toMatch(/preview-refresh'\)[\s\S]{0,140}scheduleExactPreview\(0, true\)/);
    // A skipped render settles the status on its way out. Leaving it on
    // 'scheduled' was what pinned "Updating preview…" over a document that was
    // already the newest one.
    expect(body).toMatch(/!force && S\.exact\.renderedSig === sig[\s\S]{0,200}status = 'ready'/);
  });

  test('navigating between steps keeps a valid preview', () => {
    // ensureExactPreview returns early when the signature already rendered AND
    // the document is still drawn, so step changes do no work and do not blank
    // the panel.
    const body = fnBody(JS, 'ensureExactPreview');
    expect(body).toMatch(/renderedSig === sig[\s\S]{0,120}return/);
    expect(body).toContain('previewPages().length');
  });
});

describe('the document canvas looks like paper in both themes', () => {
  test('the stage is never given a dark background', () => {
    // The black rectangle: a prefers-color-scheme rule painted the canvas
    // #1a1a19. A Word page is white paper; inverting the surface under it makes
    // the panel read as broken rather than as a document.
    expect(CSS).not.toMatch(/prefers-color-scheme: dark[^}]*\}\s*\.fca-preview-stage/);
    expect(CSS).not.toContain('.fca-preview-stage { background: #1a1a19; }');
    expect(CSS).toMatch(/\.fca-preview-stage\s*\{[^}]*background:\s*#e9e9e6/);
  });

  test('pages are white, centred, shadowed and separated', () => {
    expect(CSS).toMatch(/\.fca-docx-render-wrapper\s*\{[^}]*align-items:\s*center/);
    expect(CSS).toMatch(/render-wrapper > section\s*\{[^}]*background:\s*#fff/);
    expect(CSS).toMatch(/render-wrapper > section\s*\{[^}]*box-shadow/);
    expect(CSS).toMatch(/\.fca-docx-render-wrapper\s*\{[^}]*gap:\s*\d+px/);
  });

  test('the stage has a usable height derived from the viewport', () => {
    expect(CSS).toMatch(/\.fca-preview-stage\s*\{[^}]*min-height:\s*clamp\(/);
  });

  test('full screen uses the real viewport height', () => {
    expect(CSS).toMatch(/\.fca-preview-full\s*\{[^}]*100dvh/);
  });
});

describe('nothing scheduled outlives the wizard', () => {
  test('closing tears down the observer, the debounce and the in-flight request', () => {
    const body = fnBody(JS, 'closeWizard');
    expect(body).toContain('teardownFit()');
    expect(body).toContain('clearTimeout(exactTimer)');
    expect(body).toContain('S.exact.ctrl.abort()');
    expect(body).toMatch(/S\.exact\.rev \+= 1/);
  });

  test('a save that lands after the close cannot start a render', () => {
    expect(fnBody(JS, 'scheduleExactPreview')).toContain('if (!S.open)');
    expect(fnBody(JS, 'runExactPreview')).toContain('if (!S.open');
  });
});
