'use strict';

/**
 * THE PREVIEW'S PAGES — the real renderer, over a real document.
 *
 * Nothing is mocked here. A full FCA report is composed from the shipped
 * template by the shipped engine, streamed through the same pagination step the
 * preview endpoint applies, and handed to the VENDORED docx-preview build the
 * browser loads. The assertions are about what it produced: how many page
 * elements, how big they are, and whether they are separate sheets.
 *
 * ── The defect these exist for ──────────────────────────────────────────────
 * The Opal template starts each major section on a new page with
 * `w:pageBreakBefore`. docx-preview 0.4.0 parses that property and never acts
 * on it — it breaks pages only on `w:br w:type="page"` runs and section breaks
 * — so the whole report came out as ONE page element: a single sheet metres
 * long, with no boundaries to space apart. See fca/preview-pagination.js.
 *
 * jsdom cannot run the vendored jszip build (its async scheduler never
 * settles), so the Node zip library is injected as window.JSZip. The renderer
 * itself is the shipped file, unmodified.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { JSDOM } = require('jsdom');

const { buildManifest, DEFAULT_CATALOGUE } = require('../fca/manifest');
const { generateFcaDocx } = require('../fca/docx-engine');
const { paginateForPreview, paginateDocumentXml } = require('../fca/preview-pagination');

const TEMPLATE = path.join(__dirname, '..', 'fca', 'templates', 'fca-v1.docx');
const VENDOR = path.join(__dirname, '..', '..', 'frontend', 'current', 'vendor', 'docx-preview.min.js');
const FCA_CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'current', 'fca.css'), 'utf8');

const templateBuffer = fs.readFileSync(TEMPLATE);
const ALL_TAGS = DEFAULT_CATALOGUE.SECTIONS.map((s) => s.tag);

/** A whole synthetic report — every section, no participant data. */
function composeAll(tags) {
  return generateFcaDocx({
    templateBuffer,
    manifest: buildManifest({
      selectedSections: tags || ALL_TAGS,
      sectionOrder: tags || ALL_TAGS,
      customSections: [],
      scalarData: { OPAL_CLIENT_FULL_NAME: 'Synthetic Participant' },
      scalarSources: { OPAL_CLIENT_FULL_NAME: 'splose' },
      excludedFields: [],
    }),
  });
}

async function documentXml(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml').async('string');
}

/** Render a .docx with the vendored library and return its page elements. */
async function renderPages(buffer) {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  win.JSZip = JSZip;
  win.eval(fs.readFileSync(VENDOR, 'utf8'));
  const host = win.document.getElementById('host');
  await win.docx.renderAsync(buffer, host, null, {
    className: 'fca-docx-render',
    inWrapper: true,
    ignoreWidth: false,
    ignoreHeight: false,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    renderHeaders: false,       // headers pull the logo through a Blob URL jsdom has no reader for
    renderFooters: false,
    renderFootnotes: true,
    renderEndnotes: true,
    renderChanges: false,
    experimental: false,
    useBase64URL: true,
  });
  const wrapper = host.querySelector('.fca-docx-render-wrapper');
  const pages = Array.prototype.slice.call(host.querySelectorAll('.fca-docx-render-wrapper > section'));
  return { win, host, wrapper, pages, close: () => win.close() };
}

/** The inline style docx-preview writes onto each page element. */
function pageBox(page) {
  return {
    width: page.style.width,
    minHeight: page.style.minHeight,
    padding: page.style.padding,
  };
}

let composed;
let paginated;
let rendered;

beforeAll(async () => {
  composed = await composeAll();
  paginated = await paginateForPreview(composed);
  rendered = await renderPages(paginated);
}, 60000);

afterAll(() => { if (rendered) rendered.close(); });

// ── The document's own breaks ───────────────────────────────────────────────

describe('the document declares its page breaks, and they survive to the preview', () => {
  test('the composed report carries pageBreakBefore, not explicit break runs', async () => {
    const xml = await documentXml(composed);
    expect((xml.match(/<w:pageBreakBefore\b/g) || []).length).toBeGreaterThanOrEqual(15);
    expect((xml.match(/<w:br w:type="page"/g) || []).length).toBe(0);
  });

  test('the preview stream restates every one of them as a break the renderer reads', async () => {
    const xml = await documentXml(composed);
    const before = (xml.match(/<w:pageBreakBefore\b/g) || []).length;
    const next = await documentXml(paginated);
    expect((next.match(/<w:br w:type="page"/g) || []).length).toBe(before);
    expect((next.match(/<w:pageBreakBefore\b/g) || []).length).toBe(0);
  });

  test('the DOWNLOAD is untouched — Word honours the property itself', async () => {
    const xml = await documentXml(composed);
    expect(xml).toContain('<w:pageBreakBefore');
    expect(xml).not.toContain('<w:br w:type="page"');
    // …and the preview's rewrite is not shared with it: the same composition,
    // asked for twice, still produces the download's own unmodified XML.
    expect(await documentXml(await composeAll())).toBe(xml);
  });

  test('no break is inserted where the page already ends', () => {
    // A section break, then a paragraph that also asks for a new page: Word
    // shows one break, and so must the preview — a second would be a blank page.
    const xml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:body>'
      + '<w:p><w:r><w:t>first</w:t></w:r></w:p>'
      + '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr></w:p>'
      + '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>next section</w:t></w:r></w:p>'
      + '</w:body></w:document>';
    const out = paginateDocumentXml(xml);
    expect(out.found).toBe(1);
    expect(out.inserted).toBe(0);
    expect(out.xml).not.toContain('w:type="page"');
  });

  test('a leading pageBreakBefore does not produce an empty first page', () => {
    const xml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:body><w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>first</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>second</w:t></w:r></w:p></w:body></w:document>';
    const out = paginateDocumentXml(xml);
    expect(out.inserted).toBe(0);
  });

  test('a break inside a content control is found, because the renderer flattens them', () => {
    const xml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:body><w:p><w:r><w:t>cover</w:t></w:r></w:p>'
      + '<w:sdt><w:sdtContent>'
      + '<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>nested section</w:t></w:r></w:p>'
      + '</w:sdtContent></w:sdt></w:body></w:document>';
    const out = paginateDocumentXml(xml);
    expect(out.inserted).toBe(1);
    expect(out.xml).toContain('w:type="page"');
  });

  test('pageBreakBefore switched off is honoured as off', () => {
    const xml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:body><w:p><w:r><w:t>a</w:t></w:r></w:p>'
      + '<w:p><w:pPr><w:pageBreakBefore w:val="0"/></w:pPr><w:r><w:t>b</w:t></w:r></w:p>'
      + '</w:body></w:document>';
    const out = paginateDocumentXml(xml);
    expect(out.found).toBe(1);
    expect(out.inserted).toBe(0);
  });

  test('a package it cannot rewrite is returned exactly as it arrived', async () => {
    const junk = Buffer.from('not a docx at all');
    expect(await paginateForPreview(junk)).toBe(junk);
  });
});

// ── The rendered page stack ─────────────────────────────────────────────────

describe('the renderer produces a stack of separate pages', () => {
  test('a representative report renders as many page elements, not one', () => {
    expect(rendered.pages.length).toBeGreaterThanOrEqual(15);
  });

  test('without the fix the same document is a single endless sheet', async () => {
    const plain = await renderPages(composed);
    try {
      expect(plain.pages.length).toBeLessThanOrEqual(3);
      expect(rendered.pages.length).toBeGreaterThan(plain.pages.length * 5);
    } finally { plain.close(); }
  });

  test('every page carries the document\'s real page size, in full', () => {
    // The shipped template is US Letter (8.5 × 11in = 612 × 792pt); the
    // assertion is that the page keeps the DOCUMENT'S geometry, whatever it is,
    // rather than being stretched to the panel.
    const first = pageBox(rendered.pages[0]);
    expect(parseFloat(first.width)).toBeCloseTo(612, 2);
    expect(parseFloat(first.minHeight)).toBeCloseTo(792, 2);
    rendered.pages.forEach((p) => {
      expect(parseFloat(pageBox(p).width)).toBeCloseTo(612, 2);
      expect(parseFloat(pageBox(p).minHeight)).toBeCloseTo(792, 2);
    });
  });

  test('the page keeps its proportions — nothing stretches it to the panel', () => {
    const w = parseFloat(rendered.pages[0].style.width);
    const h = parseFloat(rendered.pages[0].style.minHeight);
    expect(w / h).toBeCloseTo(612 / 792, 4);
    expect(FCA_CSS).not.toMatch(/render-wrapper > section\s*\{[^}]*width:\s*100%/);
    expect(FCA_CSS).not.toMatch(/render-wrapper > section\s*\{[^}]*height:\s*(?!auto)/);
  });

  test('no page is empty — every break stands where content follows it', () => {
    rendered.pages.forEach((page, i) => {
      const text = (page.textContent || '').replace(/\s+/g, '');
      expect({ page: i + 1, empty: text.length === 0 }).toEqual({ page: i + 1, empty: false });
    });
  });

  test('the pages are the report\'s own sections, in order', () => {
    const text = rendered.pages.map((p) => (p.textContent || '').replace(/\s+/g, ' ').trim());
    const starts = ['Referral Information', 'Participant Information', 'Assessment Method',
      'Mobility', 'Cognition', 'Summary and Recommendations', 'Professional Declaration', 'Appendices'];
    starts.forEach((heading) => {
      expect(text.filter((t) => t.indexOf(heading) === 0).length).toBe(1);
    });
  });

  test('removing a section removes its page, and only its page', async () => {
    const without = ALL_TAGS.filter((t) => t.indexOf('MOBILITY') === -1);
    const smaller = await renderPages(await paginateForPreview(await composeAll(without)));
    try {
      expect(smaller.pages.length).toBe(rendered.pages.length - 1);
      const text = smaller.pages.map((p) => (p.textContent || '').replace(/\s+/g, ' ').trim());
      expect(text.filter((t) => t.indexOf('Mobility') === 0).length).toBe(0);
      expect(text.filter((t) => t.indexOf('Cognition') === 0).length).toBe(1);
    } finally { smaller.close(); }
  }, 60000);
});

// ── The stack's presentation ────────────────────────────────────────────────

describe('the pages look like separate sheets of paper', () => {
  test('the stack is a vertical column with a real gap between pages', () => {
    expect(FCA_CSS).toMatch(/\.fca-docx-render-wrapper\s*\{[^}]*flex-direction:\s*column/);
    expect(FCA_CSS).toMatch(/\.fca-docx-render-wrapper\s*\{[^}]*align-items:\s*center/);
    const gap = FCA_CSS.match(/\.fca-docx-render-wrapper\s*\{[^}]*gap:\s*(\d+)px/);
    expect(gap).toBeTruthy();
    expect(Number(gap[1])).toBeGreaterThanOrEqual(12);
  });

  test('the grey canvas shows through the gap', () => {
    expect(FCA_CSS).toMatch(/\.fca-docx-render-wrapper\s*\{[^}]*background:\s*transparent/);
    expect(FCA_CSS).toMatch(/\.fca-preview-stage\s*\{[^}]*background:\s*#e9e9e6/);
  });

  test('each page has its own paper, its own edge and its own shadow', () => {
    const rule = FCA_CSS.match(/\.fca-docx-render-wrapper > section\s*\{([^}]*)\}/)[1];
    expect(rule).toMatch(/background:\s*#fff/);
    expect(rule).toMatch(/border:\s*1px solid/);
    expect(rule).toMatch(/box-shadow:/);
    // Nothing that would join the sheets into one surface.
    expect(rule).not.toMatch(/display:\s*contents/);
    expect(rule).toMatch(/margin:\s*0;/);
    expect(rule).toMatch(/flex:\s*none/);
  });

  test('the page rule outranks the one the renderer injects at render time', () => {
    // docx-preview writes its own stylesheet INTO the host, so it lands after
    // ours in the document; an equally specific rule of ours would lose, and
    // the renderer's 30px margin and heavy default shadow would come back.
    expect(FCA_CSS).toContain('.fca-preview-stage .fca-docx .fca-docx-render-wrapper > section');
  });

  test('nothing in the stylesheet flattens or joins the page elements', () => {
    expect(FCA_CSS).not.toContain('display: contents');
    expect(FCA_CSS).not.toMatch(/render-wrapper\s*\{[^}]*display:\s*block[^}]*\}/);
    expect(FCA_CSS).not.toMatch(/render-wrapper > section\s*\{[^}]*position:\s*absolute/);
    // The page-height floor that used to collapse a page to a text block is gone.
    expect(FCA_CSS).not.toMatch(/render-wrapper > section\s*\{[^}]*min-height:\s*0/);
  });

  test('the paper stays white and the canvas light in a dark theme', () => {
    // These two colours are literal on purpose and are redefined nowhere: a
    // dark canvas under a white page is the black rectangle therapists saw.
    expect(FCA_CSS).not.toMatch(/prefers-color-scheme:\s*dark[\s\S]{0,400}\.fca-preview-stage/);
    expect(FCA_CSS).not.toMatch(/prefers-color-scheme:\s*dark[\s\S]{0,400}render-wrapper/);
    expect(FCA_CSS.match(/background:\s*#e9e9e6/g).length).toBe(1);
    expect(FCA_CSS).toMatch(/render-wrapper > section\s*\{[^}]*color:\s*#111/);
  });

  test('the fitted box, not the page, is what the stage scrolls over', () => {
    expect(FCA_CSS).toMatch(/\.fca-docx-fit\s*\{[^}]*margin:\s*0 auto/);
    expect(FCA_CSS).toMatch(/\.fca-docx\s*\{[^}]*transform-origin:\s*top left/);
    expect(FCA_CSS).toMatch(/\.fca-preview-stage\s*\{[^}]*overflow:\s*auto/);
  });

  test('the panel is sticky, viewport-sized, and leaves the footer reachable', () => {
    expect(FCA_CSS).toMatch(/\.fca-preview\s*\{[^}]*position:\s*sticky/);
    expect(FCA_CSS).toMatch(/\.fca-preview\s*\{[^}]*height:\s*clamp\(/);
    expect(FCA_CSS).toMatch(/\.fca-preview-full\s*\{[^}]*100dvh/);
  });

  test('the narrow layout stacks, contains its overflow and spares the footer', () => {
    const narrow = FCA_CSS.slice(FCA_CSS.indexOf('@media (max-width: 980px)'));
    expect(narrow).toMatch(/\.fca-body-split\s*\{\s*display:\s*block/);
    // In the flow, under the controls — not floating over them, which is what
    // covered the footer's Download action.
    expect(narrow).toMatch(/\.fca-preview\s*\{[\s\S]{0,300}position:\s*static/);
    expect(narrow).not.toMatch(/\.fca-preview\s*\{[\s\S]{0,300}translateY/);
    expect(narrow).toMatch(/\.fca-preview-open\s*\{\s*display:\s*flex/);
    expect(narrow).toMatch(/\.fca-foot\s*\{[^}]*position:\s*sticky/);
    expect(narrow).toMatch(/\.fca-preview-tools\s*\{[^}]*justify-content:\s*space-between/);
    expect(FCA_CSS).toMatch(/\.fca-shell,\s*\.fca-body,\s*\.fca-main\s*\{[^}]*overflow-x:\s*hidden/);
  });

  test('the moved-row highlight respects a reduced-motion preference', () => {
    expect(FCA_CSS).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]{0,200}\.fca-just-moved\s*\{\s*animation:\s*none/);
    // …and it is one row, not the whole list.
    expect(FCA_CSS).not.toMatch(/\.fca-orderlist\s*\{[^}]*animation/);
  });
});
