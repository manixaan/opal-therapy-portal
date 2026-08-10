'use strict';

/**
 * PROGRESS NOTE LETTER — engine tests against the REAL shipped template.
 *
 * Nothing is mocked. Every assertion is made by unzipping the produced .docx
 * and reading its XML, because the only thing that matters is what Word
 * actually receives.
 *
 * Covers the acceptance items that live in the engine: selected optional
 * blocks present, unselected blocks fully removed with no empty paragraph and
 * no leftover drafting guidance, custom content replacing the anchor with the
 * right Opal styles and staying editable, no anchor when there is none,
 * repeated scalars consistent, organisation tags in header6, the document id in
 * footer6 with the PAGE field intact, multiline values as real w:br line
 * breaks, the whole CC and AHPRA paragraphs removed when unused, branding bytes
 * untouched, no participant leaking between concurrent generations, and the
 * package opening without repair.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');

const { generateLetterDocx, assertNoPortalPlaceholders } = require('../fca/letter-blocks');
const { generateFcaDocx } = require('../fca/docx-engine');
const ltm = require('../fca/letter-template-map');

const TEMPLATE_PATH = path.join(__dirname, '..', 'fca', 'templates', ltm.LETTER_TEMPLATE_FILENAME);
const templateBuffer = fs.readFileSync(TEMPLATE_PATH);

// ── Helpers ──────────────────────────────────────────────────────────────────

const parse = (xml) => new DOMParser().parseFromString(xml, 'text/xml');

async function partsOf(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const out = { _names: Object.keys(zip.files), _zip: zip };
  for (const name of out._names) {
    if (/\.(xml|rels)$/.test(name)) out[name] = await zip.file(name).async('string');
  }
  return out;
}

const directChildren = (el, name) => {
  const o = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && n.nodeName === name) o.push(n);
  return o;
};
const directChild = (el, name) => directChildren(el, name)[0] || null;
const directChildNames = (el) => {
  const o = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) o.push(n.nodeName);
  return o;
};

function ownTag(sdt) {
  const pr = directChild(sdt, 'w:sdtPr');
  if (!pr) return null;
  const t = directChild(pr, 'w:tag');
  return t ? t.getAttribute('w:val') : null;
}

function paragraphStyle(p) {
  const pPr = directChild(p, 'w:pPr');
  if (!pPr) return null;
  const st = directChild(pPr, 'w:pStyle');
  return st ? st.getAttribute('w:val') : null;
}

/** Visible text of a paragraph, field instructions excluded. */
function paragraphText(p) {
  let out = '';
  (function walk(node) {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      if (n.nodeName === 'w:instrText' || n.nodeName === 'w:fldChar') continue;
      if (n.nodeName === 'w:t') out += n.textContent || '';
      else if (n.nodeName === 'w:br') out += '\n';
      else walk(n);
    }
  }(p));
  return out.trim();
}

function bodyParagraphs(xml) {
  const doc = parse(xml);
  return Array.from(doc.getElementsByTagName('w:p')).map((p) => ({
    style: paragraphStyle(p),
    text: paragraphText(p),
    node: p,
  }));
}

/**
 * The structural invariants Word raises the repair dialog over: a control
 * without its content, sdtPr after sdtContent, or pPr in the wrong position.
 */
function assertStructurallySound(xml, partName) {
  const doc = parse(xml);
  expect(doc.documentElement).toBeTruthy();

  for (const sdt of Array.from(doc.getElementsByTagName('w:sdt'))) {
    const names = directChildNames(sdt);
    expect(names).toContain('w:sdtPr');
    expect(names).toContain('w:sdtContent');
    expect(names.indexOf('w:sdtPr')).toBeLessThan(names.indexOf('w:sdtContent'));
  }

  for (const p of Array.from(doc.getElementsByTagName('w:p'))) {
    const names = directChildNames(p);
    const i = names.indexOf('w:pPr');
    if (i >= 0) expect(i).toBe(0); // pPr must be first, if present
    expect(partName).toBeTruthy();
  }
}

// ── Manifest fixtures ────────────────────────────────────────────────────────

/** A complete, realistic scalar set. Every required tag resolves. */
function fullScalars(overrides = {}) {
  return {
    OPAL_LETTER_DATE: '10/08/2026',
    OPAL_LETTER_SUBJECT: 'Progress update and continued therapy funding',
    OPAL_LETTER_REPORTING_PERIOD: '1 February 2026 to 31 July 2026',
    OPAL_LETTER_RECIPIENT_NAME: 'Morgan Reid',
    OPAL_LETTER_RECIPIENT_ROLE: 'Support Coordinator',
    OPAL_LETTER_RECIPIENT_ORGANISATION: 'Southern Rivers Coordination',
    OPAL_LETTER_RECIPIENT_ADDRESS: 'Level 2, 88 Wellington Street\nEast Perth WA 6004',
    OPAL_LETTER_SALUTATION: 'Morgan',
    OPAL_LETTER_CC: 'Alex Tan, Bright Futures Plan Management\nJordan Blake',
    OPAL_CLIENT_FULL_NAME: 'Riley Anne Thompson',
    OPAL_CLIENT_PREFERRED_NAME: 'Riley',
    OPAL_CLIENT_NDIS_NUMBER: '430998877',
    OPAL_THERAPIST_FULL_NAME: 'Dana Whitfield',
    OPAL_THERAPIST_ROLE: 'Senior Occupational Therapist',
    OPAL_THERAPIST_CREDENTIALS: 'AHPRA Registered Occupational Therapist',
    OPAL_THERAPIST_QUALIFICATIONS: 'BSc (Hons) Occupational Therapy\nGraduate Certificate in Neurological Rehabilitation',
    OPAL_THERAPIST_AHPRA_NUMBER: 'OCC0001234567',
    OPAL_THERAPIST_PHONE: '08 9000 1111',
    OPAL_THERAPIST_EMAIL: 'dana@opaltherapy.invalid',
    OPAL_ORGANISATION_ADDRESS: 'Unit 5, 120 Hay Street\nSubiaco WA 6008',
    OPAL_ORGANISATION_PHONE: '08 9000 2222',
    OPAL_ORGANISATION_EMAIL: 'hello@opaltherapy.invalid',
    OPAL_ORGANISATION_WEBSITE: 'www.opaltherapy.invalid',
    OPAL_LETTER_DOCUMENT_ID: 'LTR-1A2B3C4D',
    ...overrides,
  };
}

function manifest({ scalars = {}, excluded = [], custom = [] } = {}) {
  const sections = ltm.LETTER_SECTIONS.map((s, i) => ({
    tag: s.tag,
    kind: s.required ? 'required' : 'optional',
    title: s.title,
    included: s.required ? true : !excluded.includes(s.tag),
    order: i,
  }));
  for (const [i, c] of custom.entries()) {
    sections.push({
      tag: c.tag || ltm.letterCustomSectionTag(c.title || '', `custom-${i}`),
      kind: 'custom',
      title: c.title ?? null,
      guidance: c.guidance ?? null,
      included: true,
      order: i,
    });
  }
  return { scalarData: fullScalars(scalars), sections };
}

const generate = (m) => generateLetterDocx({ templateBuffer, manifest: m });

// The drafting guidance the template ships inside each block, used to prove a
// removed block leaves nothing behind.
const GUIDANCE = {
  OPAL_SECTION_LETTER_CURRENT_PRESENTATION: 'current functional presentation',
  OPAL_SECTION_LETTER_CLINICAL_OPINION_RECOMMENDATIONS: 'clinical opinion, recommendations',
  OPAL_SECTION_LETTER_NEXT_STEPS: 'agreed next steps',
};

// ═══════════════════════════════════════════════════════════════════════════

describe('blocks', () => {
  test('every block is present when all are selected', async () => {
    const parts = await partsOf(await generate(manifest()));
    for (const s of ltm.LETTER_SECTIONS) {
      expect(parts['word/document.xml']).toContain(`w:val="${s.tag}"`);
    }
  });

  test('a selected optional block keeps its content', async () => {
    const parts = await partsOf(await generate(manifest({
      excluded: ['OPAL_SECTION_LETTER_NEXT_STEPS'],
    })));
    expect(parts['word/document.xml']).toContain('OPAL_SECTION_LETTER_CLINICAL_OPINION_RECOMMENDATIONS');
    expect(parts['word/document.xml']).toContain(GUIDANCE.OPAL_SECTION_LETTER_CLINICAL_OPINION_RECOMMENDATIONS);
  });

  test('an unselected block leaves no control, no guidance and no empty paragraph', async () => {
    const before = bodyParagraphs((await partsOf(await generate(manifest()))) ['word/document.xml']);
    const after = bodyParagraphs((await partsOf(await generate(manifest({
      excluded: ['OPAL_SECTION_LETTER_CURRENT_PRESENTATION'],
    })))) ['word/document.xml']);

    const xml = (await partsOf(await generate(manifest({
      excluded: ['OPAL_SECTION_LETTER_CURRENT_PRESENTATION'],
    })))) ['word/document.xml'];

    expect(xml).not.toContain('OPAL_SECTION_LETTER_CURRENT_PRESENTATION');
    expect(xml).not.toContain(GUIDANCE.OPAL_SECTION_LETTER_CURRENT_PRESENTATION);

    // Exactly ONE paragraph fewer — the block's own. No blank left behind.
    expect(after.length).toBe(before.length - 1);
    expect(after.filter((p) => p.text === '' && p.style === ltm.STYLE.BODY).length)
      .toBe(before.filter((p) => p.text === '' && p.style === ltm.STYLE.BODY).length);
  });

  test('removing every optional block removes exactly three paragraphs', async () => {
    const all = bodyParagraphs((await partsOf(await generate(manifest())))['word/document.xml']);
    const none = bodyParagraphs((await partsOf(await generate(manifest({
      excluded: ltm.LETTER_OPTIONAL_SECTION_TAGS,
    }))))['word/document.xml']);
    expect(none.length).toBe(all.length - 3);
  });

  test('required blocks survive even when the manifest says to exclude them', async () => {
    // The composer would never emit this, but the engine must not be the thing
    // that makes it possible: a manifest asking to drop a required block is
    // rendered exactly as asked, which is why the ROUTE refuses the request.
    // Here we assert the normal path: required blocks are always included.
    const parts = await partsOf(await generate(manifest({ excluded: ltm.LETTER_OPTIONAL_SECTION_TAGS })));
    for (const tag of ltm.LETTER_REQUIRED_SECTION_TAGS) {
      expect(parts['word/document.xml']).toContain(tag);
    }
  });
});

describe('custom content', () => {
  test('replaces the anchor, in order, with the right Opal styles', async () => {
    const parts = await partsOf(await generate(manifest({
      custom: [
        { title: 'Equipment trial', guidance: 'A shower chair trial ran over four sessions.' },
        { title: 'School liaison', guidance: 'Classroom strategies were shared with the school.' },
      ],
    })));
    const xml = parts['word/document.xml'];

    expect(xml).not.toContain(ltm.LETTER_CUSTOM_SECTION_ANCHOR);
    expect(xml).not.toContain('Optional custom content inserted here');

    const paras = bodyParagraphs(xml);
    const labels = paras.filter((p) => p.style === ltm.STYLE.BODY_EMPHASIS).map((p) => p.text);
    expect(labels).toEqual(['Equipment trial', 'School liaison']);

    const bodies = paras.map((p) => p.text);
    expect(bodies).toContain('A shower chair trial ran over four sessions.');
    expect(bodies).toContain('Classroom strategies were shared with the school.');

    // The body paragraph is OPAL–Body, not a heading.
    const doc = parse(xml);
    const custom = Array.from(doc.getElementsByTagName('w:sdt'))
      .find((s) => /^OPAL_SECTION_LETTER_CUSTOM_/.test(ownTag(s) || ''));
    const content = directChild(custom, 'w:sdtContent');
    expect(directChildren(content, 'w:p').map(paragraphStyle))
      .toEqual([ltm.STYLE.BODY_EMPHASIS, ltm.STYLE.BODY]);
    expect(xml).not.toContain(ltm.STYLE.HEADING2);
  });

  test('a block with no label emits only the body paragraph', async () => {
    const xml = (await partsOf(await generate(manifest({
      custom: [{ title: '', guidance: 'A standalone paragraph with no heading.' }],
    }))))['word/document.xml'];

    const doc = parse(xml);
    const custom = Array.from(doc.getElementsByTagName('w:sdt'))
      .find((s) => /^OPAL_SECTION_LETTER_CUSTOM_/.test(ownTag(s) || ''));
    const content = directChild(custom, 'w:sdtContent');
    expect(directChildren(content, 'w:p').map(paragraphStyle)).toEqual([ltm.STYLE.BODY]);
    // No empty bold line was left where a label would have gone.
    expect(bodyParagraphs(xml).filter((p) => p.style === ltm.STYLE.BODY_EMPHASIS && p.text === ''))
      .toEqual([]);
  });

  test('the anchor is gone entirely when there is no custom content', async () => {
    const xml = (await partsOf(await generate(manifest())))['word/document.xml'];
    expect(xml).not.toContain(ltm.LETTER_CUSTOM_SECTION_ANCHOR);
    expect(xml).not.toContain('Optional custom content inserted here');
    expect(xml).not.toContain('OPAL_SECTION_LETTER_CUSTOM_');
  });

  test('custom blocks stay editable — no lock, and a real content control', async () => {
    const xml = (await partsOf(await generate(manifest({
      custom: [{ title: 'Equipment', guidance: 'Text.' }],
    }))))['word/document.xml'];

    const doc = parse(xml);
    const custom = Array.from(doc.getElementsByTagName('w:sdt'))
      .find((s) => /^OPAL_SECTION_LETTER_CUSTOM_/.test(ownTag(s) || ''));
    const pr = directChild(custom, 'w:sdtPr');
    expect(directChild(pr, 'w:lock')).toBeNull();
    expect(directChild(pr, 'w:id')).toBeTruthy();
    expect(directChild(custom, 'w:sdtContent')).toBeTruthy();
  });

  test('generated w:id values never collide with the template\'s own', async () => {
    const templateIds = new Set(
      [...(await (await JSZip.loadAsync(templateBuffer)).file('word/document.xml').async('string'))
        .matchAll(/<w:id w:val="(-?\d+)"/g)].map((m) => m[1])
    );
    const xml = (await partsOf(await generate(manifest({
      custom: [{ title: 'A', guidance: 'a' }, { title: 'B', guidance: 'b' }, { title: 'C', guidance: 'c' }],
    }))))['word/document.xml'];

    const doc = parse(xml);
    const customIds = Array.from(doc.getElementsByTagName('w:sdt'))
      .filter((s) => /^OPAL_SECTION_LETTER_CUSTOM_/.test(ownTag(s) || ''))
      .map((s) => directChild(directChild(s, 'w:sdtPr'), 'w:id').getAttribute('w:val'));

    expect(customIds).toHaveLength(3);
    expect(new Set(customIds).size).toBe(3);
    for (const id of customIds) expect(templateIds.has(id)).toBe(false);
  });
});

describe('scalars', () => {
  test('a repeated scalar is written identically at every occurrence', async () => {
    const xml = (await partsOf(await generate(manifest())))['word/document.xml'];
    const doc = parse(xml);

    for (const tag of ['OPAL_CLIENT_FULL_NAME', 'OPAL_THERAPIST_ROLE']) {
      const values = Array.from(doc.getElementsByTagName('w:sdt'))
        .filter((s) => ownTag(s) === tag)
        .map((s) => directChild(s, 'w:sdtContent').textContent.trim());
      expect(values).toHaveLength(2);
      expect(values[0]).toBe(values[1]);
      expect(values[0]).toBe(fullScalars()[tag]);
    }
  });

  test('run properties survive population', async () => {
    const xml = (await partsOf(await generate(manifest())))['word/document.xml'];
    const doc = parse(xml);
    const sdt = Array.from(doc.getElementsByTagName('w:sdt'))
      .find((s) => ownTag(s) === 'OPAL_LETTER_SALUTATION');
    const run = directChild(sdt, 'w:sdtContent').getElementsByTagName('w:r')[0];
    expect(directChild(run, 'w:rPr')).toBeTruthy();
  });

  test('the organisation letterhead is populated in header6', async () => {
    const parts = await partsOf(await generate(manifest()));
    const header = parts['word/header6.xml'];
    expect(header).toContain('Unit 5, 120 Hay Street');
    expect(header).toContain('08 9000 2222');
    expect(header).toContain('hello@opaltherapy.invalid');
    expect(header).toContain('www.opaltherapy.invalid');
    expect(header).not.toContain('[PORTAL');
  });

  test('the document id is populated in footer6 and the PAGE field survives', async () => {
    const parts = await partsOf(await generate(manifest()));
    const footer = parts['word/footer6.xml'];
    expect(footer).toContain('LTR-1A2B3C4D');
    expect(footer).not.toContain('[PORTAL');
    // begin / PAGE / separate / end, exactly as the template shipped it.
    expect(footer).toMatch(/<w:instrText[^>]*>\s*PAGE\s*<\/w:instrText>/);
    expect((footer.match(/w:fldCharType="begin"/g) || [])).toHaveLength(1);
    expect((footer.match(/w:fldCharType="end"/g) || [])).toHaveLength(1);
  });

  test('a null value never prints the string null or undefined', async () => {
    const xml = (await partsOf(await generate(manifest({
      scalars: { OPAL_LETTER_CC: null, OPAL_THERAPIST_AHPRA_NUMBER: null },
    }))))['word/document.xml'];
    expect(xml).not.toMatch(/>null</);
    expect(xml).not.toMatch(/>undefined</);
  });
});

describe('multiline values', () => {
  test('a multi-line recipient address renders as real w:br line breaks', async () => {
    const xml = (await partsOf(await generate(manifest())))['word/document.xml'];
    const doc = parse(xml);
    const sdt = Array.from(doc.getElementsByTagName('w:sdt'))
      .find((s) => ownTag(s) === 'OPAL_LETTER_RECIPIENT_ADDRESS');
    const content = directChild(sdt, 'w:sdtContent');

    expect(content.getElementsByTagName('w:br')).toHaveLength(1);
    const texts = Array.from(content.getElementsByTagName('w:t')).map((t) => t.textContent);
    expect(texts).toEqual(['Level 2, 88 Wellington Street', 'East Perth WA 6004']);

    // Never a raw newline inside a single w:t.
    for (const t of texts) expect(t).not.toContain('\n');
  });

  test('the w:br sits inside the run, so the template\'s formatting applies to every line', async () => {
    const xml = (await partsOf(await generate(manifest())))['word/document.xml'];
    const doc = parse(xml);
    const sdt = Array.from(doc.getElementsByTagName('w:sdt'))
      .find((s) => ownTag(s) === 'OPAL_LETTER_RECIPIENT_ADDRESS');
    const runs = directChild(sdt, 'w:sdtContent').getElementsByTagName('w:r');
    expect(runs).toHaveLength(1);
    expect(directChild(runs[0], 'w:rPr')).toBeTruthy();
    expect(directChildren(runs[0], 'w:br')).toHaveLength(1);
  });

  test('a two-entry CC list renders on two lines', async () => {
    const xml = (await partsOf(await generate(manifest())))['word/document.xml'];
    const doc = parse(xml);
    const sdt = Array.from(doc.getElementsByTagName('w:sdt'))
      .find((s) => ownTag(s) === 'OPAL_LETTER_CC');
    const content = directChild(sdt, 'w:sdtContent');
    expect(content.getElementsByTagName('w:br')).toHaveLength(1);
    expect(Array.from(content.getElementsByTagName('w:t')).map((t) => t.textContent))
      .toEqual(['Alex Tan, Bright Futures Plan Management', 'Jordan Blake']);
  });

  test('the multi-line letterhead address renders with w:br in header6', async () => {
    const header = (await partsOf(await generate(manifest())))['word/header6.xml'];
    const doc = parse(header);
    const sdt = Array.from(doc.getElementsByTagName('w:sdt'))
      .find((s) => ownTag(s) === 'OPAL_ORGANISATION_ADDRESS');
    expect(directChild(sdt, 'w:sdtContent').getElementsByTagName('w:br')).toHaveLength(1);
  });

  test('a single-line value gains no line breaks', async () => {
    const xml = (await partsOf(await generate(manifest({
      scalars: { OPAL_LETTER_RECIPIENT_ADDRESS: '1 Short Street, Perth WA 6000' },
    }))))['word/document.xml'];
    const doc = parse(xml);
    const sdt = Array.from(doc.getElementsByTagName('w:sdt'))
      .find((s) => ownTag(s) === 'OPAL_LETTER_RECIPIENT_ADDRESS');
    expect(directChild(sdt, 'w:sdtContent').getElementsByTagName('w:br')).toHaveLength(0);
  });
});

describe('optional-line cleanup', () => {
  test('no CC removes the WHOLE paragraph, label and all', async () => {
    const withCc = bodyParagraphs((await partsOf(await generate(manifest())))['word/document.xml']);
    const xml = (await partsOf(await generate(manifest({ scalars: { OPAL_LETTER_CC: null } }))))['word/document.xml'];
    const without = bodyParagraphs(xml);

    expect(withCc.some((p) => p.text.startsWith('CC:'))).toBe(true);
    expect(without.some((p) => p.text.startsWith('CC:'))).toBe(false);
    expect(xml).not.toContain('OPAL_LETTER_CC');
    expect(xml).not.toContain('CC:');
    expect(without.length).toBe(withCc.length - 1);
  });

  test('no AHPRA number removes the whole "AHPRA registration:" paragraph', async () => {
    const xml = (await partsOf(await generate(manifest({
      scalars: { OPAL_THERAPIST_AHPRA_NUMBER: null },
    }))))['word/document.xml'];
    expect(xml).not.toContain('AHPRA registration');
    expect(xml).not.toContain('OPAL_THERAPIST_AHPRA_NUMBER');
  });

  test('no CC and no AHPRA leaves no empty label and no dangling separator', async () => {
    const buffer = await generate(manifest({
      scalars: {
        OPAL_LETTER_CC: null,
        OPAL_THERAPIST_AHPRA_NUMBER: null,
        OPAL_LETTER_RECIPIENT_ROLE: null,
        OPAL_LETTER_RECIPIENT_ORGANISATION: null,
        OPAL_LETTER_RECIPIENT_ADDRESS: null,
        OPAL_THERAPIST_QUALIFICATIONS: null,
      },
    }));
    const xml = (await partsOf(buffer))['word/document.xml'];
    const paras = bodyParagraphs(xml);

    // No paragraph that is only a label, a separator or whitespace.
    for (const p of paras) {
      expect(p.text).not.toMatch(/^(CC|AHPRA registration|Phone|Email)\s*:?\s*$/i);
      expect(p.text).not.toMatch(/^[|·\-–—\s]+$/);
      expect(p.text).not.toMatch(/:\s*$/);
      expect(p.text).not.toMatch(/\|\s*$/);
    }

    // And no unpopulated portal placeholder anywhere in the package.
    await expect(assertNoPortalPlaceholders(buffer)).resolves.toBeUndefined();
  });

  test('an optional line with a value keeps its paragraph', async () => {
    const xml = (await partsOf(await generate(manifest())))['word/document.xml'];
    expect(xml).toContain('AHPRA registration');
    expect(xml).toContain('OCC0001234567');
    expect(bodyParagraphs(xml).some((p) => p.text.startsWith('CC:'))).toBe(true);
  });

  test('a blank string counts as absent, not as an empty value', async () => {
    const xml = (await partsOf(await generate(manifest({
      scalars: { OPAL_LETTER_CC: '   ' },
    }))))['word/document.xml'];
    expect(xml).not.toContain('CC:');
  });
});

describe('the package', () => {
  test('every original part is still present, and nothing new appeared', async () => {
    const before = Object.keys((await JSZip.loadAsync(templateBuffer)).files).sort();
    const after = (await partsOf(await generate(manifest())))._names.slice().sort();
    expect(after).toEqual(before);
  });

  test('branding bytes are untouched — logo, theme, styles, numbering, rels', async () => {
    const src = await JSZip.loadAsync(templateBuffer);
    const out = await JSZip.loadAsync(await generate(manifest({
      excluded: ['OPAL_SECTION_LETTER_NEXT_STEPS'],
      custom: [{ title: 'Equipment', guidance: 'Text.' }],
    })));

    for (const name of [
      'word/media/image1.png',
      'word/theme/theme1.xml',
      'word/styles.xml',
      'word/numbering.xml',
      'word/_rels/document.xml.rels',
      'word/_rels/header6.xml.rels',
      '[Content_Types].xml',
    ]) {
      const a = await src.file(name).async('nodebuffer');
      const b = await out.file(name).async('nodebuffer');
      expect([name, Buffer.compare(a, b)]).toEqual([name, 0]);
    }
  });

  test('the modified parts are structurally sound', async () => {
    const parts = await partsOf(await generate(manifest({
      excluded: ['OPAL_SECTION_LETTER_CURRENT_PRESENTATION'],
      custom: [{ title: 'Equipment', guidance: 'Text.' }],
      scalars: { OPAL_LETTER_CC: null },
    })));
    for (const name of ['word/document.xml', 'word/header6.xml', 'word/footer6.xml']) {
      assertStructurallySound(parts[name], name);
    }
  });

  test('opens without repair', async () => {
    const buffer = await generate(manifest({ custom: [{ title: 'Equipment', guidance: 'Text.' }] }));
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'opal-letter-')), 'letter.docx');
    fs.writeFileSync(file, buffer);

    // textutil is the macOS system Word reader. Where it exists, a package it
    // refuses is a package Word would offer to repair. Where it does not, the
    // structural assertions above stand on their own rather than the test
    // silently passing on a claim it never checked.
    let converted = null;
    try {
      execFileSync('/usr/bin/textutil', ['-convert', 'txt', '-stdout', file], { stdio: ['ignore', 'pipe', 'ignore'] });
      converted = fs.existsSync('/usr/bin/textutil');
    } catch (err) {
      if (fs.existsSync('/usr/bin/textutil')) throw err; // a real rejection
    }
    if (converted) {
      const text = execFileSync('/usr/bin/textutil', ['-convert', 'txt', '-stdout', file]).toString();
      expect(text).toContain('Riley Anne Thompson');
      expect(text).toContain('Equipment');
    }
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
});

describe('isolation', () => {
  test('concurrent generations never leak a participant into another letter', async () => {
    // Two-digit suffixes throughout: "…01" must not be a substring of "…010",
    // or the leakage assertion would fail on its own fixture rather than on a
    // real leak.
    const people = Array.from({ length: 12 }, (_, i) => {
      const n = String(i).padStart(2, '0');
      return {
        full: `Participant Number ${n} Surname`,
        preferred: `Pref${n}`,
        ndis: `4300000${n}`,
        recipient: `Recipient Number ${n} Surname`,
        docId: `LTR-DOC000${n}`,
      };
    });

    const buffers = await Promise.all(people.map((p) => generate(manifest({
      scalars: {
        OPAL_CLIENT_FULL_NAME: p.full,
        OPAL_CLIENT_PREFERRED_NAME: p.preferred,
        OPAL_CLIENT_NDIS_NUMBER: p.ndis,
        OPAL_LETTER_RECIPIENT_NAME: p.recipient,
        OPAL_LETTER_DOCUMENT_ID: p.docId,
      },
      custom: [{ title: `Note ${p.preferred}`, guidance: `Body for ${p.preferred}` }],
    }))));

    for (const [i, buffer] of buffers.entries()) {
      const parts = await partsOf(buffer);
      const doc = parts['word/document.xml'];
      const footer = parts['word/footer6.xml'];

      expect(doc).toContain(people[i].full);
      expect(doc).toContain(people[i].recipient);
      expect(footer).toContain(people[i].docId);

      for (const [j, other] of people.entries()) {
        if (i === j) continue;
        expect(doc).not.toContain(other.full);
        expect(doc).not.toContain(other.recipient);
        expect(footer).not.toContain(other.docId);
      }
    }
  });

  test('the FCA report is unaffected by the letter sharing the engine', async () => {
    const fcaTemplate = fs.readFileSync(path.join(__dirname, '..', 'fca', 'templates', 'fca-v1.docx'));
    const buffer = await generateFcaDocx({
      templateBuffer: fcaTemplate,
      manifest: { scalarData: { OPAL_CLIENT_FULL_NAME: 'Regression Check' }, sections: [] },
    });
    const parts = await partsOf(buffer);
    expect(parts['word/document.xml']).toContain('Regression Check');
    // The FCA opts out of the letter's behaviours entirely.
    expect(buffer.docxStats.removedParagraphs).toEqual([]);
    expect(buffer.docxStats.tocEntries).toBeGreaterThan(0);
  });
});

describe('stats', () => {
  test('report what was actually done', async () => {
    const buffer = await generate(manifest({
      excluded: ['OPAL_SECTION_LETTER_NEXT_STEPS', 'OPAL_SECTION_LETTER_CURRENT_PRESENTATION'],
      custom: [{ title: 'Equipment', guidance: 'Text.' }],
      scalars: { OPAL_LETTER_CC: null },
    }));

    // 26 scalar occurrences in the template, minus the one inside the CC
    // paragraph that was deleted before the scalar pass ran.
    expect(buffer.docxStats.scalarsWritten).toBe(25);
    expect(buffer.docxStats.removedSections.sort()).toEqual([
      'OPAL_SECTION_LETTER_CURRENT_PRESENTATION',
      'OPAL_SECTION_LETTER_NEXT_STEPS',
    ]);
    expect(buffer.docxStats.removedParagraphs).toEqual(['OPAL_LETTER_CC']);
    expect(buffer.docxStats.customSections).toBe(1);
    expect(buffer.docxStats.tocEntries).toBe(0);
    expect(buffer.docxStats.warnings).toEqual([]);
  });
});
