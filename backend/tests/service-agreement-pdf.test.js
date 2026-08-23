'use strict';

/**
 * SERVICE AGREEMENT — THE FILLABLE PDF
 *
 * What this suite protects: the document a participant actually opens.
 *
 * The PDF is the artefact that leaves the building. It is what gets emailed,
 * downloaded, printed and signed, and unlike the Word copy it goes to someone
 * with no account, no training and no way to tell a rendering bug from a term
 * of the contract. Three things therefore have to be true of it:
 *
 *   - The fields a participant may complete are interactive, and the ones they
 *     may not are locked. A fillable rate is an invitation to renegotiate the
 *     price after signing.
 *   - Values are VISIBLE. AcroForm has two competing mechanisms for that —
 *     appearance streams and /NeedAppearances — and different viewers honour
 *     different ones, so the document carries both.
 *   - Nothing overflows and nothing internal leaks. The overflow assertion in
 *     particular is not theoretical: it caught two clause bullets running past
 *     the right margin, because the standard fonts are not embedded and a
 *     viewer's own Helvetica advances differ slightly from the metrics the
 *     layout was measured with.
 */

const fs = require('fs');
const { PDFDocument, PDFName } = require('pdf-lib');

const map = require('../service-agreements/template-map');
const { composeAgreementManifest } = require('../service-agreements/manifest');
const { generateAgreementDocx } = require('../service-agreements/docx');
const { renderAgreementPdf, agreementFilename } = require('../service-agreements/pdf');

const SEED = fs.readFileSync(map.SEED_TEMPLATE_FILE);
const META = { reference: 'SVA-1A2B3C4D', versionLabel: '1.0', participantName: 'Jordan Avery Whitlock' };

const SUPPORT = (over = {}) => ({
  OPAL_SUPPORT_ITEM_NUMBER: '15_056_0128_1_3',
  OPAL_SUPPORT_DESCRIPTION: 'Occupational therapy assessment',
  OPAL_SUPPORT_DELIVERY_METHOD: 'In person',
  OPAL_SUPPORT_FREQUENCY: 'Fortnightly',
  OPAL_SUPPORT_RATE: '193.99',
  OPAL_SUPPORT_ESTIMATED_QUANTITY: '12',
  ...over,
});

async function render({ formData = {}, supports = [], lock = false, organisation = {}, serverValues = {} } = {}) {
  const manifest = composeAgreementManifest({
    formData, supports, serverValues, organisation, clauseSnapshot: {},
    blankStyle: 'empty', audience: 'participant',
  });
  const docx = await generateAgreementDocx({ templateBuffer: SEED, manifest, audience: 'participant' });
  return renderAgreementPdf({ docxBuffer: docx, meta: META, lockProviderFields: lock });
}

/**
 * Every text item with its position — the REAL laid-out geometry.
 *
 * Via the repo's existing pdfjs worker_thread rather than a dynamic import:
 * pdfjs 4 is ESM only and importing it inside Jest's VM either refuses
 * outright or fails nondeterministically across suites. The worker is a plain
 * Node realm, which is exactly why it exists.
 */
const { pdfTextItems } = require('../resource-file-quality');

async function textItems(bytes) {
  const items = await pdfTextItems(Buffer.from(bytes));
  return items.map((i) => ({ page: i.page, x: i.x, y: i.y, w: i.width, str: i.str }));
}

let blank;
let filled;
let locked;

beforeAll(async () => {
  blank = await render({ supports: [{}, {}, {}] });
  filled = await render({
    formData: {
      OPAL_PARTICIPANT_FULL_NAME: 'Jordan Avery Whitlock',
      OPAL_PARTICIPANT_NDIS_NUMBER: '430512977',
      OPAL_PARTICIPANT_EMAIL: 'jordan@example.invalid',
    },
    organisation: { OPAL_ORG_PHONE: '02 6931 0000', OPAL_ORG_ABN: '51 824 753 556' },
    supports: [SUPPORT(), SUPPORT(), SUPPORT()],
  });
  locked = await render({
    formData: { OPAL_PARTICIPANT_FULL_NAME: 'Jordan Avery Whitlock' },
    supports: [SUPPORT()],
    lock: true,
  });
}, 60000);

// ─────────────────────────────────────────────────────────────────────────────

describe('the PDF is a standard AcroForm', () => {
  it('is AcroForm, never XFA', async () => {
    // XFA is deprecated and unsupported in browser viewers and macOS Preview.
    // A participant who cannot open the form cannot sign it.
    const doc = await PDFDocument.load(blank.bytes);
    expect(doc.getForm().hasXFA()).toBe(false);
  });

  it('sets NeedAppearances so values render in viewers that ignore streams', async () => {
    const doc = await PDFDocument.load(blank.bytes);
    const flag = doc.getForm().acroForm.dict.get(PDFName.of('NeedAppearances'));
    expect(String(flag)).toBe('true');
  });

  it('generates without warnings', () => {
    expect(blank.warnings).toEqual([]);
    expect(filled.warnings).toEqual([]);
  });

  it('produces a multi-page agreement with a page-count footer', async () => {
    expect(blank.pageCount).toBeGreaterThanOrEqual(6);
    const items = await textItems(blank.bytes);
    expect(items.some((i) => /Page 1 of \d+/.test(i.str))).toBe(true);
  }, 30000);
});

describe('blank controls become interactive fields', () => {
  it('offers a field for every blank a participant has to complete', async () => {
    expect(blank.fieldCount).toBeGreaterThan(60);
    const doc = await PDFDocument.load(blank.bytes);
    const types = doc.getForm().getFields().map((f) => f.constructor.name);
    expect(types).toContain('PDFTextField');
    expect(types).toContain('PDFRadioGroup');
  });

  it('stops offering a field once the value is known', () => {
    // A populated control is TEXT. Leaving it interactive would invite a
    // participant to overwrite a value the practice supplied.
    expect(filled.fieldCount).toBeLessThan(blank.fieldCount);
    expect(blank.fieldNames).toContain('Participant full name');
    expect(filled.fieldNames).not.toContain('Participant full name');
  });

  it('gives a repeated scalar ONE field with several widgets', async () => {
    // Provider phone appears twice in the document. Two fields would mean
    // typing it twice; one field with two widgets fills both at once.
    const occurrences = blank.fieldNames.filter((n) => n === 'Provider phone');
    expect(occurrences).toHaveLength(1);

    const doc = await PDFDocument.load(blank.bytes);
    const field = doc.getForm().getTextField('Provider phone');
    expect(field.acroField.getWidgets()).toHaveLength(
      map.SCALAR_BY_TAG.OPAL_ORG_PHONE.occurrences
    );
  });

  it('gives every support row its own indexed fields', () => {
    const rowFields = blank.fieldNames.filter((n) => / — support \d+$/.test(n));
    // Five repeatable columns across three supports.
    expect(rowFields).toHaveLength(map.REPEAT_ROW_TAGS.length * 3);
    expect(new Set(rowFields).size).toBe(rowFields.length);
    expect(rowFields).toContain('Support rate — support 1');
    expect(rowFields).toContain('Support rate — support 3');
  });

  it('makes a consent a radio group with the template’s own options', async () => {
    const doc = await PDFDocument.load(blank.bytes);
    const group = doc.getForm().getRadioGroup('Consent to share information');
    expect(group.getOptions()).toEqual(map.CHOICES.YES_NO_DISCUSS);
  });

  it('carries an accessible tooltip on its fields', async () => {
    const doc = await PDFDocument.load(blank.bytes);
    const withTooltips = doc.getForm().getFields()
      .filter((f) => f.acroField.dict.get(PDFName.of('TU')) !== undefined);
    // A screen reader announces /TU. Most fields should carry one.
    expect(withTooltips.length).toBeGreaterThan(blank.fieldCount / 2);
  });
});

describe('an issued agreement locks the provider’s own entries', () => {
  it('locks everything the participant may not change', async () => {
    const doc = await PDFDocument.load(locked.bytes);
    const readOnly = doc.getForm().getFields().filter((f) => f.isReadOnly());
    expect(readOnly.length).toBeGreaterThan(0);
  });

  it('leaves the participant’s own fields writable', async () => {
    const doc = await PDFDocument.load(locked.bytes);
    const open = doc.getForm().getFields().filter((f) => !f.isReadOnly());
    expect(open.length).toBeGreaterThan(0);

    // Cross-check against the map: a locked field must not be one the
    // template marks participant-editable.
    const editableNames = new Set(
      map.SCALARS.filter((f) => f.participantEditable).map((f) => f.pdfName)
    );
    const wronglyLocked = doc.getForm().getFields()
      .filter((f) => f.isReadOnly())
      .map((f) => f.getName())
      .filter((n) => editableNames.has(n));
    expect(wronglyLocked).toEqual([]);
  });

  it('locks nothing in a manual blank form', async () => {
    const doc = await PDFDocument.load(blank.bytes);
    expect(doc.getForm().getFields().filter((f) => f.isReadOnly())).toHaveLength(0);
  });
});

describe('what the participant can read on the page', () => {
  it('shows the values that were supplied', async () => {
    const items = await textItems(filled.bytes);
    const all = items.map((i) => i.str).join(' ');
    expect(all).toContain('Jordan Avery Whitlock');
    expect(all).toContain('430512977');
    expect(all).toContain('15_056_0128_1_3');
  }, 30000);

  it('leaks no internal placeholder anywhere in the text layer', async () => {
    for (const result of [blank, filled]) {
      const all = (await textItems(result.bytes)).map((i) => i.str).join(' ');
      for (const pattern of map.FORBIDDEN_TEXT_PATTERNS) {
        expect(all).not.toMatch(pattern.re);
      }
    }
  }, 30000);

  it('carries no owner governance content', async () => {
    const all = (await textItems(blank.bytes)).map((i) => i.str).join(' ');
    expect(all).not.toMatch(/OMIT FROM PARTICIPANT COPY/i);
  }, 30000);

  it('never runs past the right margin', async () => {
    // The standard 14 fonts are not embedded, so a viewer substitutes its own
    // and the advances differ slightly. This caught a real overhang.
    const limit = 595.28 - 51 + 1;
    for (const result of [blank, filled]) {
      const over = (await textItems(result.bytes)).filter((i) => i.x + i.w > limit);
      expect(over.map((o) => `p${o.page}: ${o.str.slice(0, 40)}`)).toEqual([]);
    }
  }, 30000);

  it('never runs past the left margin', async () => {
    const items = await textItems(blank.bytes);
    expect(items.filter((i) => i.x < 51 - 1)).toEqual([]);
  }, 30000);
});

describe('filenames', () => {
  it('are safe to write to a filesystem', () => {
    const name = agreementFilename(
      { participantName: 'Renée Müller-Ødegård/../etc', reference: 'SVA-1A2B3C4D' }, 'signed'
    );
    expect(name).toMatch(/\.pdf$/);
    expect(name).not.toMatch(/[/\\]/);
    // Hyphens are normalised away with everything else that is not
    // [A-Za-z0-9_] — the reference is still recognisable in the filename.
    expect(name).toContain('SVA_1A2B3C4D');
  });
});
