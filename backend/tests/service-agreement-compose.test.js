'use strict';

/**
 * SERVICE AGREEMENT — MANIFEST AND DOCUMENT COMPOSITION
 *
 * What this suite protects: the bytes that reach a participant.
 *
 * Three promises are made about every issued agreement, and all three are made
 * good here rather than by inspection:
 *
 *   1. Nothing internal escapes. No "[PORTAL — …]", no raw OPAL_ tag, no owner
 *      governance block. A participant reads a contract, not Opal's drafting
 *      notes.
 *   2. A blank stays blank AND stays editable. A field the practice could not
 *      fill is a question for the participant, so deleting it would be as
 *      wrong as leaving a placeholder in it.
 *   3. The prices are right. An agreement is a price list, and floating-point
 *      arithmetic is not safe for one — 0.1 + 0.2 is famously not 0.3, and a
 *      cent of drift in a contract is a wrong number.
 *
 * The authority tests are the security half: a signature, an ABN or an
 * agreement reference arriving in the ordinary form bag must be IGNORED, not
 * written, whatever the browser sent.
 */

const fs = require('fs');
const { randomUUID } = require('crypto');
const JSZip = require('jszip');

const map = require('../service-agreements/template-map');
const {
  composeAgreementManifest, toCents, money, estimatedTotalCents, asDate, matchChoice,
} = require('../service-agreements/manifest');
const {
  generateAgreementDocx, assertNoForbiddenTokens, joinedText,
} = require('../service-agreements/docx');

const SEED = fs.readFileSync(map.SEED_TEMPLATE_FILE);

const SUPPORT = (over = {}) => ({
  OPAL_SUPPORT_ITEM_NUMBER: '15_056_0128_1_3',
  OPAL_SUPPORT_DESCRIPTION: 'Occupational therapy assessment',
  OPAL_SUPPORT_DELIVERY_METHOD: 'In person',
  OPAL_SUPPORT_FREQUENCY: 'Fortnightly',
  OPAL_SUPPORT_RATE: '193.99',
  OPAL_SUPPORT_ESTIMATED_QUANTITY: '12',
  ...over,
});

function manifestFor(over = {}) {
  return composeAgreementManifest({
    formData: {},
    supports: [],
    serverValues: {},
    organisation: {},
    clauseSnapshot: {},
    blankStyle: 'empty',
    audience: 'participant',
    ...over,
  });
}

async function compose(over = {}, audience = 'participant') {
  const manifest = manifestFor({ ...over, audience });
  const docx = await generateAgreementDocx({ templateBuffer: SEED, manifest, audience });
  const zip = await JSZip.loadAsync(docx);
  const xml = await zip.file('word/document.xml').async('string');
  return { manifest, docx, zip, xml, text: joinedText(xml) };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('the manifest gives every field a value, always', () => {
  it('writes a string for all 83 scalars even with no input at all', () => {
    const m = manifestFor();
    for (const tag of map.SCALAR_TAGS) {
      expect(typeof m.scalarData[tag]).toBe('string');
    }
    // With nothing supplied, everything is blank — and recorded as blank.
    expect(m.blanks).toHaveLength(83);
  });

  it("uses '' for a blank in an issued copy", () => {
    const m = manifestFor({ blankStyle: 'empty' });
    expect(m.scalarData.OPAL_PARTICIPANT_FULL_NAME).toBe('');
  });

  it('uses the human-readable prompt in a manual Word copy', () => {
    const m = manifestFor({ blankStyle: 'prompt' });
    expect(m.scalarData.OPAL_PARTICIPANT_FULL_NAME).toBe('Enter participant full name');
    // And never the template's own bracketed placeholder.
    for (const tag of map.SCALAR_TAGS) {
      for (const pattern of map.FORBIDDEN_TEXT_PATTERNS) {
        expect(m.scalarData[tag]).not.toMatch(pattern.re);
      }
    }
  });
});

describe('field authority is enforced, not trusted', () => {
  it('ignores a signature that arrives in the ordinary form bag', () => {
    const m = manifestFor({
      formData: { OPAL_PARTICIPANT_SIGNATURE: 'Mallory', OPAL_PARTICIPANT_SIGNED_DATE: '01/01/2020' },
    });
    expect(m.scalarData.OPAL_PARTICIPANT_SIGNATURE).toBe('');
    expect(m.scalarData.OPAL_PARTICIPANT_SIGNED_DATE).toBe('');
  });

  it('writes a signature only when it comes from the signing path', () => {
    const m = manifestFor({
      signatures: { OPAL_PARTICIPANT_SIGNATURE: 'Jordan Whitlock' },
    });
    expect(m.scalarData.OPAL_PARTICIPANT_SIGNATURE).toBe('Jordan Whitlock');
    expect(m.sources.OPAL_PARTICIPANT_SIGNATURE).toBe('esign');
  });

  it('ignores an ABN posted as ordinary form data', () => {
    const m = manifestFor({
      formData: { OPAL_ORG_ABN: '00 000 000 000' },
      organisation: { OPAL_ORG_ABN: '51 824 753 556' },
    });
    expect(m.scalarData.OPAL_ORG_ABN).toBe('51 824 753 556');
  });

  it('ignores an agreement reference posted as ordinary form data', () => {
    const m = manifestFor({
      formData: { OPAL_AGREEMENT_ID: 'SVA-FORGED1' },
      serverValues: { OPAL_AGREEMENT_ID: 'SVA-1A2B3C4D' },
    });
    expect(m.scalarData.OPAL_AGREEMENT_ID).toBe('SVA-1A2B3C4D');
  });
});

describe('money is decimal-safe', () => {
  it('parses and formats without floating-point drift', () => {
    expect(toCents('193.99')).toBe(19399);
    expect(toCents('$1,234.50')).toBe(123450);
    expect(toCents('')).toBeNull();
    expect(toCents('as needed')).toBeNull();
    expect(money(232788)).toBe('$2,327.88');
    expect(money(123450)).toBe('$1,234.50');
  });

  it('multiplies a rate by a quantity exactly', () => {
    expect(estimatedTotalCents('193.99', 12)).toBe(232788);
    // The naive float route gives 2327.8799999999997.
    expect(money(estimatedTotalCents('193.99', 12))).toBe('$2,327.88');
    expect(estimatedTotalCents('0.10', 3)).toBe(30);
  });

  it('sums three supports to the cent', () => {
    const m = manifestFor({
      supports: [
        SUPPORT({ OPAL_SUPPORT_ESTIMATED_QUANTITY: '12' }),
        SUPPORT({ OPAL_SUPPORT_ESTIMATED_QUANTITY: '4' }),
        SUPPORT({ OPAL_SUPPORT_ESTIMATED_QUANTITY: '6' }),
      ],
    });
    expect(m.supports.map((s) => s.OPAL_SUPPORT_ESTIMATED_TOTAL))
      .toEqual(['$2,327.88', '$775.96', '$1,163.94']);
    expect(m.supportTotals.display).toBe('$4,267.78');
    expect(m.supportTotals.cents).toBe(426778);
    expect(m.supportTotals.uncounted).toBe(0);
  });

  it('leaves a total blank rather than claiming $0.00 when it cannot be computed', () => {
    const m = manifestFor({
      supports: [SUPPORT({ OPAL_SUPPORT_ESTIMATED_QUANTITY: 'as needed' })],
    });
    expect(m.supports[0].OPAL_SUPPORT_ESTIMATED_TOTAL).toBeNull();
    expect(m.supportTotals.display).toBe('');
    expect(m.supportTotals.uncounted).toBe(1);
  });

  it('never overwrites a total somebody typed', () => {
    const m = manifestFor({
      supports: [SUPPORT({ OPAL_SUPPORT_ESTIMATED_TOTAL: '2000.00' })],
    });
    // A negotiated total is an authority; rate x quantity is only an estimate.
    expect(m.supports[0].OPAL_SUPPORT_ESTIMATED_TOTAL).toBe('2000.00');
  });
});

describe('dates and choices are normalised', () => {
  it('renders dates as DD/MM/YYYY', () => {
    expect(asDate('2026-09-01')).toBe('01/09/2026');
    expect(asDate('01/09/2026')).toBe('01/09/2026');
    expect(asDate('')).toBe('');
  });

  it('accepts a consent however it was capitalised', () => {
    const warnings = [];
    expect(matchChoice('yes', map.CHOICES.YES_NO_DISCUSS, 'T', warnings)).toBe('Yes');
    expect(matchChoice('PLAN MANAGED', map.CHOICES.FUNDING, 'T', warnings)).toBe('Plan managed');
    expect(warnings).toHaveLength(0);
  });

  it('keeps an unrecognised answer verbatim rather than discarding it', () => {
    const warnings = [];
    const out = matchChoice('Only with my sister present', map.CHOICES.YES_NO_DISCUSS, 'T', warnings);
    expect(out).toBe('Only with my sister present');
    expect(warnings).toHaveLength(1);
  });
});

describe('clause selection', () => {
  it('includes every clause when the snapshot says nothing', () => {
    const m = manifestFor({ clauseSnapshot: {} });
    for (const tag of map.CLAUSE_TAGS) {
      expect(m.sections.find((s) => s.tag === tag).included).toBe(true);
    }
  });

  it('honours an optional clause being switched off', () => {
    const m = manifestFor({
      clauseSnapshot: { clauses: [{ tag: 'OPAL_CLAUSE_CONFLICTS', enabled: false }] },
    });
    expect(m.sections.find((s) => s.tag === 'OPAL_CLAUSE_CONFLICTS').included).toBe(false);
  });

  it('overrules a snapshot that tries to switch off a REQUIRED clause', () => {
    // A snapshot is data that has been sitting in a database. The renderer is
    // the last place that can refuse to ship a contract with no pricing clause.
    const m = manifestFor({
      clauseSnapshot: { clauses: [{ tag: 'OPAL_CLAUSE_PRICING_PAYMENT', enabled: false }] },
    });
    expect(m.sections.find((s) => s.tag === 'OPAL_CLAUSE_PRICING_PAYMENT').included).toBe(true);
    expect(m.warnings.join(' ')).toMatch(/required clause/i);
  });
});

describe('the composed Word document', () => {
  it('populates a scalar by tag, in every occurrence it has', async () => {
    const { text } = await compose({
      formData: { OPAL_PARTICIPANT_FULL_NAME: 'Jordan Avery Whitlock' },
    });
    // The tag has two occurrences; both must carry the name.
    const hits = text.split('Jordan Avery Whitlock').length - 1;
    expect(hits).toBe(map.SCALAR_BY_TAG.OPAL_PARTICIPANT_FULL_NAME.occurrences);
  });

  it('populates the header and the footer, not just the body', async () => {
    const { zip } = await compose({
      serverValues: { OPAL_AGREEMENT_ID: 'SVA-1A2B3C4D', OPAL_AGREEMENT_VERSION: '1.0' },
    });
    const header = joinedText(await zip.file('word/header6.xml').async('string'));
    const footer = joinedText(await zip.file('word/footer6.xml').async('string'));
    expect(header).toContain('SVA-1A2B3C4D');
    expect(footer).toContain('1.0');
  });

  it('removes an unselected optional clause without taking its neighbours', async () => {
    const { xml, docx } = await compose({
      clauseSnapshot: { clauses: [{ tag: 'OPAL_CLAUSE_CONFLICTS', enabled: false }] },
    });
    expect(xml).not.toContain('<w:tag w:val="OPAL_CLAUSE_CONFLICTS"/>');
    expect(docx.docxStats.removedSections).toContain('OPAL_CLAUSE_CONFLICTS');

    // Nesting-aware removal: every other clause survives.
    for (const tag of map.CLAUSE_TAGS.filter((t) => t !== 'OPAL_CLAUSE_CONFLICTS')) {
      expect(xml).toContain(`<w:tag w:val="${tag}"/>`);
    }
  });

  it('strips both internal governance blocks from a participant copy', async () => {
    const { xml, text } = await compose({});
    for (const tag of map.INTERNAL_BLOCK_TAGS) {
      expect(xml).not.toContain(`<w:tag w:val="${tag}"/>`);
    }
    expect(text).not.toMatch(/OMIT FROM PARTICIPANT COPY/i);
  });

  it("keeps the internal blocks in the OWNER's own copy", async () => {
    const { xml } = await compose({}, 'owner');
    for (const tag of map.INTERNAL_BLOCK_TAGS) {
      expect(xml).toContain(`<w:tag w:val="${tag}"/>`);
    }
  });

  it('refuses to compose for an audience nobody named', async () => {
    await expect(generateAgreementDocx({
      templateBuffer: SEED, manifest: manifestFor(), audience: undefined,
    })).rejects.toThrow(/audience/i);
  });

  it('inserts custom clauses at the anchor, in order, and removes the anchor', async () => {
    const a = map.customClauseTag(randomUUID());
    const b = map.customClauseTag(randomUUID());
    const { xml, text, docx } = await compose({
      clauseSnapshot: {
        custom: [
          { tag: b, title: 'Rural travel', body: 'Travel is charged per the NDIS limits.', order: 1 },
          { tag: a, title: 'After-hours contact', body: 'Call the duty phone.', order: 0 },
        ],
      },
    });

    expect(docx.docxStats.customSections).toBe(2);
    expect(xml).toContain(`<w:tag w:val="${a}"/>`);
    expect(xml).toContain(`<w:tag w:val="${b}"/>`);
    expect(text).toContain('After-hours contact');
    expect(text).toContain('Travel is charged per the NDIS limits.');
    // Ordered by `order`, not by submission order.
    expect(text.indexOf('After-hours contact')).toBeLessThan(text.indexOf('Rural travel'));
    // The anchor is consumed.
    expect(xml).not.toContain(`<w:tag w:val="${map.CUSTOM_CLAUSE_ANCHOR}"/>`);
  });

  it('removes the anchor even when there are no custom clauses', async () => {
    const { xml } = await compose({});
    expect(xml).not.toContain(`<w:tag w:val="${map.CUSTOM_CLAUSE_ANCHOR}"/>`);
  });

  it('clones the support row once per agreed support', async () => {
    const { xml, text, docx } = await compose({
      supports: [
        SUPPORT({ OPAL_SUPPORT_ITEM_NUMBER: '15_056_0128_1_3', OPAL_SUPPORT_DESCRIPTION: 'Assessment' }),
        SUPPORT({ OPAL_SUPPORT_ITEM_NUMBER: '15_055_0128_1_3', OPAL_SUPPORT_DESCRIPTION: 'Report writing' }),
        SUPPORT({ OPAL_SUPPORT_ITEM_NUMBER: '15_098_0129_1_3', OPAL_SUPPORT_DESCRIPTION: 'Telehealth review' }),
      ],
    });

    expect(docx.docxStats.repeatedRows).toBe(3);
    for (const item of ['15_056_0128_1_3', '15_055_0128_1_3', '15_098_0129_1_3']) {
      expect(text).toContain(item);
    }
    for (const d of ['Assessment', 'Report writing', 'Telehealth review']) {
      expect(text).toContain(d);
    }
    // Each clone KEEPS the repeat tag — that is how a Word repeating section
    // works, and how the PDF renderer later tells one support's row from
    // another's. What must not survive is a FOURTH row: the template's own
    // example, which is consumed rather than left behind.
    const rowTags = xml.split(`<w:tag w:val="${map.REPEAT_SUPPORT_ROW}"/>`).length - 1;
    expect(rowTags).toBe(3);
  });

  it('gives every cloned control a fresh, unique w:id', async () => {
    // Word tolerates duplicate ids until the next edit. This is the assertion
    // that stops a cloned schedule quietly corrupting the document.
    const { xml } = await compose({
      supports: [SUPPORT(), SUPPORT(), SUPPORT(), SUPPORT(), SUPPORT()],
    });
    const ids = [...xml.matchAll(/<w:id w:val="(-?\d+)"\/>/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(124);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('removes the support row entirely when there are no supports', async () => {
    const { xml, docx } = await compose({ supports: [] });
    expect(docx.docxStats.repeatedRows).toBe(0);
    expect(xml).not.toContain(`<w:tag w:val="${map.REPEAT_SUPPORT_ROW}"/>`);
  });

  it('warns that the single detail panel describes only the first support', async () => {
    const { manifest } = await compose({ supports: [SUPPORT(), SUPPORT()] });
    expect(manifest.warnings.join(' ')).toMatch(/support-detail panel|describes the first support/i);
  });

  it('leaks no internal placeholder, even with nothing filled in', async () => {
    const { text, zip } = await compose({});
    for (const part of map.CONTROL_PARTS) {
      const file = zip.file(part);
      if (!file) continue;
      const partText = joinedText(await file.async('string'));
      for (const pattern of map.FORBIDDEN_TEXT_PATTERNS) {
        expect(partText).not.toMatch(pattern.re);
      }
    }
    expect(text).not.toMatch(/\[PORTAL|\[OWNER|\[SERVER|\[E-SIGN|\[INTERNAL/);
  });

  it('leaks no internal placeholder in a manual prompt-filled copy either', async () => {
    const { zip } = await compose({ blankStyle: 'prompt' });
    for (const part of map.CONTROL_PARTS) {
      const file = zip.file(part);
      if (!file) continue;
      const partText = joinedText(await file.async('string'));
      for (const pattern of map.FORBIDDEN_TEXT_PATTERNS) {
        expect(partText).not.toMatch(pattern.re);
      }
    }
  });

  it('would catch a leak if one ever happened', async () => {
    // The guard is only worth having if it actually fires. The RAW template is
    // full of placeholders, so it stands in for a composition that failed.
    await expect(assertNoForbiddenTokens(SEED)).rejects.toThrow(/internal content/i);
  });
});
