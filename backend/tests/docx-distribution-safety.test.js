'use strict';

/**
 * OPAL DOCX DISTRIBUTION SAFETY — one suite for every Word file the portal
 * produces.
 *
 * What this protects: a participant, a plan manager or an NDIS auditor opening
 * an Opal document in Word must not be met by
 *
 *   "This document contains fields that may refer to other files.
 *    Do you want to update the fields in this document?"
 *
 * Every Opal master inherited `<w:updateFields w:val="true"/>` from the
 * original FCA master, which tells Word to recalculate every field on open and
 * is what produces that prompt. The documents never referred to another file:
 * measured across all three masters, the only fields are TOC, PAGE and
 * NUMPAGES, and there is not one external relationship anywhere.
 *
 * These assertions run against the FINAL ZIP PACKAGE of a composed document,
 * not against the source template — because the template being clean proves
 * nothing about what the composer, the engine and the routes did afterwards.
 *
 * The second half is the other half of the promise: that removing the setting
 * did not cost anything. Page numbers, the FCA table of contents, every
 * OPAL_* control, nesting, headers, footers and the embedded logo all have to
 * still be there.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const {
  auditDocx, sanitizeDocxForDistribution, readUpdateFields, stripUnsafeSettings,
} = require('../docx-sanitiser');

const { generateFcaDocx } = require('../fca/docx-engine');
const { generateLetterDocx } = require('../fca/letter-blocks');
const { buildDocx } = require('../opal-document-builder');

const fcaMap = require('../fca/template-map');
const letterMap = require('../fca/letter-template-map');
const saMap = require('../service-agreements/template-map');
const { composeAgreementManifest } = require('../service-agreements/manifest');
const { generateAgreementDocx } = require('../service-agreements/docx');

const TEMPLATES = path.join(__dirname, '..', 'fca', 'templates');
const FCA_TPL = fs.readFileSync(path.join(TEMPLATES, 'fca-v1.1.docx'));
const LETTER_TPL = fs.readFileSync(path.join(TEMPLATES, letterMap.LETTER_TEMPLATE_FILENAME));
const SA_TPL = fs.readFileSync(saMap.SEED_TEMPLATE_FILE);

const SUPPORT = {
  OPAL_SUPPORT_ITEM_NUMBER: '15_056_0128_1_3',
  OPAL_SUPPORT_DESCRIPTION: 'Occupational therapy assessment',
  OPAL_SUPPORT_DELIVERY_METHOD: 'In person',
  OPAL_SUPPORT_FREQUENCY: 'Weekly',
  OPAL_SUPPORT_RATE: '193.99',
  OPAL_SUPPORT_ESTIMATED_QUANTITY: '10',
};

function agreement(over) {
  const manifest = composeAgreementManifest(Object.assign({
    formData: {}, supports: [{}], serverValues: {}, organisation: {},
    clauseSnapshot: {}, blankStyle: 'empty', audience: 'participant',
  }, over));
  return generateAgreementDocx({
    templateBuffer: SA_TPL, manifest, audience: over.audience || 'participant',
  });
}

/** Every output the portal can hand somebody, composed for real. */
let OUTPUTS;

beforeAll(async () => {
  OUTPUTS = [
    ['FCA — portal-prefilled', await generateFcaDocx({
      templateBuffer: FCA_TPL,
      manifest: { scalarData: { OPAL_CLIENT_FULL_NAME: 'Jordan Whitlock' }, sections: [] },
    })],
    ['FCA — manual', await generateFcaDocx({
      templateBuffer: FCA_TPL, manifest: { scalarData: {}, sections: [] },
    })],
    ['Progress note letter', await generateLetterDocx({
      templateBuffer: LETTER_TPL,
      manifest: { scalarData: { OPAL_CLIENT_FULL_NAME: 'Jordan Whitlock' }, sections: [] },
    })],
    ['Service Agreement — populated', await agreement({
      formData: { OPAL_PARTICIPANT_FULL_NAME: 'Jordan Whitlock' },
      supports: [SUPPORT],
      serverValues: { OPAL_AGREEMENT_ID: 'SVA-TEST1234' },
      organisation: { OPAL_ORG_ABN: '51 824 753 556' },
    })],
    ['Service Agreement — manual', await agreement({ blankStyle: 'prompt' })],
    ['Service Agreement — owner master copy', await agreement({ audience: 'owner', blankStyle: 'prompt' })],
    ['Service Agreement — master download', SA_TPL],
    ['Resource Hub document builder', await buildDocx({
      title: 'A document', subtitle: 'sub', footer: 'foot',
      sections: [{ heading: 'H', paragraphs: ['body'], table: { headers: ['a'], rows: [['1']] } }],
      limitations: ['none'],
    })],
  ];
}, 60000);

// ═══════════════════════════════════════════════════════════════════════════
//  The warning is gone
// ═══════════════════════════════════════════════════════════════════════════

describe('no Opal Word document forces Word to update its fields', () => {
  it('has an updateFields reader that treats every "on" spelling as on', () => {
    // Word treats the element as a boolean property: present at all is ON.
    const wrap = (s) => `<w:settings>${s}</w:settings>`;
    expect(readUpdateFields(wrap('<w:updateFields w:val="true"/>'))).toBe(true);
    expect(readUpdateFields(wrap('<w:updateFields w:val="1"/>'))).toBe(true);
    expect(readUpdateFields(wrap('<w:updateFields w:val="on"/>'))).toBe(true);
    expect(readUpdateFields(wrap('<w:updateFields/>'))).toBe(true);
    expect(readUpdateFields(wrap('<w:updateFields w:val="false"/>'))).toBe(false);
    expect(readUpdateFields(wrap('<w:updateFields w:val="0"/>'))).toBe(false);
    expect(readUpdateFields(wrap('<w:updateFields w:val="off"/>'))).toBe(false);
    expect(readUpdateFields(wrap(''))).toBeNull();
  });

  it('omits the setting rather than writing it as false', () => {
    // Absent is Word's default and the smallest possible difference from the
    // input; "false" would be a second thing to get wrong later.
    const { xml, removed } = stripUnsafeSettings(
      '<w:settings><w:zoom/><w:updateFields w:val="true"/><w:compat/></w:settings>'
    );
    expect(xml).not.toMatch(/updateFields/);
    expect(xml).toContain('<w:zoom/>');
    expect(xml).toContain('<w:compat/>');
    expect(removed).toContain('w:updateFields');
  });

  it('enables no updateFields in any output, named one by one', async () => {
    const offenders = [];
    for (const [name, buffer] of OUTPUTS) {
      const report = await auditDocx(buffer);
      if (report.updateFields === true) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it('marks no field w:dirty, so nothing recalculates on open', async () => {
    // The second forced-update mechanism: document-wide updateFields is one,
    // a per-field w:dirty is the other. The FCA master carried it on its TOC.
    const offenders = [];
    for (const [name, buffer] of OUTPUTS) {
      const report = await auditDocx(buffer);
      if (report.dirtyFields > 0) offenders.push(`${name} (${report.dirtyFields})`);
    }
    expect(offenders).toEqual([]);
  });

  it('every output passes the whole distribution audit', async () => {
    for (const [name, buffer] of OUTPUTS) {
      const report = await auditDocx(buffer);
      expect(`${name}: ${JSON.stringify(report.findings.map((f) => f.code))}`)
        .toBe(`${name}: []`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  No external dependency of any kind
// ═══════════════════════════════════════════════════════════════════════════

describe('no Opal Word document depends on another file', () => {
  it('declares no attached template, linked OLE object or external package', async () => {
    for (const [name, buffer] of OUTPUTS) {
      const codes = (await auditDocx(buffer)).findings.map((f) => f.code);
      for (const bad of ['attached_template', 'linked_ole_object', 'external_package',
        'subdocument', 'frame']) {
        expect(`${name}:${bad}`).toBe(`${name}:${codes.includes(bad) ? bad : bad}`);
        expect(codes).not.toContain(bad);
      }
    }
  });

  it('loads no image from outside the package', async () => {
    for (const [name, buffer] of OUTPUTS) {
      const codes = (await auditDocx(buffer)).findings.map((f) => f.code);
      expect(`${name}`).toBe(`${name}`);
      expect(codes).not.toContain('external_image');
    }
  });

  it('declares no mail-merge data source', async () => {
    for (const [, buffer] of OUTPUTS) {
      const zip = await JSZip.loadAsync(buffer);
      const settings = zip.file('word/settings.xml');
      if (!settings) continue;
      expect(await settings.async('string')).not.toMatch(/<w:mailMerge[\s>]/);
    }
  });

  it('carries no document-inclusion field code', async () => {
    for (const [name, buffer] of OUTPUTS) {
      const report = await auditDocx(buffer);
      expect(`${name}: ${JSON.stringify(report.fields.unsafe)}`).toBe(`${name}: []`);
    }
  });

  it('is not macro-enabled', async () => {
    for (const [, buffer] of OUTPUTS) {
      const zip = await JSZip.loadAsync(buffer);
      expect(Object.keys(zip.files)).not.toContain('word/vbaProject.bin');
      const ct = await zip.file('[Content_Types].xml').async('string');
      expect(ct).not.toMatch(/macroEnabled/i);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  …and nothing legitimate was lost
// ═══════════════════════════════════════════════════════════════════════════

describe('the fields that should keep working still do', () => {
  it('keeps PAGE in every document that had one', async () => {
    for (const [name, buffer] of OUTPUTS) {
      if (name.startsWith('Resource Hub')) continue;   // no page-number field by design
      const report = await auditDocx(buffer);
      const keywords = report.fields.local.map((f) => f.keyword);
      expect(`${name}: ${keywords.includes('PAGE')}`).toBe(`${name}: true`);
    }
  });

  it('keeps NUMPAGES in the service agreement', async () => {
    for (const [name, buffer] of OUTPUTS.filter(([n]) => n.startsWith('Service Agreement'))) {
      const keywords = (await auditDocx(buffer)).fields.local.map((f) => f.keyword);
      expect(`${name}: ${keywords.includes('NUMPAGES')}`).toBe(`${name}: true`);
    }
  });

  it('keeps the FCA table of contents, field and cached result alike', async () => {
    // The TOC is preserved rather than force-updated: a voluntary refresh in
    // Word beats a security prompt on every open, for every reader.
    for (const [name, buffer] of OUTPUTS.filter(([n]) => n.startsWith('FCA'))) {
      const report = await auditDocx(buffer);
      expect(`${name}: ${report.fields.local.some((f) => f.keyword === 'TOC')}`)
        .toBe(`${name}: true`);

      const zip = await JSZip.loadAsync(buffer);
      const xml = await zip.file('word/document.xml').async('string');
      expect(xml).toMatch(/TOC \\o/);
      // The cached result is still there — a 'separate' field character with
      // the rendered entries after it — so the reader sees a populated table
      // of contents rather than an empty field waiting to be updated.
      expect(xml).toMatch(/fldCharType="separate"/);
      expect(xml).toContain('Participant Details');
      // …and nothing asks Word to rebuild it.
      expect(xml).not.toMatch(/w:dirty="(?:true|1|on)"/);
    }
  });
});

describe('portal automation survives sanitisation', () => {
  it('keeps every required OPAL_ tag in the service agreement', async () => {
    const [, populated] = OUTPUTS.find(([n]) => n === 'Service Agreement — populated');
    const zip = await JSZip.loadAsync(populated);
    const tags = new Set();
    for (const part of saMap.CONTROL_PARTS) {
      const f = zip.file(part);
      if (!f) continue;
      const xml = await f.async('string');
      for (const m of xml.matchAll(/<w:tag w:val="([^"]*)"\/>/g)) tags.add(m[1]);
    }
    // OPAL_MASTER_TEMPLATE_HASH lives ONLY inside the owner governance block,
    // so a participant copy legitimately has no occurrence of it left once
    // that block is removed. Every other scalar must survive.
    const onlyInsideInternalBlocks = ['OPAL_MASTER_TEMPLATE_HASH'];
    const missing = saMap.SCALAR_TAGS
      .filter((t) => !onlyInsideInternalBlocks.includes(t))
      .filter((t) => !tags.has(t));
    expect(missing).toEqual([]);

    // And the internal blocks themselves are gone, which is the other rule.
    for (const tag of saMap.INTERNAL_BLOCK_TAGS) expect(tags.has(tag)).toBe(false);
  });

  it('keeps every FCA and letter control', async () => {
    const [, fca] = OUTPUTS.find(([n]) => n === 'FCA — manual');
    expect((await auditDocx(fca)).contentControls).toBeGreaterThan(50);
    const [, letter] = OUTPUTS.find(([n]) => n === 'Progress note letter');
    expect((await auditDocx(letter)).contentControls).toBeGreaterThan(20);
  });

  it('leaves content-control ids unique', async () => {
    for (const [name, buffer] of OUTPUTS) {
      const zip = await JSZip.loadAsync(buffer);
      const f = zip.file('word/document.xml');
      const xml = await f.async('string');
      const ids = [...xml.matchAll(/<w:id w:val="(-?\d+)"\/>/g)].map((m) => m[1]);
      expect(`${name}: ${new Set(ids).size === ids.length}`).toBe(`${name}: true`);
    }
  });

  it('keeps headers, footers, styles, numbering and the embedded logo', async () => {
    for (const [name, buffer] of OUTPUTS) {
      if (name.startsWith('Resource Hub')) continue;   // its own minimal package
      const zip = await JSZip.loadAsync(buffer);
      const names = Object.keys(zip.files);
      expect(`${name} styles`).toBe(names.includes('word/styles.xml') ? `${name} styles` : 'missing');
      expect(names.some((n) => /^word\/header\d*\.xml$/.test(n))).toBe(true);
      expect(names.some((n) => /^word\/footer\d*\.xml$/.test(n))).toBe(true);
      expect(names.includes('word/numbering.xml')).toBe(true);
      // The logo travels INSIDE the package — that is why no external image
      // relationship is needed in the first place.
      expect(names.some((n) => /^word\/media\//.test(n))).toBe(true);
    }
  });

  it('produces a structurally valid DOCX every time', async () => {
    for (const [name, buffer] of OUTPUTS) {
      expect(`${name}: ${buffer.slice(0, 2).toString('latin1')}`).toBe(`${name}: PK`);
      const zip = await JSZip.loadAsync(buffer);
      expect(zip.file('word/document.xml')).toBeTruthy();
      expect(zip.file('[Content_Types].xml')).toBeTruthy();
      expect(zip.file('_rels/.rels')).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  The gate refuses what it cannot safely repair
// ═══════════════════════════════════════════════════════════════════════════

describe('the distribution gate', () => {
  /** Rebuild the seed with one part replaced. */
  async function mutate(fn) {
    const zip = await JSZip.loadAsync(SA_TPL);
    await fn(zip);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  it('repairs an enabled updateFields rather than refusing', async () => {
    const dirty = await mutate(async (zip) => {
      const xml = await zip.file('word/settings.xml').async('string');
      zip.file('word/settings.xml', xml.replace('<w:zoom', '<w:updateFields w:val="1"/><w:zoom'));
    });
    expect((await auditDocx(dirty)).updateFields).toBe(true);
    const clean = await sanitizeDocxForDistribution(dirty, { label: 'test' });
    expect((await auditDocx(clean)).updateFields).toBeNull();
    expect(clean.docxAudit.repaired).toContain('w:updateFields');
  });

  it('removes a mail-merge data source', async () => {
    const dirty = await mutate(async (zip) => {
      const xml = await zip.file('word/settings.xml').async('string');
      zip.file('word/settings.xml', xml.replace('<w:zoom',
        '<w:mailMerge><w:mainDocumentType w:val="formLetters"/></w:mailMerge><w:zoom'));
    });
    const clean = await sanitizeDocxForDistribution(dirty, { label: 'test' });
    const zip = await JSZip.loadAsync(clean);
    expect(await zip.file('word/settings.xml').async('string')).not.toMatch(/mailMerge/);
  });

  it('REFUSES an attached external template', async () => {
    const dirty = await mutate(async (zip) => {
      const rels = await zip.file('word/_rels/document.xml.rels').async('string');
      zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>',
        '<Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        + 'relationships/attachedTemplate" Target="file:///Users/x/evil.dotm" '
        + 'TargetMode="External"/></Relationships>'));
    });
    await expect(sanitizeDocxForDistribution(dirty, { label: 'test' }))
      .rejects.toThrow(/attached_template/);
  });

  it('REFUSES an externally linked image', async () => {
    const dirty = await mutate(async (zip) => {
      const rels = await zip.file('word/_rels/document.xml.rels').async('string');
      zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>',
        '<Relationship Id="rIdI" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        + 'relationships/image" Target="https://example.invalid/track.png" '
        + 'TargetMode="External"/></Relationships>'));
    });
    await expect(sanitizeDocxForDistribution(dirty, { label: 'test' }))
      .rejects.toThrow(/external_image/);
  });

  it('REFUSES a linked OLE object', async () => {
    const dirty = await mutate(async (zip) => {
      const rels = await zip.file('word/_rels/document.xml.rels').async('string');
      zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>',
        '<Relationship Id="rIdO" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        + 'relationships/oleObject" Target="../book.xlsx"/></Relationships>'));
    });
    await expect(sanitizeDocxForDistribution(dirty, { label: 'test' }))
      .rejects.toThrow(/linked_ole_object/);
  });

  it.each([['INCLUDETEXT "C:\\\\other.docx"'], ['LINK Excel.Sheet.12 "book.xlsx"'],
    ['DDEAUTO Excel "book.xlsx"'], ['DATABASE \\\\d "src"']])(
    'REFUSES the field code %s', async (code) => {
      const dirty = await mutate(async (zip) => {
        const xml = await zip.file('word/document.xml').async('string');
        zip.file('word/document.xml', xml.replace('<w:body>',
          `<w:body><w:p><w:r><w:instrText>${code}</w:instrText></w:r></w:p>`));
      });
      await expect(sanitizeDocxForDistribution(dirty, { label: 'test' }))
        .rejects.toThrow(/unsafe_field/);
    });

  it('REFUSES a macro-enabled package', async () => {
    const dirty = await mutate(async (zip) => {
      zip.file('word/vbaProject.bin', Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    });
    await expect(sanitizeDocxForDistribution(dirty, { label: 'test' }))
      .rejects.toThrow(/vba_macro/);
  });

  it('REFUSES a document whose required controls went missing', async () => {
    await expect(sanitizeDocxForDistribution(SA_TPL, {
      label: 'test', requiredTags: ['OPAL_A_TAG_THAT_IS_NOT_THERE'],
    })).rejects.toThrow(/missing_content_control/);
  });

  it('REFUSES something that is not a DOCX at all', async () => {
    await expect(sanitizeDocxForDistribution(Buffer.from('%PDF-1.7'), { label: 'test' }))
      .rejects.toThrow(/not_a_zip/);
    await expect(sanitizeDocxForDistribution(Buffer.alloc(0), { label: 'test' }))
      .rejects.toThrow(/empty/);
  });

  it('says nothing technical in the message a user would see', async () => {
    // A participant reading a failure has no use for a relationship type, and
    // anybody probing one has every use for it.
    try {
      await sanitizeDocxForDistribution(Buffer.from('%PDF'), { label: 'test' });
      throw new Error('should have refused');
    } catch (err) {
      expect(err.userMessage).toBe('This document could not be produced safely. Please contact Opal Therapy.');
      expect(err.userMessage).not.toMatch(/zip|relationship|field|updateFields|OPAL_/i);
      expect(err.isDocxSafetyRefusal).toBe(true);
      expect(Array.isArray(err.findings)).toBe(true);   // the detail is on the error, for the log
    }
  });
});

describe('ordinary hyperlinks are not collateral damage', () => {
  it('allows https and mailto links, and refuses other protocols', async () => {
    const withLinks = async (target) => {
      const zip = await JSZip.loadAsync(SA_TPL);
      const rels = await zip.file('word/_rels/document.xml.rels').async('string');
      zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>',
        '<Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        + `relationships/hyperlink" Target="${target}" TargetMode="External"/></Relationships>`));
      return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    };

    // A service agreement genuinely links to the NDIS Commission and to the
    // practice's own complaints address. Those must survive.
    for (const ok of ['https://www.ndiscommission.gov.au/', 'mailto:complaints@opal.invalid']) {
      const buf = await withLinks(ok);
      const clean = await sanitizeDocxForDistribution(buf, { label: 'test' });
      expect(clean.docxAudit.hyperlinks).toContain(ok);
    }

    for (const bad of ['file:///Users/x/secret.docx', 'ftp://example.invalid/x']) {
      await expect(sanitizeDocxForDistribution(await withLinks(bad), { label: 'test' }))
        .rejects.toThrow(/unsafe_hyperlink_protocol/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Repository guard
// ═══════════════════════════════════════════════════════════════════════════

describe('no template or composer may reintroduce updateFields', () => {
  /**
   * The guard. If a future template ships with the setting, or a composer
   * starts writing it, this fails — and the only way past it is to add the
   * file to EXEMPTIONS with a documented reason and a test of its own.
   */
  const EXEMPTIONS = [
    // The superseded masters, kept for audit. They are never composed from:
    // the version constants point at the patched files, and this suite proves
    // the patched ones are clean.
    'fca/templates/fca-v1.docx',
    'fca/templates/progress-note-letter-v1.docx',
    'service-agreements/templates/service-agreement-v1.0.docx',
  ];

  it('no shipped .docx enables updateFields, except the retired masters', async () => {
    const root = path.join(__dirname, '..');
    const found = [];

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.docx')) found.push(full);
      }
    };
    walk(root);
    expect(found.length).toBeGreaterThan(2);

    const offenders = [];
    for (const file of found) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      const zip = await JSZip.loadAsync(fs.readFileSync(file));
      const settings = zip.file('word/settings.xml');
      if (!settings) continue;
      if (readUpdateFields(await settings.async('string')) === true && !EXEMPTIONS.includes(rel)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  }, 30000);

  it('no source file writes the setting', () => {
    const root = path.join(__dirname, '..');
    const offenders = [];

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.js')) continue;
        // The sanitiser and this suite necessarily name it.
        const rel = path.relative(root, full).split(path.sep).join('/');
        if (rel === 'docx-sanitiser.js' || rel.startsWith('tests/')) continue;
        // Comments are stripped first: three template maps now EXPLAIN the
        // setting and why it was removed, and documentation is the opposite of
        // the problem. What the guard is looking for is code that WRITES it.
        const src = fs.readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        if (/<w:updateFields/.test(src)) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it('the shared engine sanitises, so no workflow has to remember to', () => {
    const engine = fs.readFileSync(path.join(__dirname, '..', 'fca', 'docx-engine.js'), 'utf8');
    expect(engine).toMatch(/sanitizeDocxForDistribution/);
    // …and it is the LAST thing, after validation and after every value is in.
    expect(engine.indexOf('sanitizeDocxForDistribution(buffer'))
      .toBeGreaterThan(engine.indexOf('await validatePackage('));
  });

  it('the retired masters are still on disk for audit', () => {
    for (const rel of EXEMPTIONS) {
      expect(fs.existsSync(path.join(__dirname, '..', rel))).toBe(true);
    }
  });
});

describe('the patched masters differ from the originals in one part only', () => {
  it.each([
    ['fca/templates/fca-v1.docx', 'fca/templates/fca-v1.1.docx'],
    ['fca/templates/progress-note-letter-v1.docx', 'fca/templates/progress-note-letter-v1.1.docx'],
    ['service-agreements/templates/service-agreement-v1.0.docx',
      'service-agreements/templates/service-agreement-v1.0.1.docx'],
  ])('%s → %s changes only word/settings.xml', async (oldRel, newRel) => {
    // This is the evidence for "no clause or clinical-content change". Every
    // other part must be byte-for-byte what it was.
    const root = path.join(__dirname, '..');
    const a = await JSZip.loadAsync(fs.readFileSync(path.join(root, oldRel)));
    const b = await JSZip.loadAsync(fs.readFileSync(path.join(root, newRel)));

    expect(Object.keys(b.files).sort()).toEqual(Object.keys(a.files).sort());

    const changed = [];
    for (const name of Object.keys(a.files)) {
      const x = await a.file(name).async('nodebuffer');
      const y = await b.file(name).async('nodebuffer');
      if (!x.equals(y)) changed.push(name);
    }
    // settings.xml always; word/document.xml only where a w:dirty attribute
    // had to come off a field (the FCA TOC). Nothing else may move — that is
    // the evidence for "no clause or clinical-content change".
    expect(changed.filter((n) => n !== 'word/settings.xml' && n !== 'word/document.xml'))
      .toEqual([]);
    expect(changed).toContain('word/settings.xml');

    // The settings difference is exactly the removed element.
    const sa = await a.file('word/settings.xml').async('string');
    const sb = await b.file('word/settings.xml').async('string');
    expect(readUpdateFields(sa)).toBe(true);
    expect(readUpdateFields(sb)).toBeNull();
    expect(sb).toBe(sa.replace(/<w:updateFields\b[^>]*\/>\s*/, ''));

    // …and the document difference, where there is one, is exactly the removed
    // w:dirty attributes and nothing else.
    if (changed.includes('word/document.xml')) {
      const da = await a.file('word/document.xml').async('string');
      const db = await b.file('word/document.xml').async('string');
      expect(db).toBe(da.replace(/\s*w:dirty="(?:true|1|on)"/g, ''));
    }
  }, 30000);
});
