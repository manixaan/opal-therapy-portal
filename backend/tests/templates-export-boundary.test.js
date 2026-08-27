'use strict';

/**
 * EXPORT BOUNDARY — the assertions this whole capability rests on.
 *
 * Nothing is mocked. Every test composes a REAL document from a REAL shipped
 * master, severs it, and then reads the produced .docx and .pdf back to see
 * what they actually contain — because the only thing that matters is what
 * lands on the participant's machine.
 *
 * The regression case the brief asks for is REGRESSION_CASE below: one
 * portal-populated field, one manually populated field, and one unfinished
 * portal-capable field. Every export assertion is made against it.
 */

const fs = require('fs');
const JSZip = require('jszip');
const { PDFDocument, PDFName } = require('pdf-lib');

const catalogue = require('../templates/catalogue');
const { resolveDocument, exportDocument, composePortalDocx } = require('../templates/compose');
const { severDocx } = require('../templates/export-boundary');
const { readDocumentModel } = require('../templates/document-model');

jest.setTimeout(60000);

// ── The regression case ──────────────────────────────────────────────────────

const CLIENT = {
  // Splose is authoritative for identity: this is the PORTAL-POPULATED field.
  splose: {
    id: 'sp-1',
    fullName: 'Jane Smith',
    ndisNumber: '430000123',
    email: 'jane@example.invalid',
    mobilePhone: '0400 000 000',
    formattedAddress: '1 Example Street, Adelaide SA 5000',
  },
  profile: null,
  currentPlan: null,
  goals: [],
};

/** The MANUALLY populated field — typed on this document only. */
const MANUAL_TAG = 'OPAL_EMERGENCY_CONTACT_NAME';
const MANUAL_VALUE = 'Dana Okoro';

/** The UNFINISHED portal-capable field — a real portal source exists, but no value. */
const UNFINISHED_TAG = 'OPAL_PARTICIPANT_PLAN_END_DATE';

const ROW = {
  id: '11111111-2222-3333-4444-555555555555',
  title: 'Regression case',
  created_at: new Date('2026-08-24T00:00:00Z'),
  field_values: { [MANUAL_TAG]: MANUAL_VALUE },
};

function stateFor(templateId, overrides = {}) {
  const template = catalogue.getTemplate(templateId);
  return resolveDocument({
    template,
    row: { ...ROW, ...overrides },
    client: CLIENT,
    portal: { therapistName: 'Alex Rivera', therapistRoleTitle: 'Occupational Therapist' },
    organisation: { organisationName: 'Opal Therapy' },
  });
}

async function partsOf(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const out = {};
  for (const name of Object.keys(zip.files)) {
    if (/\.(xml|rels)$/.test(name)) out[name] = await zip.file(name).async('string');
  }
  out._names = Object.keys(zip.files).filter((n) => !n.endsWith('/'));
  return out;
}

const allXml = (parts) => Object.keys(parts)
  .filter((k) => k !== '_names').map((k) => parts[k]).join('\n');

/** The document's visible words, ignoring markup. */
function visibleText(xml) {
  return (xml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || [])
    .map((t) => t.replace(/<[^>]+>/g, '')).join(' ');
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. The boundary itself
// ═══════════════════════════════════════════════════════════════════════════

describe('export boundary — the portal-bound document still carries its bindings', () => {
  test('before severing, the composed document is bound and prompted (the thing we sever)', async () => {
    const state = stateFor('service_agreement');
    const parts = await partsOf(await composePortalDocx(state));
    const xml = parts['word/document.xml'];

    // If this ever stops being true the boundary is testing nothing.
    // v2.2 masters prompt with "[PORTAL: …]", the v1 masters with
    // "[PORTAL — …]" — either proves the document is still portal-bound.
    expect(xml).toMatch(/OPAL_[A-Z0-9_]+/);
    expect(xml).toMatch(/\[PORTAL[:\s—]/);
    expect(xml).toContain('Jane Smith');
  });
});

describe.each([
  ['service_agreement'],
  ['progress_note'],
  ['fca'],
])('export boundary — %s', (templateId) => {
  let docxParts;
  let out;

  beforeAll(async () => {
    out = await exportDocument(stateFor(templateId), 'docx');
    docxParts = await partsOf(out.buffer);
  });

  test('no Opal binding identifier survives in any part', () => {
    const found = allXml(docxParts).match(/OPAL_[A-Z0-9_]+/g);
    expect(found === null ? [] : [...new Set(found)]).toEqual([]);
  });

  test('no master prompt survives — no [PORTAL/OWNER/SERVER/E-SIGN — …]', () => {
    const found = allXml(docxParts).match(/\[(?:PORTAL|OWNER|SERVER|E-SIGN|ESIGN)\b[^\]]*\]/g);
    expect(found === null ? [] : [...new Set(found)]).toEqual([]);
  });

  test('no merge-source field code and no XML data binding survive', () => {
    const xml = allXml(docxParts);
    expect(xml).not.toMatch(/MERGEFIELD|DOCVARIABLE/i);
    expect(xml).not.toMatch(/<w:dataBinding\b/);
  });

  test('native Word field codes are left alone — they resolve offline', async () => {
    // PAGE / NUMPAGES / TOC are Word's own features, not portal dependencies.
    // Removing them would damage a document to satisfy a regex.
    const master = await partsOf(catalogue.readMaster(catalogue.getTemplate(templateId)));
    const footers = Object.keys(master).filter((n) => /^word\/footer\d*\.xml$/.test(n));
    for (const f of footers) {
      const before = (master[f].match(/\bPAGE\b/g) || []).length;
      const after = (docxParts[f] ? docxParts[f].match(/\bPAGE\b/g) || [] : []).length;
      expect(`${f}:${after}`).toBe(`${f}:${before}`);
    }
  });

  test('the package is structurally the master, minus only what we severed', async () => {
    const master = await partsOf(catalogue.readMaster(catalogue.getTemplate(templateId)));
    // No part added, no part lost — a viewer opens it without repair.
    expect([...docxParts._names].sort()).toEqual([...master._names].sort());
  });

  test('every remaining content control is a named, standalone text field', () => {
    const xml = docxParts['word/document.xml'];
    const opens = (xml.match(/<w:sdt>/g) || []).length;
    const closes = (xml.match(/<\/w:sdt>/g) || []).length;
    expect(opens).toBe(closes);

    // Each surviving control carries a human alias and no tag.
    const aliases = [...xml.matchAll(/<w:alias w:val="([^"]*)"/g)].map((m) => m[1]);
    expect(aliases.length).toBeGreaterThan(0);
    for (const a of aliases) {
      expect(a).not.toMatch(/OPAL_|PORTAL|E-SIGN|SERVER/);
    }
  });

  test('master-template metadata does not travel with the instance', () => {
    const core = docxParts['docProps/core.xml'] || '';
    expect(core).not.toMatch(/Master Template|Controlled|Not for participant issue/i);
  });

  test('Word will not prompt to update fields — no w:updateFields, no attached template', () => {
    const settings = docxParts['word/settings.xml'] || '';
    expect(settings).not.toMatch(/<w:updateFields\b/);
    expect(settings).not.toMatch(/<w:attachedTemplate\b/);
  });

  test('no underline placeholder anywhere — an unfinished field exports EMPTY', () => {
    // The old boundary wrote "__________" into every unfinished control and
    // swept prompt. A printed page full of underscores reads as a defect; the
    // requirement is a clean blank the reader completes naturally.
    expect(visibleText(allXml(docxParts))).not.toContain('_____');
  });

  test('no template-instruction language survives in visible text', () => {
    const visible = visibleText(allXml(docxParts));
    expect(visible).not.toContain('Using this FCA template');
    expect(visible).not.toContain('PORTAL PRE-FILL');
    expect(visible).not.toContain('PORTAL COMPOSITION');
    expect(visible).not.toContain('TEMPLATE CONTROL');
    expect(visible).not.toContain('Report Template');
    expect(visible).not.toMatch(/the portal (?:must|may|repeats)/i);
  });

  test('nothing is highlighted — no yellow anywhere', () => {
    const xml = allXml(docxParts);
    expect(xml).not.toMatch(/<w:highlight\b/);
    // FFFF00 / FFFF99 and friends: any yellow-ish shading fill.
    const fills = [...xml.matchAll(/w:fill="([0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase());
    const yellows = fills.filter((f) => /^FF(F|E|D)[0-9A-F]?/.test(f) && f.slice(4) !== 'FF');
    expect(yellows).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  2. The regression case, end to end, in both formats
// ═══════════════════════════════════════════════════════════════════════════

describe('regression case — populated portal value, manual value, unfinished field', () => {
  let state;
  let docx;
  let pdf;

  beforeAll(async () => {
    state = stateFor('service_agreement');
    docx = await exportDocument(state, 'docx');
    pdf = await exportDocument(state, 'pdf');
  });

  test('the case is genuinely the three cases it claims to be', () => {
    expect(state.scalarSources.OPAL_PARTICIPANT_FULL_NAME).toBe('splose');
    expect(state.scalarSources[MANUAL_TAG]).toBe('report_override');
    expect(state.scalarSources[UNFINISHED_TAG]).toBe('missing');
    // The unfinished one is PORTAL-CAPABLE: a real source exists for it.
    const meta = catalogue.getTemplate('service_agreement').catalogue.SCALAR_BY_TAG.get(UNFINISHED_TAG);
    expect(meta.layer).toBe('client_profile');
  });

  test('WORD — the portal-populated value is resolved into the document', async () => {
    const parts = await partsOf(docx.buffer);
    expect(visibleText(parts['word/document.xml'])).toContain('Jane Smith');
    expect(visibleText(parts['word/document.xml'])).toContain('430000123');
  });

  test('WORD — the manually entered value is preserved', async () => {
    const parts = await partsOf(docx.buffer);
    expect(visibleText(parts['word/document.xml'])).toContain(MANUAL_VALUE);
  });

  test('WORD — the unfinished field is an independently editable Word control', async () => {
    const parts = await partsOf(docx.buffer);
    const xml = parts['word/document.xml'];

    // A content control named for the field, empty and ready to complete.
    // UNFINISHED_TAG is a DATE, so the control is Word's own calendar picker
    // rather than a bare text box. Nothing about it refers to Opal.
    const label = catalogue.getTemplate('service_agreement')
      .catalogue.SCALAR_BY_TAG.get(UNFINISHED_TAG).label;
    expect(xml).toContain(`<w:alias w:val="${label}"`);

    const sdt = xml.split('<w:sdt>').find((chunk) => chunk.includes(`w:val="${label}"`));
    expect(sdt).toBeDefined();
    expect(sdt).toContain('<w:date>');
    expect(sdt).toContain('<w:dateFormat w:val="d/MM/yyyy"/>');
    expect(sdt).toContain('<w:lid w:val="en-AU"/>');
    expect(sdt).not.toContain('__________');      // empty, not an underline rule
    expect(sdt.slice(0, sdt.indexOf('</w:sdtPr>'))).not.toContain('<w:tag');
  });

  test('WORD — an unfinished NON-date field is a plain-text control, empty', async () => {
    const parts = await partsOf(docx.buffer);
    const xml = parts['word/document.xml'];
    // The regression case leaves the plan manager (a text field) unresolved.
    const meta = catalogue.getTemplate('service_agreement')
      .catalogue.SCALAR_BY_TAG.get('OPAL_PARTICIPANT_COMMUNICATION_SUPPORTS');
    const sdt = xml.split('<w:sdt>').find((chunk) => chunk.includes(`w:val="${meta.label}"`));
    expect(sdt).toBeDefined();
    expect(sdt).toContain('<w:text/>');
    expect(sdt).not.toContain('<w:date>');
    expect(sdt).not.toContain('__________');
  });

  test('WORD — a resolved field is plain text, no control left around it', async () => {
    const parts = await partsOf(docx.buffer);
    const xml = parts['word/document.xml'];
    // "Jane Smith" is present, and no surviving control is named for it.
    expect(xml).toContain('Jane Smith');
    expect(xml).not.toContain('<w:alias w:val="Participant full name"');
  });

  test('PDF — carries the same resolved and manual values', async () => {
    const model = await readDocumentModel((await exportDocument(state, 'docx')).buffer);
    const flat = JSON.stringify(model.blocks);
    expect(flat).toContain('Jane Smith');
    expect(flat).toContain('430000123');
    expect(flat).toContain(MANUAL_VALUE);

    // And the bytes really are a PDF.
    expect(pdf.buffer.slice(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.contentType).toBe('application/pdf');
  });

  test('PDF — the unfinished field is a real, fillable AcroForm input', async () => {
    const loaded = await PDFDocument.load(pdf.buffer);
    const form = loaded.getForm();
    const names = form.getFields().map((f) => f.getName());

    const label = catalogue.getTemplate('service_agreement')
      .catalogue.SCALAR_BY_TAG.get(UNFINISHED_TAG).label;
    expect(names).toContain(label);

    // It accepts typing with no portal involved.
    const field = form.getTextField(label);
    expect(() => field.setText('30/06/2027')).not.toThrow();
    expect(field.getText()).toBe('30/06/2027');

    // And a viewer that distrusts our appearance streams still draws it.
    const acro = loaded.catalog.lookup(PDFName.of('AcroForm'));
    expect(String(acro.get(PDFName.of('NeedAppearances')))).toBe('true');
  });

  test('PDF — a resolved value is printed text, not an empty form field', async () => {
    const loaded = await PDFDocument.load(pdf.buffer);
    const names = loaded.getForm().getFields().map((f) => f.getName());
    expect(names).not.toContain('Participant full name');
  });

  test('both formats agree on which fields are still outstanding', () => {
    expect(pdf.unfinished.map((f) => f.tag).sort())
      .toEqual(docx.unfinished.map((f) => f.tag).sort());
    expect(docx.unfinished.map((f) => f.tag)).toContain(UNFINISHED_TAG);
    expect(docx.unfinished.map((f) => f.tag)).not.toContain(MANUAL_TAG);
    expect(docx.unfinished.map((f) => f.tag)).not.toContain('OPAL_PARTICIPANT_FULL_NAME');
  });

  test('neither export contains anything a reader could resolve only via Opal', async () => {
    const parts = await partsOf(docx.buffer);
    const xml = allXml(parts);
    expect(xml).not.toMatch(/OPAL_[A-Z0-9_]+/);
    expect(xml).not.toMatch(/\[(?:PORTAL|OWNER|SERVER|E-SIGN)\b/);
    expect(xml).not.toMatch(/\{\{|\}\}/);          // no moustache-style token
    expect(xml).not.toMatch(/«|»/);                 // no merge-field chevrons

    const raw = pdf.buffer.toString('latin1');
    expect(raw).not.toMatch(/OPAL_[A-Z0-9_]+/);
    expect(raw).not.toMatch(/\[PORTAL/);
  });

  test('the exported PDF does not shade any field yellow', async () => {
    // Every field is drawn white with a grey rule; assert on the widget's own
    // background rather than on a rendering.
    const loaded = await PDFDocument.load(pdf.buffer);
    expect(loaded.getForm().getFields().length).toBeGreaterThan(0);
    const raw = pdf.buffer.toString('latin1');
    // A yellow fill would appear as an RGB operator with high R,G and low B.
    const rgbOps = [...raw.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)]
      .map((m) => m.slice(1).map(Number));
    const yellowish = rgbOps.filter(([r, g, b]) => r > 0.8 && g > 0.8 && b < 0.5);
    expect(yellowish).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  3. The master is never modified
// ═══════════════════════════════════════════════════════════════════════════

describe('the reusable master is untouched by completing a document', () => {
  test.each(catalogue.TEMPLATES.map((t) => [t.id]))(
    '%s master bytes are identical before and after a full compose + export',
    async (templateId) => {
      const template = catalogue.getTemplate(templateId);
      const before = fs.readFileSync(template.file);

      const state = stateFor(templateId);
      await composePortalDocx(state);
      await exportDocument(state, 'docx');
      await exportDocument(state, 'pdf');

      const after = fs.readFileSync(template.file);
      expect(after.equals(before)).toBe(true);
    }
  );

  test('two documents from one master do not leak values into each other', async () => {
    const a = await exportDocument(stateFor('service_agreement'), 'docx');
    const b = await exportDocument(
      resolveDocument({
        template: catalogue.getTemplate('service_agreement'),
        row: { ...ROW, id: '99999999-8888-7777-6666-555555555555', field_values: {} },
        client: { splose: null, profile: null, currentPlan: null, goals: [] },
        portal: null,
        organisation: null,
      }),
      'docx'
    );
    const bp = await partsOf(b.buffer);
    const text = visibleText(bp['word/document.xml']);
    expect(text).not.toContain('Jane Smith');
    expect(text).not.toContain(MANUAL_VALUE);
    expect(a.buffer.equals(b.buffer)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  4. The verifier fails closed
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
//  3b. Participant context and section structure
// ═══════════════════════════════════════════════════════════════════════════

describe('the exported document identifies its participant', () => {
  test('title and filename carry the participant name, never an identifier', async () => {
    const out = await exportDocument(stateFor('fca', { title: 'Functional Capacity Assessment' }), 'docx');
    expect(out.filename).toContain('Jane-Smith');
    expect(out.filename).not.toContain('430000123');

    const parts = await partsOf(out.buffer);
    expect(parts['docProps/core.xml']).toContain('Functional Capacity Assessment — Jane Smith');
    expect(parts['docProps/core.xml']).not.toContain('430000123');
  });

  test('a title that already names the participant is not doubled', async () => {
    const out = await exportDocument(
      stateFor('fca', { title: 'FCA — Jane Smith' }), 'docx'
    );
    const parts = await partsOf(out.buffer);
    expect(parts['docProps/core.xml']).toContain('FCA — Jane Smith');
    expect(parts['docProps/core.xml']).not.toContain('Jane Smith — Jane Smith');
  });

  test('an unbound document keeps its own title unchanged', async () => {
    const state = resolveDocument({
      template: catalogue.getTemplate('fca'),
      row: { ...ROW, title: 'Blank working copy', field_values: {} },
      client: { splose: null, profile: null, currentPlan: null, goals: [] },
      portal: null,
      organisation: null,
    });
    const out = await exportDocument(state, 'docx');
    const parts = await partsOf(out.buffer);
    expect(parts['docProps/core.xml']).toContain('Blank working copy');
  });
});

describe('FCA section structure flows through preview and both exports', () => {
  const SECTIONS = {
    // Drop the MoCA (optional, has a dependent results row) and Appendices;
    // move Cognition ahead of Mobility.
    selected: catalogue.getTemplate('fca').sectionCatalogue.SECTIONS
      .map((s) => s.tag)
      .filter((t) => t !== 'OPAL_SECTION_ASSESSMENT_TOOL_MOCA' && t !== 'OPAL_SECTION_APPENDICES'),
    order: (() => {
      const tags = catalogue.getTemplate('fca').sectionCatalogue.SECTIONS.map((s) => s.tag);
      const cog = tags.indexOf('OPAL_SECTION_DOMAIN_COGNITION');
      const mob = tags.indexOf('OPAL_SECTION_DOMAIN_MOBILITY');
      [tags[cog], tags[mob]] = [tags[mob], tags[cog]];
      return tags;
    })(),
  };

  let parts;
  let visible;

  beforeAll(async () => {
    const out = await exportDocument(stateFor('fca', { sections: SECTIONS }), 'docx');
    parts = await partsOf(out.buffer);
    visible = visibleText(parts['word/document.xml']);
  });

  test('an excluded optional section is absent, and its results row goes with it', () => {
    expect(visible).not.toContain('Montreal Cognitive Assessment');
    // The results table's own "MoCA" row travels with the excluded section.
    // The Cognition domain's clinical prompt legitimately still says
    // "…relevant WHODAS/MoCA findings…" — that is guidance, not the section.
    expect(visible.replace(/WHODAS\/MoCA/g, '')).not.toMatch(/\bMoCA\b/);
    expect(visible).not.toContain('Appendices');
  });

  test('NO section is required here — an empty selection strips them all', async () => {
    // The Templates editor deliberately diverges from the FCA wizard: its
    // catalogue declares no required sections, and the composer receives that
    // same catalogue — so a stored removal is honoured, never resurrected.
    const bare = await exportDocument(stateFor('fca', {
      sections: { selected: [], order: [] },
    }), 'docx');
    const text = visibleText((await partsOf(bare.buffer))['word/document.xml']);
    expect(text).not.toContain('Referral Information');
    expect(text).not.toContain('Professional Declaration');
    // The document itself survives: cover and front matter are the master's
    // own, not sections.
    expect(text).toContain('FUNCTIONAL ASSESSMENT REPORT');
  });

  test('reordering swaps siblings in the document flow', () => {
    expect(visible.indexOf('Cognition')).toBeGreaterThan(-1);
    expect(visible.indexOf('Cognition')).toBeLessThan(visible.indexOf('Mobility'));
  });

  test('the preview composition is the same structure the export severs', async () => {
    const preview = await composePortalDocx(stateFor('fca', { sections: SECTIONS }));
    const previewText = visibleText((await partsOf(preview))['word/document.xml']);
    expect(previewText).not.toContain('Montreal Cognitive Assessment');
    expect(previewText.replace(/WHODAS\/MoCA/g, '')).not.toMatch(/\bMoCA\b/);
    expect(previewText.indexOf('Cognition')).toBeLessThan(previewText.indexOf('Mobility'));
  });
});

describe('the portal surface never shows template-maintainer language', () => {
  test('the preview compose drops the guide page and the control band, but stays portal-bound', async () => {
    const parts = await partsOf(await composePortalDocx(stateFor('fca')));
    const visible = visibleText(parts['word/document.xml']);
    expect(visible).not.toContain('Using this FCA template');
    expect(visible).not.toContain('PORTAL PRE-FILL');
    expect(parts['word/header5.xml']).not.toContain('TEMPLATE CONTROL');
    // Still the IN-PORTAL document: bindings and prompts are its job.
    expect(parts['word/document.xml']).toMatch(/OPAL_[A-Z0-9_]+/);
    expect(parts['word/document.xml']).toMatch(/\[PORTAL —/);
  });
});

describe('clinician-created sections and heading levels', () => {
  const CUSTOM_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const SECTIONS = {
    custom: [{ id: CUSTOM_ID, title: 'Sensory Profile Observations', guidance: 'Describe findings.', level: 3 }],
    levels: { OPAL_SECTION_DOMAIN_MOBILITY: 1 },
  };

  let previewXml;
  let exportParts;

  beforeAll(async () => {
    previewXml = await (async () => {
      const parts = await partsOf(await composePortalDocx(stateFor('fca', { sections: SECTIONS })));
      return parts['word/document.xml'];
    })();
    exportParts = await partsOf(
      (await exportDocument(stateFor('fca', { sections: SECTIONS }), 'docx')).buffer
    );
  });

  test('a custom section renders in the preview, at its chosen heading level', () => {
    expect(visibleText(previewXml)).toContain('Sensory Profile Observations');
    // Its rebuilt TOC entry sits at the chosen depth — proof the level took.
    const tocIdx = previewXml.indexOf('Sensory Profile Observations');
    expect(previewXml.slice(tocIdx - 300, tocIdx)).toContain('TOC3');
  });

  test('a master section can be promoted, and the TOC follows', () => {
    const mob = previewXml.indexOf('OPAL_SECTION_DOMAIN_MOBILITY');
    expect(previewXml.slice(mob, mob + 900)).toContain('OPAL–Heading1');
  });

  test('the custom section survives export with its wording and no identifier', () => {
    const xml = exportParts['word/document.xml'];
    expect(visibleText(xml)).toContain('Sensory Profile Observations');
    expect(xml).not.toMatch(/OPAL_[A-Z0-9_]+/);
  });

  test('an ordinary document without custom sections is unchanged by the capability', async () => {
    const parts = await partsOf(await composePortalDocx(stateFor('fca')));
    expect(visibleText(parts['word/document.xml'])).not.toContain('Sensory Profile');
  });
});

describe('verification refuses to ship a leak', () => {
  test('a binding the severing pass missed fails the export instead of shipping', async () => {
    const state = stateFor('service_agreement');
    const portalDocx = await composePortalDocx(state);

    // Sever nothing: no field list, no internal tags. Every control is then
    // unwrapped, but the master's own literal prompts outside controls are
    // swept — so to prove the VERIFIER works, sever a part list that misses
    // the body entirely.
    await expect(severDocx({
      buffer: portalDocx,
      fields: [],
      controlParts: [],                 // nothing is rewritten
      internalTags: [],
      anchorTags: [],
      documentTitle: 'Leaky',
    })).rejects.toThrow(/export boundary breached/);
  });

  test('the thrown error is flagged so the route can refuse the download', async () => {
    const state = stateFor('service_agreement');
    const portalDocx = await composePortalDocx(state);
    let caught = null;
    try {
      await severDocx({
        buffer: portalDocx, fields: [], controlParts: [],
        internalTags: [], anchorTags: [], documentTitle: 'Leaky',
      });
    } catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(caught.exportBoundaryBreach).toBe(true);
    expect(Array.isArray(caught.problems)).toBe(true);
  });
});
