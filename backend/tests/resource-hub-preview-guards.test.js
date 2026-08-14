/**
 * RESOURCE HUB DOCUMENT PREVIEW — static guards.
 *
 * The preview pane is part of one string-building IIFE with no seams to unit
 * test through, so — following resource-hub-final.test.js and the Stage 1-3
 * guards — these assertions parse the shipped source rather than a copy.
 *
 * Code-level assertions run against a comment-stripped view, so that prose
 * explaining a rule cannot satisfy the test for the rule. Wording assertions
 * deliberately run against the full text, because user-visible strings live in
 * the code and their absence is the point of several of these tests.
 *
 * What is being pinned, and why each one matters:
 *   - The four states are all real and distinct. A viewer with only "loading"
 *     and "it worked" is the shape that produces a spinner nobody can escape.
 *   - "No preview" is a first-class answer. There is no LibreOffice, pandoc or
 *     ghostscript in this environment, so legacy Office formats genuinely
 *     cannot be rendered, and the UI has to say so instead of drawing a broken
 *     frame.
 *   - No clinical document is ever handed to a third-party viewer. A Google or
 *     Microsoft preview URL would publish the file, and the fact that Opal
 *     holds it, to someone else's servers.
 *   - Accessibility is pinned, not assumed: names on controls, a live region
 *     for page position, a labelled region, focus rings, reduced motion.
 *   - The old "View or download PDF" label promised a viewer the hub did not
 *     have. It must not come back.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');

const UI = fs.readFileSync(path.join(FRONTEND, 'resourcehub.js'), 'utf8');
const CSS = fs.readFileSync(path.join(FRONTEND, 'resourcehub.css'), 'utf8');

const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

const CODE = strip(UI);
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of a named function declaration, up to the next one. */
const fnBody = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) return '';
  const next = src.indexOf('\n  function ', start + 1);
  const nextAsync = src.indexOf('\n  async function ', start + 1);
  const ends = [next, nextAsync].filter((i) => i !== -1);
  return src.slice(start, ends.length ? Math.min(...ends) : src.length);
};

// ── 1. The misleading label is gone ─────────────────────────────────────────

describe('the label that promised a viewer the hub did not have', () => {
  /* Asserted against the comment-stripped view on purpose: the header comment
     over fileActionLabel names the old label to explain why it went, and that
     history is worth keeping. What must not exist is a string the interface
     can still render. */
  test('"View or download PDF" is no longer a string the interface can render', () => {
    expect(CODE).not.toMatch(/View or download/);
    expect(CSS_CODE).not.toMatch(/View or download/);
  });

  test('the download control says only "Download", every branch', () => {
    const fn = fnBody(CODE, 'fileActionLabel');
    expect(fn).toMatch(/Download PDF/);
    expect(fn).toMatch(/Download Word document/);
    expect(fn).toMatch(/Download editable Word version/);
    // No branch of the label may claim the control views anything.
    expect(fn).not.toMatch(/\bView\b/);
    expect(fn).not.toMatch(/\bOpen\b/);
  });

  test('preview and download are two separate controls in the file row', () => {
    const fn = fnBody(CODE, 'renderDetailFiles');
    expect(fn).toMatch(/RH2\.togglePreview\(/);       // the preview control
    expect(fn).toMatch(/href="' \+ esc\(f\.downloadUrl\)/); // the download control
    // One control that toggles, labelled for whichever way it will go.
    expect(fn).toMatch(/\(open \? 'Hide preview' : 'Preview'\)/);
  });

  test('the editable-Word variant is the server\'s judgement, not a guess', () => {
    expect(CODE).toMatch(/isEditableVariant/);
    const fn = fnBody(CODE, 'fileActionLabel');
    expect(fn).toMatch(/f\.isEditableVariant/);
  });
});

// ── 2. Four states, all real ────────────────────────────────────────────────

describe('preview states', () => {
  const stage = () => fnBody(CODE, 'renderPreviewStage');

  test('loading is a skeleton, not a bare spinner', () => {
    expect(stage()).toMatch(/p\.status === 'loading'/);
    expect(stage()).toMatch(/rh2-pv-skel/);
    expect(stage()).toMatch(/skel\(/);
  });

  test('error is its own state and offers a retry', () => {
    expect(stage()).toMatch(/p\.status === 'error'/);
    expect(stage()).toMatch(/RH2\.previewRetry\(\)/);
    expect(stage()).toMatch(/Try again/);
    expect(CODE).toMatch(/function previewRetry/);
  });

  test('unavailable is a first-class answer carrying the server\'s reason', () => {
    expect(stage()).toMatch(/p\.status === 'unavailable'/);
    expect(stage()).toMatch(/esc\(p\.reason\)/);
    expect(stage()).toMatch(/cannot be shown in the browser/);
  });

  test('every dead end still offers the download', () => {
    expect(stage()).toMatch(/previewDownloadHtml\(\)/);
    const dl = fnBody(CODE, 'previewDownloadHtml');
    expect(dl).toMatch(/esc\(f\.downloadUrl\)/);
  });

  test('ready renders by kind, and only by kinds this client can draw', () => {
    expect(CODE).toMatch(/PREVIEW_KINDS = \['pdf', 'image', 'docx', 'bundle'\]/);
    const apply = fnBody(CODE, 'applyPreviewMeta');
    expect(apply).toMatch(/PREVIEW_KINDS\.indexOf\(kind\) !== -1/);
    // An unrecognised kind falls to the honest state, not to an empty frame.
    expect(apply).toMatch(/p\.status = 'unavailable'/);
  });

  test('an empty file list keeps its own separate state', () => {
    const fn = fnBody(CODE, 'renderDetailFiles');
    expect(fn).toMatch(/No files are attached to this resource/);
    expect(fn).toMatch(/!files\.length/);
  });

  test('a file the server says is not previewable offers no preview control', () => {
    const can = fnBody(CODE, 'canPreviewFile');
    expect(can).toMatch(/f\.previewKind/);
    expect(can).toMatch(/PREVIEW_KINDS\.indexOf/);
    // The list explains the absence rather than leaving a silent gap.
    expect(CODE).toMatch(/No in-browser preview for this format/);
  });
});

// ── 3. The spinner cannot hang ──────────────────────────────────────────────

describe('no unbounded loading', () => {
  test('the metadata request has a timeout that lands on the error state', () => {
    expect(CODE).toMatch(/PREVIEW_TIMEOUT_MS = \d+/);
    const load = fnBody(CODE, 'loadPreviewMeta');
    expect(load).toMatch(/setTimeout\(/);
    expect(load).toMatch(/PREVIEW_TIMEOUT_MS/);
    expect(load).toMatch(/abort\(\)/);
  });

  test('the docx render is bounded too', () => {
    const dx = fnBody(CODE, 'drawDocx');
    expect(dx).toMatch(/PREVIEW_TIMEOUT_MS/);
    expect(dx).toMatch(/clearTimeout\(timer\)/);
  });

  test('a timeout is reported as a timeout, not as a generic failure', () => {
    expect(CODE).toMatch(/'timed_out'/);
    const txt = fnBody(CODE, 'previewErrorText');
    expect(txt).toMatch(/took too long/);
  });
});

// ── 4. Stale responses can never paint ──────────────────────────────────────

describe('supersede guards', () => {
  test('every reset bumps the revision counter', () => {
    const reset = fnBody(CODE, 'resetPreview');
    expect(reset).toMatch(/p\.rev \+= 1/);
    expect(reset).toMatch(/abort\(\)/);
    expect(reset).toMatch(/clearTimeout/);
  });

  test('switching resource and leaving the view both end the preview', () => {
    const open = CODE.slice(CODE.indexOf('async function openDetail'),
      CODE.indexOf('async function loadDetailFiles'));
    expect(open).toMatch(/resetPreview\(\)/);
    const nav = fnBody(CODE, 'nav');
    expect(nav).toMatch(/resetPreview\(\)/);
  });

  test('async continuations drop themselves when superseded', () => {
    for (const name of ['loadPreviewMeta', 'drawPdf', 'drawPdfPage', 'drawDocx']) {
      expect(fnBody(CODE, name)).toMatch(/rev !== S\.preview\.rev/);
    }
  });

  test('a slower page render cannot overwrite a newer one', () => {
    const draw = fnBody(CODE, 'drawPdfPage');
    expect(draw).toMatch(/seq = \+\+p\.drawSeq/);
    expect(draw).toMatch(/seq !== p\.drawSeq/);
  });
});

// ── 5. No third-party viewer, ever ──────────────────────────────────────────

describe('nothing is handed to a public document viewer', () => {
  const BANNED = [
    'docs.google.com',
    'drive.google.com',
    'view.officeapps.live.com',
    'office.com',
    'officeapps.live.com',
    'sharepoint.com',
    'onedrive.live.com',
    'mozilla.github.io',
    'unpkg.com',
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'gview',
  ];
  for (const host of BANNED) {
    test(`absent from the hub UI: ${host}`, () => {
      expect(UI).not.toContain(host);
      expect(CSS).not.toContain(host);
    });
  }

  test('no absolute http(s) URL is used as a preview or renderer source', () => {
    // The module does link out to official sources the record itself carries,
    // but it must never build one for a viewer, a renderer or a document.
    expect(CODE).not.toMatch(/https?:\/\/[^'"\s]*(viewer|preview|embed|gview|render)/i);
  });

  test('both renderers are the vendored, same-origin copies', () => {
    expect(CODE).toMatch(/PDFJS_SRC = '\/vendor\/pdfjs\/pdf\.min\.mjs'/);
    expect(CODE).toMatch(/PDFJS_WORKER = '\/vendor\/pdfjs\/pdf\.worker\.min\.mjs'/);
    // docx-preview and JSZip are already page globals, as in the FCA builder.
    expect(fnBody(CODE, 'drawDocx')).toMatch(/global\.docx.*global\.JSZip/s);
  });

  test('a missing renderer is an honest error, not a silent fallback', () => {
    expect(fnBody(CODE, 'drawDocx')).toMatch(/renderer_unavailable/);
    expect(fnBody(CODE, 'previewErrorText')).toMatch(/renderer_unavailable/);
  });

  test('only a same-origin, root-relative URL is ever fetched or drawn', () => {
    // Run the guard's own pattern against hostile input rather than pinning its
    // source text. The previous assertion matched the regex literally, so
    // tightening the pattern — which is the direction anyone would ever change
    // it — failed the test that exists to protect it.
    const safe = fnBody(CODE, 'safeInlineUrl');
    const literal = safe.match(/\/\^.*?\/(?=\.test)/);
    expect(literal).not.toBeNull();
    const pattern = new RegExp(literal[0].slice(1, -1));

    for (const ok of ['/api/rh2/files/abc?disposition=inline', '/a']) {
      expect({ url: ok, allowed: pattern.test(ok) }).toEqual({ url: ok, allowed: true });
    }
    // '//host' is protocol-relative; '/\host' is too, because WHATWG URL
    // resolution treats a backslash here exactly as it treats a slash.
    for (const bad of ['//evil.example/x', '/\\evil.example/x', 'https://evil.example/x',
      'javascript:alert(1)', '', 'api/rh2/files/abc']) {
      expect({ url: bad, allowed: pattern.test(bad) }).toEqual({ url: bad, allowed: false });
    }

    expect(fnBody(CODE, 'applyPreviewMeta')).toMatch(/safeInlineUrl\(/);
  });
});

// ── 6. Governance survives the new surface ──────────────────────────────────

describe('the preview pane leaks nothing the file list did not', () => {
  test('no storage key, backend or path is referenced anywhere', () => {
    expect(CODE).not.toMatch(/storage_key|storageKey|storage_backend|file_data|fileData/);
    expect(CODE).not.toMatch(/7 Resources/);
  });

  test('the preview URL is derived from the server URL, never composed', () => {
    const fn = fnBody(CODE, 'previewUrlFor');
    expect(fn).toMatch(/f\.downloadUrl/);
    expect(fn).toMatch(/'\/preview'/);
    // The standing rule: the browser does not build a files path.
    expect(CODE).not.toMatch(/'\/api\/rh2\/files\/' \+/);
  });

  test('the pane makes no access decision of its own', () => {
    for (const name of ['renderPreviewPane', 'renderPreviewStage', 'applyPreviewMeta']) {
      expect(fnBody(CODE, name)).not.toMatch(/canReadFile|canReadTier|isOwner\(\)|canAdmin\(\)/);
    }
  });

  test('a file absent from the authorised projection cannot be opened', () => {
    const open = fnBody(CODE, 'openPreview');
    expect(open).toMatch(/S\.detail && S\.detail\.files/);
    expect(open).toMatch(/if \(!f \|\| !canPreviewFile\(f\)\) return;/);
  });

  test('a refusal is worded as ambiguously as the server\'s 404', () => {
    const txt = fnBody(CODE, 'previewErrorText');
    expect(txt).toMatch(/could not be opened/);
    // Naming permission would confirm the document exists.
    expect(txt).not.toMatch(/permission|not allowed|forbidden|access denied/i);
  });
});

// ── 7. Fillable PDFs and bundles are not rewritten ──────────────────────────

describe('nothing is altered on the way to the screen', () => {
  test('a fillable PDF previews read-only and says the download is untouched', () => {
    const note = fnBody(CODE, 'renderPreviewNote');
    expect(note).toMatch(/hasFillableFields/);
    expect(note).toMatch(/read-only/);
    expect(note).toMatch(/nothing here flattens it or regenerates it/);
  });

  test('a bundle is listed, never unpacked or embedded', () => {
    const b = fnBody(CODE, 'renderPreviewBundle');
    expect(b).toMatch(/downloadable pack/);
    expect(b).toMatch(/esc\(m\[i\] && m\[i\]\.name\)/);
    expect(b).toMatch(/fileSizeLabel\(m\[i\] && m\[i\]\.bytes\)/);
    // No archive is opened, and no member is fetched on its own.
    expect(b).not.toMatch(/JSZip|loadAsync|unzip|extract/i);
    expect(b).not.toMatch(/<iframe|<embed|<object/i);
  });

  test('no iframe, embed or object element is used anywhere in the pane', () => {
    expect(CODE).not.toMatch(/<iframe|<embed|<object/i);
  });
});

// ── 8. Accessibility ────────────────────────────────────────────────────────

describe('accessibility of the preview pane', () => {
  const pane = () => fnBody(CODE, 'renderPreviewPane');
  const tools = () => fnBody(CODE, 'renderPreviewTools');

  test('the pane is a labelled region', () => {
    expect(pane()).toMatch(/role="region"/);
    expect(pane()).toMatch(/aria-label="' \+ esc\('Document preview: ' \+ name\)/);
  });

  test('the toolbar is a labelled toolbar', () => {
    expect(pane()).toMatch(/role="toolbar" aria-label="Preview controls"/);
  });

  test('every toolbar button has a real accessible name', () => {
    const t = tools();
    for (const name of ['Previous page', 'Next page', 'Zoom out', 'Zoom in',
      'Fit the page to the width of the panel', 'Close the preview']) {
      expect(t).toMatch(new RegExp(`aria-label="${name}"`));
    }
    // The glyphs inside those buttons are decorative, so they are hidden and
    // do not compete with the label.
    expect(t).toMatch(/<span aria-hidden="true">&lsaquo;<\/span>/);
    expect(t).toMatch(/<span aria-hidden="true">&rsaquo;<\/span>/);
  });

  test('page position is announced politely when it changes', () => {
    expect(tools()).toMatch(/id="rh2-pv-pos" aria-live="polite"/);
    // Updated in place — replacing a live node swallows the announcement.
    const nav = fnBody(CODE, 'paintNav');
    expect(nav).toMatch(/pos\.textContent = pagePositionText\(\)/);
    expect(fnBody(CODE, 'pagePositionText')).toMatch(/'Page ' \+ p\.page \+ ' of '/);
  });

  test('the pane has its own polite status channel for state changes', () => {
    expect(pane()).toMatch(/id="rh2-pv-live" role="status" aria-live="polite"/);
    expect(fnBody(CODE, 'announce')).toMatch(/live\.textContent/);
  });

  test('the drawn canvas is decorative; the region label is the alternative', () => {
    const draw = fnBody(CODE, 'drawPdfPage');
    expect(draw).toMatch(/canvas\.setAttribute\('aria-hidden', 'true'\)/);
  });

  test('a previewed image carries alt text', () => {
    expect(fnBody(CODE, 'renderPreviewStage')).toMatch(/alt="' \+ esc\(fileNameOf\(p\.file\)\)/);
  });

  test('the Preview control reports its expanded state and what it controls', () => {
    const fn = fnBody(CODE, 'renderDetailFiles');
    expect(fn).toMatch(/aria-expanded="/);
    expect(fn).toMatch(/aria-controls="rh2-pv"/);
    expect(fn).toMatch(/aria-label="' \+ esc\(\(open \? 'Hide preview of ' : 'Preview '\)/);
  });

  test('the Fit toggle reports pressed state, both in markup and on update', () => {
    expect(tools()).toMatch(/aria-pressed="' \+ \(p\.fit \? 'true' : 'false'\)/);
    expect(fnBody(CODE, 'paintNav')).toMatch(/setAttribute\('aria-pressed'/);
  });

  test('opening moves focus into the pane and closing gives it back', () => {
    expect(fnBody(CODE, 'openPreview')).toMatch(/focusPreview\(\)/);
    expect(fnBody(CODE, 'renderPreviewPane')).toMatch(/tabindex="-1"/);
    expect(fnBody(CODE, 'closePreview')).toMatch(/\.focus\(\)/);
  });

  test('page navigation is reachable from the keyboard as well as the toolbar', () => {
    const key = fnBody(CODE, 'previewKey');
    expect(key).toMatch(/PageDown|ArrowRight/);
    expect(key).toMatch(/PageUp|ArrowLeft/);
    expect(key).toMatch(/Escape/);
    expect(CODE).toMatch(/previewKey: previewKey/);
  });

  test('the loading skeleton is hidden from screen readers, with words instead', () => {
    const stage = fnBody(CODE, 'renderPreviewStage');
    expect(stage).toMatch(/rh2-visually-hidden">Preparing the preview/);
    expect(stage).toMatch(/rh2-pv-skel" aria-hidden="true"/);
  });

  test('every preview handler is exported, so no control is inert', () => {
    for (const name of ['togglePreview', 'closePreview', 'previewRetry',
      'previewPage', 'previewZoom', 'previewKey', 'previewImgError']) {
      expect(CODE).toMatch(new RegExp(`${name}: ${name},`));
    }
  });
});

// ── 9. Styling: focus, motion, contrast tokens ──────────────────────────────

describe('preview styles', () => {
  test('every interactive part of the pane has a visible focus ring', () => {
    expect(CSS_CODE).toMatch(/\.rh2-pv-btn:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/);
    expect(CSS_CODE).toMatch(/\.rh2-pv:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/);
  });

  test('added transitions respect prefers-reduced-motion', () => {
    expect(CSS_CODE).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}\.rh2-pv-btn\s*\{\s*transition: none/);
  });

  test('chrome colours come from the existing palette tokens', () => {
    const block = CSS_CODE.slice(CSS_CODE.indexOf('.rh2-pv {'));
    expect(block).toMatch(/var\(--accent\)/);
    expect(block).toMatch(/var\(--ink-soft\)/);
    expect(block).toMatch(/var\(--border\)/);
    expect(block).toMatch(/var\(--panel\)/);
    expect(block).toMatch(/var\(--warn-soft\)/);
  });

  test('the paper stays white in dark mode; only the chrome follows the theme', () => {
    const dark = CSS_CODE.slice(CSS_CODE.lastIndexOf('@media (prefers-color-scheme: dark)'));
    expect(dark).toMatch(/\.rh2-pv-unavailable, \.rh2-pv-error/);
    expect(dark).not.toMatch(/\.rh2-pv-page\b/);
    expect(dark).not.toMatch(/\.rh2-pv-stage\b/);
  });

  test('the stage scrolls inside itself rather than stretching the page', () => {
    expect(CSS_CODE).toMatch(/\.rh2-pv-stage\s*\{[\s\S]*?overflow: auto/);
    expect(CSS_CODE).toMatch(/\.rh2-pv-stage\s*\{[\s\S]*?max-height:/);
  });

  test('the pane has a mobile layout', () => {
    const mobile = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 760px)', CSS_CODE.indexOf('.rh2-pv {')));
    expect(mobile).toMatch(/\.rh2-pv-stage/);
  });
});
