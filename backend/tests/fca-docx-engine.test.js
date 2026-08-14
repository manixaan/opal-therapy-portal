'use strict';

/**
 * FCA DOCX ENGINE — unit tests against the REAL shipped template.
 *
 * Nothing here is mocked. Every assertion is made by unzipping the produced
 * .docx and reading the XML, because the only thing that matters is what Word
 * actually receives.
 *
 * Covers Antony's acceptance items that live in the engine: selected optionals
 * present, unselected fully removed including headings, custom sections at the
 * anchor with the right Opal style ids, no anchor when none, repeated scalars
 * populated in the cover/body/header6/footer6 specifically, no client data
 * leaking between generation requests, the TOC reflecting selection, PAGE
 * fields intact, and the package opening without repair.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');

const { generateFcaDocx } = require('../fca/docx-engine');
const tm = require('../fca/template-map');

const TEMPLATE_PATH = path.join(__dirname, '..', 'fca', 'templates', 'fca-v1.docx');
const templateBuffer = fs.readFileSync(TEMPLATE_PATH);

// ── Helpers ──────────────────────────────────────────────────────────────────

const parse = (xml) => new DOMParser().parseFromString(xml, 'text/xml');

async function partsOf(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const out = {};
  for (const name of Object.keys(zip.files)) {
    if (/\.(xml|rels)$/.test(name)) out[name] = await zip.file(name).async('string');
  }
  out._names = Object.keys(zip.files);
  return out;
}

/** Every w:tag value in a part, with its occurrence count. */
function tagCounts(xml) {
  const counts = new Map();
  const re = /<w:tag\s+w:val="([^"]*)"/g;
  let m;
  while ((m = re.exec(xml))) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  return counts;
}

function directChildNames(el) {
  const out = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n.nodeName);
  return out;
}

/**
 * The structural invariants Word rejects a document over. This stands in for
 * "opens without repair": malformed nesting, a control without its content, or
 * pPr in the wrong position are precisely what triggers the repair dialog.
 */
function assertStructurallySound(xml, partName) {
  const doc = parse(xml);
  expect(doc.documentElement).toBeTruthy();

  for (const sdt of Array.from(doc.getElementsByTagName('w:sdt'))) {
    const names = directChildNames(sdt);
    expect(names).toContain('w:sdtPr');
    expect(names).toContain('w:sdtContent');
    // sdtPr must precede sdtContent.
    expect(names.indexOf('w:sdtPr')).toBeLessThan(names.indexOf('w:sdtContent'));

    // Deliberately NOT asserting CT_SdtPr child ordering: the shipped template
    // itself writes w:tag before w:alias, and Word opens it without complaint,
    // so that ordering is not a repair trigger and is not ours to police.
  }

  for (const p of Array.from(doc.getElementsByTagName('w:p'))) {
    const names = directChildNames(p);
    // CT_P: pPr, when present, is first.
    if (names.includes('w:pPr')) expect(names.indexOf('w:pPr')).toBe(0);
  }

  // Content-control ids must be unique or Word rebuilds them noisily.
  const ids = Array.from(doc.getElementsByTagName('w:sdtPr'))
    .map((pr) => Array.from(pr.childNodes).find((n) => n.nodeName === 'w:id'))
    .filter(Boolean)
    .map((n) => n.getAttribute('w:val'));
  expect([partName, new Set(ids).size]).toEqual([partName, ids.length]);
}

/** Text of every paragraph carrying one of the given pStyle ids. */
function paragraphTextsByStyle(xml, styleId) {
  const doc = parse(xml);
  const out = [];
  for (const p of Array.from(doc.getElementsByTagName('w:p'))) {
    const pPr = Array.from(p.childNodes).find((n) => n.nodeName === 'w:pPr');
    if (!pPr) continue;
    const st = Array.from(pPr.childNodes).find((n) => n.nodeName === 'w:pStyle');
    if (!st || st.getAttribute('w:val') !== styleId) continue;
    out.push(Array.from(p.getElementsByTagName('w:t')).map((t) => t.textContent).join('').trim());
  }
  return out;
}

/** The w:sdt whose OWN tag is `tag`, or null. */
function sdtByTag(xml, tag) {
  const doc = parse(xml);
  return Array.from(doc.getElementsByTagName('w:sdt')).find((sdt) => {
    const pr = Array.from(sdt.childNodes).find((n) => n.nodeName === 'w:sdtPr');
    if (!pr) return false;
    const t = Array.from(pr.childNodes).find((n) => n.nodeName === 'w:tag');
    return t && t.getAttribute('w:val') === tag;
  }) || null;
}

/** Every w:sdt whose OWN tag is `tag`. */
function sdtsByTag(xml, tag) {
  const doc = parse(xml);
  return Array.from(doc.getElementsByTagName('w:sdt')).filter((sdt) => {
    const pr = Array.from(sdt.childNodes).find((n) => n.nodeName === 'w:sdtPr');
    if (!pr) return false;
    const t = Array.from(pr.childNodes).find((n) => n.nodeName === 'w:tag');
    return t && t.getAttribute('w:val') === tag;
  });
}

/** The visible text a control carries. */
const sdtText = (sdt) => Array.from(sdt.getElementsByTagName('w:t'))
  .map((t) => t.textContent || '').join('');

/** A manifest with every section included and every scalar filled. */
function fullManifest(overrides = {}) {
  const excluded = new Set(overrides.exclude || []);
  const scalarData = Object.fromEntries(
    tm.SCALAR_TAG_LIST.map((t) => [t, overrides.scalarData?.[t] !== undefined ? overrides.scalarData[t] : `VAL_${t}`])
  );
  return {
    scalarData,
    excludedTags: overrides.excludedTags || [],
    sections: [
      ...tm.SECTIONS.map((s) => ({
        tag: s.tag,
        kind: s.required ? 'required' : 'optional',
        group: s.group,
        title: s.title,
        included: s.required ? true : !excluded.has(s.tag),
        order: s.defaultOrder,
      })),
      ...(overrides.customSections || []),
    ],
  };
}

// ── The template itself ──────────────────────────────────────────────────────

describe('fca-v1.docx template facts', () => {
  let doc;
  let header6;
  let footer6;

  beforeAll(async () => {
    const parts = await partsOf(templateBuffer);
    doc = parts['word/document.xml'];
    header6 = parts['word/header6.xml'];
    footer6 = parts['word/footer6.xml'];
  });

  test('carries 58 unique controls across 84 occurrences', () => {
    const all = new Map();
    for (const xml of [doc, header6, footer6]) {
      for (const [tag, n] of tagCounts(xml)) all.set(tag, (all.get(tag) || 0) + n);
    }
    expect(all.size).toBe(58);
    expect([...all.values()].reduce((a, b) => a + b, 0)).toBe(84);
  });

  test('splits into 25 section-or-anchor and 33 scalar controls', () => {
    // Discovered from the template, never hard-coded from a count elsewhere.
    const tags = [...tagCounts(doc).keys()];
    const sectionish = tags.filter((t) => t.startsWith('OPAL_SECTION_') || t.startsWith('OPAL_ANCHOR_'));
    expect(sectionish.length).toBe(25);
    expect(tm.SECTIONS.length + 1).toBe(sectionish.length);
    expect(tm.SCALAR_TAG_LIST.length).toBe(33);
  });

  test('the client tag count is discovered, not assumed', () => {
    const clientTags = tm.SCALAR_TAG_LIST.filter((t) => t.startsWith('OPAL_CLIENT_'));
    const inTemplate = [...tagCounts(doc).keys()].filter((t) => t.startsWith('OPAL_CLIENT_'));
    expect(new Set(clientTags)).toEqual(new Set(inTemplate));
    expect(clientTags.length).toBe(17);
  });

  test('header6 and footer6 carry controls a body-only build would miss', () => {
    expect([...tagCounts(header6).keys()].sort())
      .toEqual(['OPAL_CLIENT_NDIS_NUMBER', 'OPAL_CLIENT_PREFERRED_NAME']);
    expect([...tagCounts(footer6).keys()]).toEqual(['OPAL_REPORT_DOCUMENT_ID']);
  });

  test('the map\'s occurrence counts match the real document', () => {
    const all = new Map();
    for (const xml of [doc, header6, footer6]) {
      for (const [tag, n] of tagCounts(xml)) all.set(tag, (all.get(tag) || 0) + n);
    }
    for (const meta of tm.SCALAR_TAGS) {
      expect([meta.tag, all.get(meta.tag)]).toEqual([meta.tag, meta.occurrences]);
    }
    // 15 scalar tags repeat, the most repeated 5 times.
    const repeats = tm.SCALAR_TAGS.filter((s) => s.occurrences > 1);
    expect(repeats.length).toBe(15);
    expect(Math.max(...repeats.map((s) => s.occurrences))).toBe(5);
  });

  test('style ids use an en dash with no spaces', () => {
    expect(tm.STYLE.BODY).toBe('OPAL–Body');
    expect(tm.STYLE.HEADING2).toBe('OPAL–Heading2');
    expect(tm.STYLE.PLACEHOLDER).toBe('OPAL–Placeholder');
  });

  test('optional controls really are nested inside required parents', () => {
    // If they were siblings, a naive removal would still pass; this is the
    // fact that makes nesting-aware deletion mandatory.
    const parsed = parse(doc);
    const byTag = new Map();
    for (const sdt of Array.from(parsed.getElementsByTagName('w:sdt'))) {
      const pr = Array.from(sdt.childNodes).find((n) => n.nodeName === 'w:sdtPr');
      const tag = pr && Array.from(pr.childNodes).find((n) => n.nodeName === 'w:tag');
      if (tag) byTag.set(tag.getAttribute('w:val'), sdt);
    }
    const parentOf = (tag) => {
      let n = byTag.get(tag)?.parentNode;
      while (n) {
        if (n.nodeName === 'w:sdt') {
          const pr = Array.from(n.childNodes).find((c) => c.nodeName === 'w:sdtPr');
          const t = pr && Array.from(pr.childNodes).find((c) => c.nodeName === 'w:tag');
          if (t) return t.getAttribute('w:val');
        }
        n = n.parentNode;
      }
      return null;
    };
    expect(parentOf('OPAL_SECTION_ASSESSMENT_TOOL_MOCA')).toBe('OPAL_SECTION_ASSESSMENT_METHOD');
    expect(parentOf('OPAL_SECTION_DOMAIN_MOBILITY')).toBe('OPAL_SECTION_ASSESSMENT_RESULTS');
    expect(parentOf(tm.CUSTOM_SECTION_ANCHOR)).toBe('OPAL_SECTION_ASSESSMENT_RESULTS');
    expect(parentOf('OPAL_SECTION_RECOMMENDATION_CORE_SUPPORTS')).toBe('OPAL_SECTION_SUMMARY_RECOMMENDATIONS');
    expect(parentOf('OPAL_SECTION_APPENDICES')).toBeNull(); // optional AND top-level
  });

  test('the real TOC field and updateFields are present', async () => {
    const parts = await partsOf(templateBuffer);
    expect(doc).toMatch(/TOC \\o "1-3"/);
    expect(parts['word/settings.xml']).toContain('w:updateFields');
  });
});

// ── Scalars ──────────────────────────────────────────────────────────────────

describe('scalar population', () => {
  test('fills every occurrence in the body, header6 AND footer6', async () => {
    const buffer = await generateFcaDocx({ templateBuffer, manifest: fullManifest() });
    const parts = await partsOf(buffer);

    // A repeated tag: 5 occurrences, all populated, none left as placeholder.
    const therapistName = 'VAL_OPAL_THERAPIST_FULL_NAME';
    const bodyHits = parts['word/document.xml'].split(therapistName).length - 1;
    expect(bodyHits).toBe(5);

    // header6 — the part a body-only implementation would ship blank.
    expect(parts['word/header6.xml']).toContain('VAL_OPAL_CLIENT_PREFERRED_NAME');
    expect(parts['word/header6.xml']).toContain('VAL_OPAL_CLIENT_NDIS_NUMBER');

    // footer6 — the document id.
    expect(parts['word/footer6.xml']).toContain('VAL_OPAL_REPORT_DOCUMENT_ID');

    // The client name has 3 controls, and the cover-page one is a heading — so
    // the rebuilt TOC carries the participant's real name as a fourth
    // occurrence rather than the template's "[PORTAL — CLIENT NAME]" placeholder.
    expect(parts['word/document.xml'].split('VAL_OPAL_CLIENT_FULL_NAME').length - 1).toBe(4);
    // The NDIS number is not in a heading: 4 occurrences, 1 of them in header6.
    expect(parts['word/document.xml'].split('VAL_OPAL_CLIENT_NDIS_NUMBER').length - 1).toBe(3);

    expect(buffer.fcaStats.scalarsWritten).toBe(59); // 84 − 25 section/anchor controls
  });

  test('a null value leaves the template placeholder and never prints "null"', async () => {
    const manifest = fullManifest({
      scalarData: { OPAL_CLIENT_PRONOUNS: null, OPAL_CLIENT_DATE_OF_BIRTH: null },
    });
    const buffer = await generateFcaDocx({ templateBuffer, manifest });
    const parts = await partsOf(buffer);
    const body = parts['word/document.xml'];

    expect(body).not.toMatch(/>null</);
    expect(body).not.toMatch(/>undefined</);
    // The control survives, so the therapist still sees an outstanding field.
    expect(body).toContain('OPAL_CLIENT_PRONOUNS');
    expect(body).not.toContain('VAL_OPAL_CLIENT_PRONOUNS');
  });

  test('run properties are preserved', async () => {
    const buffer = await generateFcaDocx({ templateBuffer, manifest: fullManifest() });
    const parts = await partsOf(buffer);
    // The header control's run keeps its exact rPr (Arial, colour, size).
    expect(parts['word/header6.xml']).toMatch(
      /<w:rPr>[\s\S]*?w:ascii="Arial"[\s\S]*?<\/w:rPr><w:t[^>]*>VAL_OPAL_CLIENT_NDIS_NUMBER<\/w:t>/
    );
  });

  test('text outside content controls is never touched', async () => {
    const buffer = await generateFcaDocx({ templateBuffer, manifest: fullManifest() });
    const parts = await partsOf(buffer);
    // A static prose line from the template survives verbatim.
    expect(parts['word/document.xml']).toContain('DELETE OR REPLACE BEFORE ISSUE');
  });

  test('no client data leaks between generation requests', async () => {
    // The same template buffer is reused for both calls — if the engine mutated
    // shared state, the second document would carry the first client's data.
    const first = await generateFcaDocx({
      templateBuffer,
      manifest: fullManifest({ scalarData: { OPAL_CLIENT_FULL_NAME: 'Alice Alpha', OPAL_CLIENT_NDIS_NUMBER: '111111111' } }),
    });
    const second = await generateFcaDocx({
      templateBuffer,
      manifest: fullManifest({ scalarData: { OPAL_CLIENT_FULL_NAME: 'Bob Bravo', OPAL_CLIENT_NDIS_NUMBER: '222222222' } }),
    });

    const a = await partsOf(first);
    const b = await partsOf(second);

    for (const part of ['word/document.xml', 'word/header6.xml']) {
      expect(b[part]).not.toContain('Alice Alpha');
      expect(b[part]).not.toContain('111111111');
      expect(a[part]).not.toContain('Bob Bravo');
      expect(a[part]).not.toContain('222222222');
    }
    expect(a['word/document.xml']).toContain('Alice Alpha');
    expect(b['word/document.xml']).toContain('Bob Bravo');

    // And the template on disk is untouched.
    expect(fs.readFileSync(TEMPLATE_PATH).equals(templateBuffer)).toBe(true);
  });
});

// ── Excluded fields ──────────────────────────────────────────────────────────

describe('excluded scalars', () => {
  test('an excluded control is EMPTY — no value, and no "[PORTAL" placeholder', async () => {
    const buffer = await generateFcaDocx({
      templateBuffer,
      manifest: fullManifest({ excludedTags: ['OPAL_REPORT_REVIEWER_NAME'] }),
    });
    const body = (await partsOf(buffer))['word/document.xml'];

    const sdt = sdtByTag(body, 'OPAL_REPORT_REVIEWER_NAME');
    // The control is still there — the therapist can type into it in Word.
    expect(sdt).toBeTruthy();
    expect(sdtText(sdt)).toBe('');
    // And it carries neither the resolved value nor the template placeholder.
    expect(sdtText(sdt)).not.toContain('VAL_OPAL_REPORT_REVIEWER_NAME');
    expect(sdtText(sdt)).not.toContain('[PORTAL');
    expect(body).not.toContain('[PORTAL — REVIEWER NAME]');
  });

  test('exclusion beats a resolved value — the therapist has the last word', async () => {
    const body = (await partsOf(await generateFcaDocx({
      templateBuffer,
      manifest: fullManifest({
        scalarData: { OPAL_REPORT_AUTHORISED_RECIPIENTS: 'A real value that must not ship' },
        excludedTags: ['OPAL_REPORT_AUTHORISED_RECIPIENTS'],
      }),
    })))['word/document.xml'];

    expect(body).not.toContain('A real value that must not ship');
    expect(body).not.toContain('[PORTAL — AUTHORISED REPORT RECIPIENTS]');
    expect(sdtText(sdtByTag(body, 'OPAL_REPORT_AUTHORISED_RECIPIENTS'))).toBe('');
  });

  test('EVERY occurrence of an excluded tag is emptied, in every part', async () => {
    // OPAL_REPORT_DOCUMENT_ID has 3 occurrences, one of them in footer6.
    const parts = await partsOf(await generateFcaDocx({
      templateBuffer,
      manifest: fullManifest({ excludedTags: ['OPAL_REPORT_DOCUMENT_ID'] }),
    }));

    for (const part of ['word/document.xml', 'word/footer6.xml']) {
      expect(parts[part]).not.toContain('VAL_OPAL_REPORT_DOCUMENT_ID');
      expect(parts[part]).not.toContain('[PORTAL — REPORT ID]');
      for (const sdt of sdtsByTag(parts[part], 'OPAL_REPORT_DOCUMENT_ID')) {
        expect(sdtText(sdt)).toBe('');
      }
    }
    // The control survives in the footer, beside its untouched PAGE field.
    expect(parts['word/footer6.xml']).toContain('OPAL_REPORT_DOCUMENT_ID');
    expect(sdtsByTag(parts['word/footer6.xml'], 'OPAL_REPORT_DOCUMENT_ID')).toHaveLength(1);
  });

  test('excluding one field changes nothing about any other', async () => {
    const body = (await partsOf(await generateFcaDocx({
      templateBuffer,
      manifest: fullManifest({ excludedTags: ['OPAL_REPORT_REVIEWER_NAME'] }),
    })))['word/document.xml'];

    expect(body).toContain('VAL_OPAL_REPORT_REVIEWER_ROLE');
    expect(body).toContain('VAL_OPAL_CLIENT_FULL_NAME');
    expect(body).toContain('VAL_OPAL_THERAPIST_FULL_NAME');
  });

  test('a NON-excluded null still leaves the template placeholder — no regression', async () => {
    // This is the distinction the whole feature turns on: "we could not find
    // this" is a visible prompt to finish in Word; "exclude this" is not.
    const body = (await partsOf(await generateFcaDocx({
      templateBuffer,
      manifest: fullManifest({
        scalarData: { OPAL_REPORT_REVIEWER_NAME: null, OPAL_REPORT_REVIEWER_ROLE: null },
        excludedTags: ['OPAL_REPORT_REVIEWER_ROLE'],
      }),
    })))['word/document.xml'];

    expect(body).toContain('[PORTAL — REVIEWER NAME]');       // blank: placeholder kept
    expect(body).not.toContain('[PORTAL — REVIEWER ROLE]');   // excluded: nothing at all
    expect(sdtText(sdtByTag(body, 'OPAL_REPORT_REVIEWER_NAME'))).toContain('[PORTAL');
    expect(sdtText(sdtByTag(body, 'OPAL_REPORT_REVIEWER_ROLE'))).toBe('');
  });

  test('an excluded control no longer shows Word its own placeholder', async () => {
    const body = (await partsOf(await generateFcaDocx({
      templateBuffer,
      manifest: fullManifest({ excludedTags: ['OPAL_REPORT_REVIEWER_NAME'] }),
    })))['word/document.xml'];

    const sdt = sdtByTag(body, 'OPAL_REPORT_REVIEWER_NAME');
    const pr = Array.from(sdt.childNodes).find((n) => n.nodeName === 'w:sdtPr');
    expect(Array.from(pr.childNodes).some((n) => n.nodeName === 'w:showingPlcHdr')).toBe(false);
  });

  test('the package stays valid and the stats say what happened', async () => {
    const buffer = await generateFcaDocx({
      templateBuffer,
      manifest: fullManifest({ excludedTags: ['OPAL_REPORT_REVIEWER_NAME', 'OPAL_REPORT_STATUS'] }),
    });
    const parts = await partsOf(buffer);
    assertStructurallySound(parts['word/document.xml'], 'word/document.xml');
    expect(buffer.fcaStats.warnings).toEqual([]);
    // The FCA template declares no optional-line tags, so every exclusion here
    // is an emptied control and no paragraph is removed.
    expect(buffer.fcaStats.excludedTags.sort())
      .toEqual(['OPAL_REPORT_REVIEWER_NAME', 'OPAL_REPORT_STATUS']);
    expect(buffer.fcaStats.excludedAsEmptyControl.sort())
      .toEqual(['OPAL_REPORT_REVIEWER_NAME', 'OPAL_REPORT_STATUS']);
    expect(buffer.fcaStats.excludedAsRemovedLine).toEqual([]);
    expect(buffer.fcaStats.removedParagraphs).toEqual([]);
  });

  test('a manifest with no excludedTags behaves exactly as before', async () => {
    const withField = await generateFcaDocx({ templateBuffer, manifest: fullManifest({ excludedTags: [] }) });
    const noField = await generateFcaDocx({
      templateBuffer,
      // The field absent entirely, as an older frozen snapshot would have it.
      manifest: (() => { const m = fullManifest(); delete m.excludedTags; return m; })(),
    });
    expect(withField.fcaStats.scalarsWritten).toBe(noField.fcaStats.scalarsWritten);
    expect((await partsOf(withField))['word/document.xml'])
      .toBe((await partsOf(noField))['word/document.xml']);
  });
});

// ── Sections ─────────────────────────────────────────────────────────────────

describe('section selection', () => {
  test('selected optional sections are present', async () => {
    const buffer = await generateFcaDocx({ templateBuffer, manifest: fullManifest() });
    const parts = await partsOf(buffer);
    for (const tag of tm.OPTIONAL_SECTION_TAGS) {
      expect([tag, parts['word/document.xml'].includes(tag)]).toEqual([tag, true]);
    }
  });

  test('unselected optional sections are removed entirely, headings included', async () => {
    const exclude = [
      'OPAL_SECTION_ASSESSMENT_TOOL_MOCA',
      'OPAL_SECTION_DOMAIN_BEHAVIOURS_OF_CONCERN',
      'OPAL_SECTION_APPENDICES',
    ];
    const buffer = await generateFcaDocx({ templateBuffer, manifest: fullManifest({ exclude }) });
    const body = (await partsOf(buffer))['word/document.xml'];

    for (const tag of exclude) expect(body).not.toContain(tag);

    // The headings go with them — not just the control wrapper.
    const headings = [
      ...paragraphTextsByStyle(body, tm.STYLE.HEADING1),
      ...paragraphTextsByStyle(body, tm.STYLE.HEADING2),
    ];
    expect(headings).not.toContain('Montreal Cognitive Assessment (MoCA)');
    expect(headings).not.toContain('Behaviours of Concern');
    expect(headings).not.toContain('Appendices');
  });

  test('removing every nested optional leaves its required parent intact', async () => {
    // The nesting trap: MoCA et al. live INSIDE Assessment Method, and the nine
    // domains live INSIDE Assessment Results. A descendant-matching removal
    // would take the parents — and most of the report — with them.
    const exclude = tm.OPTIONAL_SECTION_TAGS.slice();
    const buffer = await generateFcaDocx({ templateBuffer, manifest: fullManifest({ exclude }) });
    const body = (await partsOf(buffer))['word/document.xml'];

    for (const tag of tm.REQUIRED_SECTION_TAGS) {
      expect([tag, body.includes(tag)]).toEqual([tag, true]);
    }
    for (const tag of tm.OPTIONAL_SECTION_TAGS) expect(body).not.toContain(tag);

    const headings = paragraphTextsByStyle(body, tm.STYLE.HEADING1);
    expect(headings).toEqual(expect.arrayContaining([
      'Assessment Method', 'Summary and Recommendations', 'Professional Declaration',
    ]));

    assertStructurallySound(body, 'word/document.xml');
  });

  test('a required section cannot be removed by asking', async () => {
    const manifest = fullManifest();
    for (const s of manifest.sections) {
      if (s.kind === 'required') s.included = false; // the engine renders the manifest…
    }
    // …so the guarantee is enforced when the manifest is BUILT, not here. This
    // test documents that the engine is a renderer: see
    // fca-resolve-scalars.test.js for the server-side rule that required
    // sections are always included.
    const built = require('../fca/manifest').buildManifest({
      selectedSections: [], sectionOrder: [], customSections: [],
    });
    for (const s of built.sections.filter((x) => x.kind === 'required')) {
      expect(s.included).toBe(true);
    }
  });
});

// ── Custom sections ──────────────────────────────────────────────────────────

describe('custom sections', () => {
  const custom = [
    {
      tag: 'OPAL_SECTION_CUSTOM_FATIGUE_AND_DAILY_ROUTINES_ABC123',
      kind: 'custom',
      title: 'Fatigue and Daily Routines',
      guidance: 'Describe fatigue patterns across a typical week.',
      included: true,
      order: 0,
    },
    {
      tag: 'OPAL_SECTION_CUSTOM_SENSORY_PROFILE_DEF456',
      kind: 'custom',
      title: 'Sensory Profile',
      guidance: null,
      included: true,
      order: 1,
    },
  ];

  test('replace the anchor, in order, with the correct Opal style ids', async () => {
    const buffer = await generateFcaDocx({
      templateBuffer, manifest: fullManifest({ customSections: custom }),
    });
    const body = (await partsOf(buffer))['word/document.xml'];

    expect(body).not.toContain(tm.CUSTOM_SECTION_ANCHOR);
    expect(body).toContain('OPAL_SECTION_CUSTOM_FATIGUE_AND_DAILY_ROUTINES_ABC123');
    expect(body).toContain('OPAL_SECTION_CUSTOM_SENSORY_PROFILE_DEF456');

    const h2 = paragraphTextsByStyle(body, tm.STYLE.HEADING2);
    expect(h2).toContain('Fatigue and Daily Routines');
    expect(h2).toContain('Sensory Profile');
    expect(h2.indexOf('Fatigue and Daily Routines')).toBeLessThan(h2.indexOf('Sensory Profile'));

    // Guidance uses the placeholder style; a section without guidance gets none.
    expect(paragraphTextsByStyle(body, tm.STYLE.PLACEHOLDER))
      .toContain('Describe fatigue patterns across a typical week.');

    // The heading declares a real outline level so it reaches the TOC.
    expect(body).toMatch(
      new RegExp(`<w:pStyle w:val="${tm.STYLE.HEADING2}"/><w:outlineLvl w:val="1"/>`)
    );

    assertStructurallySound(body, 'word/document.xml');
  });

  test('with no custom sections the anchor is removed entirely', async () => {
    const buffer = await generateFcaDocx({ templateBuffer, manifest: fullManifest() });
    const body = (await partsOf(buffer))['word/document.xml'];
    expect(body).not.toContain(tm.CUSTOM_SECTION_ANCHOR);
    expect(body).not.toContain('PORTAL COMPOSITION ANCHOR');
  });

  test('generated control ids never collide with the template\'s', async () => {
    const buffer = await generateFcaDocx({
      templateBuffer, manifest: fullManifest({ customSections: custom }),
    });
    assertStructurallySound((await partsOf(buffer))['word/document.xml'], 'word/document.xml');
  });
});

// ── TOC, page fields, package integrity ──────────────────────────────────────

describe('table of contents', () => {
  test('reflects the selection and includes custom headings', async () => {
    const exclude = ['OPAL_SECTION_ASSESSMENT_TOOL_MOCA', 'OPAL_SECTION_APPENDICES'];
    const customSections = [{
      tag: 'OPAL_SECTION_CUSTOM_FATIGUE_ABC', kind: 'custom',
      title: 'Fatigue and Daily Routines', guidance: null, included: true, order: 0,
    }];
    const buffer = await generateFcaDocx({
      templateBuffer, manifest: fullManifest({ exclude, customSections }),
    });
    const body = (await partsOf(buffer))['word/document.xml'];

    const tocEntries = [
      ...paragraphTextsByStyle(body, 'TOC1'),
      ...paragraphTextsByStyle(body, 'TOC2'),
      ...paragraphTextsByStyle(body, 'TOC3'),
    ];

    expect(tocEntries).toContain('Fatigue and Daily Routines');
    expect(tocEntries).toContain('Participant Details');
    expect(tocEntries).not.toContain('Montreal Cognitive Assessment (MoCA)');
    expect(tocEntries).not.toContain('Appendices');
  });

  test('the real field and updateFields survive so Word repaginates on open', async () => {
    const buffer = await generateFcaDocx({ templateBuffer, manifest: fullManifest() });
    const parts = await partsOf(buffer);
    expect(parts['word/document.xml']).toMatch(/TOC \\o "1-3"/);
    expect(parts['word/document.xml']).toContain('w:fldCharType="begin"');
    expect(parts['word/document.xml']).toContain('w:fldCharType="separate"');
    expect(parts['word/document.xml']).toContain('w:fldCharType="end"');
    expect(parts['word/settings.xml']).toContain('w:updateFields');
  });

  test('the cached entries carry no invented page numbers', async () => {
    // Pagination is a Word layout problem. A plausible-looking wrong number in
    // a clinical report is worse than an empty one that Word fills on open.
    const buffer = await generateFcaDocx({ templateBuffer, manifest: fullManifest() });
    const body = (await partsOf(buffer))['word/document.xml'];
    const doc = parse(body);

    for (const p of Array.from(doc.getElementsByTagName('w:p'))) {
      const pPr = Array.from(p.childNodes).find((n) => n.nodeName === 'w:pPr');
      const st = pPr && Array.from(pPr.childNodes).find((n) => n.nodeName === 'w:pStyle');
      if (!st || !/^TOC[123]$/.test(st.getAttribute('w:val'))) continue;
      const texts = Array.from(p.getElementsByTagName('w:t')).map((t) => t.textContent);
      // Only the first text node (the title) carries content.
      expect(texts.slice(1).join('')).toBe('');
    }
  });
});

describe('package integrity', () => {
  test('footer PAGE and NUMPAGES fields are untouched', async () => {
    const before = await partsOf(templateBuffer);
    const buffer = await generateFcaDocx({ templateBuffer, manifest: fullManifest() });
    const after = await partsOf(buffer);

    for (const name of Object.keys(before).filter((n) => /^word\/footer\d*\.xml$/.test(n))) {
      const count = (xml, re) => (xml.match(re) || []).length;
      expect(count(after[name], /\bPAGE\b/g)).toBe(count(before[name], /\bPAGE\b/g));
      expect(count(after[name], /\bNUMPAGES\b/g)).toBe(count(before[name], /\bNUMPAGES\b/g));
    }
  });

  test('every part survives and every modified part is well-formed', async () => {
    const before = await partsOf(templateBuffer);
    const buffer = await generateFcaDocx({ templateBuffer, manifest: fullManifest() });
    const after = await partsOf(buffer);

    expect(new Set(after._names)).toEqual(new Set(before._names));
    for (const name of ['word/document.xml', 'word/header6.xml', 'word/footer6.xml']) {
      assertStructurallySound(after[name], name);
    }
  });

  test('no relationship id is left dangling', async () => {
    const buffer = await generateFcaDocx({ templateBuffer, manifest: fullManifest() });
    const parts = await partsOf(buffer);
    const defined = new Set();
    const re = /\sId="([^"]+)"/g;
    let m;
    while ((m = re.exec(parts['word/_rels/document.xml.rels']))) defined.add(m[1]);

    const referenced = new Set();
    const rre = /\sr:(?:id|embed)="([^"]+)"/g;
    while ((m = rre.exec(parts['word/document.xml']))) referenced.add(m[1]);

    for (const id of referenced) expect(defined).toContain(id);
  });

  test('a corrupt template is refused with a descriptive error', async () => {
    await expect(generateFcaDocx({
      templateBuffer: Buffer.from('not a docx'), manifest: fullManifest(),
    })).rejects.toThrow(/not a readable \.docx/);
  });

  test('a missing manifest is refused', async () => {
    await expect(generateFcaDocx({ templateBuffer })).rejects.toThrow(/manifest is required/);
  });
});

// ── The named acceptance scenario ────────────────────────────────────────────

describe('acceptance scenario: five sections out, one custom section in', () => {
  let body;
  let buffer;

  beforeAll(async () => {
    const exclude = [
      'OPAL_SECTION_ASSESSMENT_TOOL_MOCA',
      'OPAL_SECTION_ASSESSMENT_TOOL_CANS',
      'OPAL_SECTION_DOMAIN_BEHAVIOURS_OF_CONCERN',
      'OPAL_SECTION_DOMAIN_HOME_MODIFICATIONS_AT',
      'OPAL_SECTION_APPENDICES',
    ];
    const customSections = [{
      tag: 'OPAL_SECTION_CUSTOM_FATIGUE_AND_DAILY_ROUTINES_9F1C',
      kind: 'custom',
      title: 'Fatigue and Daily Routines',
      guidance: 'Describe fatigue across a typical week and its effect on routine.',
      included: true,
      order: 0,
    }];
    const scalarData = {
      OPAL_CLIENT_FULL_NAME: 'Jane Sample',
      OPAL_CLIENT_PREFERRED_NAME: 'Janey',
      OPAL_CLIENT_NDIS_NUMBER: '430000001',
      OPAL_THERAPIST_FULL_NAME: 'Sam Therapist',
      OPAL_REPORT_DOCUMENT_ID: 'FCA-0001',
    };
    buffer = await generateFcaDocx({
      templateBuffer, manifest: fullManifest({ exclude, customSections, scalarData }),
    });
    body = (await partsOf(buffer))['word/document.xml'];
  });

  test('the package is valid and structurally sound', () => {
    expect(buffer.length).toBeGreaterThan(10000);
    assertStructurallySound(body, 'word/document.xml');
    expect(buffer.fcaStats.warnings).toEqual([]);
  });

  test('all five deselected sections are absent', () => {
    for (const tag of [
      'OPAL_SECTION_ASSESSMENT_TOOL_MOCA',
      'OPAL_SECTION_ASSESSMENT_TOOL_CANS',
      'OPAL_SECTION_DOMAIN_BEHAVIOURS_OF_CONCERN',
      'OPAL_SECTION_DOMAIN_HOME_MODIFICATIONS_AT',
      'OPAL_SECTION_APPENDICES',
    ]) expect(body).not.toContain(tag);

    const headings = [
      ...paragraphTextsByStyle(body, tm.STYLE.HEADING1),
      ...paragraphTextsByStyle(body, tm.STYLE.HEADING2),
    ];
    expect(headings).not.toContain('Montreal Cognitive Assessment (MoCA)');
    expect(headings).not.toContain('Care and Needs Scale (CANS)');
    expect(headings).not.toContain('Behaviours of Concern');
    expect(headings).not.toContain('Home Modifications and Assistive Technology');
    expect(headings).not.toContain('Appendices');
  });

  test('the custom heading is present and styled OPAL–Heading2', () => {
    expect(paragraphTextsByStyle(body, tm.STYLE.HEADING2)).toContain('Fatigue and Daily Routines');
  });

  test('the required parents of the removed sections are intact', () => {
    expect(body).toContain('OPAL_SECTION_ASSESSMENT_METHOD');
    expect(body).toContain('OPAL_SECTION_ASSESSMENT_RESULTS');
    expect(body).toContain('OPAL_SECTION_SUMMARY_RECOMMENDATIONS');
    expect(body).toContain('OPAL_SECTION_PROFESSIONAL_DECLARATION');
    // The optional siblings that WERE selected survive alongside them.
    expect(body).toContain('OPAL_SECTION_ASSESSMENT_TOOL_WHODAS');
    expect(body).toContain('OPAL_SECTION_DOMAIN_MOBILITY');
  });

  test('the prefilled sample data is rendered everywhere it appears', async () => {
    const parts = await partsOf(buffer);
    // 3 controls + the rebuilt TOC entry for the cover-page heading.
    expect(body.split('Jane Sample').length - 1).toBe(4);
    expect(body.split('Sam Therapist').length - 1).toBe(5);
    expect(parts['word/header6.xml']).toContain('Janey');
    expect(parts['word/header6.xml']).toContain('430000001');
    expect(parts['word/footer6.xml']).toContain('FCA-0001');
  });
});
