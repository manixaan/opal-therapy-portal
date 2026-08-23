'use strict';

/**
 * SERVICE AGREEMENT — THE TEMPLATE CONTRACT
 *
 * What this suite protects: the master Word document and the portal's map of
 * it cannot drift apart without somebody noticing.
 *
 * Every downstream promise rests on that map being true. If a tag is renamed
 * in Word and nowhere else, the field silently stops being populated and the
 * agreement ships with a blank where a price should be. If a control's w:id
 * stops being unique, cloning a support row corrupts the document. If a
 * bracketed placeholder escapes a content control into ordinary body text, no
 * code path will ever clear it and it reaches a participant.
 *
 * So the first half of this suite asserts the real v1.0 master against the
 * declared contract, and the second half deliberately BREAKS a copy of it in
 * memory and asserts the validator says so — because a validator that has
 * never rejected anything is a validator nobody has tested.
 */

const fs = require('fs');
const JSZip = require('jszip');

const map = require('../service-agreements/template-map');
const { validateMaster, _internals } = require('../service-agreements/validate-template');

const SEED = fs.readFileSync(map.SEED_TEMPLATE_FILE);

/** Load the seed, mutate word/document.xml, repackage. */
async function mutateBody(fn) {
  const zip = await JSZip.loadAsync(SEED);
  const xml = await zip.file('word/document.xml').async('string');
  zip.file('word/document.xml', fn(xml), { createFolders: false });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Remove the whole w:sdt whose OWN tag is `tag`. */
function removeControl(xml, tag) {
  const seg = _internals.sliceControl(xml, tag);
  expect(seg).not.toBe('');
  return xml.replace(seg, '');
}

let seedReport;

beforeAll(async () => {
  seedReport = await validateMaster(SEED, { strictCounts: true });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('template-map declares a self-consistent contract', () => {
  it('declares 83 scalar, 23 block and 106 unique tags', () => {
    expect(map.SCALAR_TAGS).toHaveLength(83);
    expect(map.BLOCK_TAGS).toHaveLength(23);
    expect(map.ALL_TAGS).toHaveLength(106);
    expect(new Set(map.ALL_TAGS).size).toBe(106);
  });

  it('declares 126 content-control occurrences in total', () => {
    const scalarOccurrences = map.SCALARS.reduce((n, f) => n + f.occurrences, 0);
    expect(scalarOccurrences + map.BLOCKS.length).toBe(map.EXPECTED.totalOccurrences);
    expect(map.EXPECTED.totalOccurrences).toBe(126);
  });

  it('splits Schedule A into 5 repeatable columns and 7 single detail fields', () => {
    expect(map.REPEAT_ROW_TAGS).toHaveLength(5);
    expect(map.SUPPORT_DETAIL_TAGS).toHaveLength(7);
    expect(map.SUPPORT_ROW_TAGS).toHaveLength(12);
    // No tag may be both — a detail field inside the repeat row would be
    // duplicated on every clone.
    for (const t of map.SUPPORT_DETAIL_TAGS) expect(map.REPEAT_ROW_TAGS).not.toContain(t);
  });

  it('has exactly two internal blocks, both removable', () => {
    expect(map.INTERNAL_BLOCK_TAGS).toHaveLength(2);
    expect(map.INTERNAL_BLOCK_TAGS).toEqual(
      expect.arrayContaining(['OPAL_INTERNAL_COVER_CONTROL_NOTICE', 'OPAL_INTERNAL_OWNER_GOVERNANCE'])
    );
  });

  it('gives every scalar a human-readable prompt that is never a raw placeholder', () => {
    for (const f of map.SCALARS) {
      expect(typeof f.prompt).toBe('string');
      expect(f.prompt.length).toBeGreaterThan(2);
      for (const pattern of map.FORBIDDEN_TEXT_PATTERNS) {
        expect(f.prompt).not.toMatch(pattern.re);
      }
    }
  });

  it('marks every signature as e-sign authority and refuses portal writes to it', () => {
    expect(map.SIGNATURE_TAGS.length).toBeGreaterThan(0);
    for (const tag of map.SIGNATURE_TAGS) {
      expect(map.SCALAR_BY_TAG[tag].authority).toBe(map.AUTHORITY.ESIGN);
      expect(map.writableBy(tag, map.AUTHORITY.PORTAL)).toBe(false);
      expect(map.writableBy(tag, map.AUTHORITY.ESIGN)).toBe(true);
    }
  });

  it('refuses a portal write to any owner- or server-authority field', () => {
    for (const tag of [...map.OWNER_TAGS, ...map.SERVER_TAGS]) {
      expect(map.writableBy(tag, map.AUTHORITY.PORTAL)).toBe(false);
    }
  });
});

describe('the shipped v1.0 master satisfies the contract', () => {
  it('validates, and its bytes are the bytes that were reviewed', () => {
    expect(seedReport.errors).toEqual([]);
    expect(seedReport.ok).toBe(true);
    expect(seedReport.sha256).toBe(map.SEED_TEMPLATE_SHA256);
    expect(seedReport.matchesSeedHash).toBe(true);
  });

  it('carries 126 controls: 124 in the body, 1 in the header, 1 in the footer', () => {
    expect(seedReport.counts.totalOccurrences).toBe(126);
    expect(seedReport.counts.byPart['word/document.xml']).toBe(124);
    expect(seedReport.counts.byPart['word/header6.xml']).toBe(1);
    expect(seedReport.counts.byPart['word/footer6.xml']).toBe(1);
  });

  it('carries 106 unique tags: 83 scalar, 23 block, 0 unknown', () => {
    expect(seedReport.counts.uniqueTags).toBe(106);
    expect(seedReport.counts.scalarTags).toBe(83);
    expect(seedReport.counts.blockTags).toBe(23);
    expect(seedReport.tagManifest.unknown).toEqual([]);
  });

  it('nests 81 controls inside another, 5 of them in the repeatable row', () => {
    expect(seedReport.counts.nested).toBe(81);
    expect(seedReport.counts.nestedInRepeatRow).toBe(map.EXPECTED.repeatRowControls);
    expect(seedReport.counts.nestedInRepeatRow).toBe(5);
  });

  it('populates every declared tag the exact number of times the map says', () => {
    for (const f of map.SCALARS) {
      expect(seedReport.tagManifest.scalars[f.tag]).toBe(f.occurrences);
    }
    for (const tag of map.BLOCK_TAGS) {
      expect(seedReport.tagManifest.blocks[tag]).toBe(1);
    }
  });

  it('gives every content control a unique w:id', async () => {
    const zip = await JSZip.loadAsync(SEED);
    const xml = await zip.file('word/document.xml').async('string');
    const ids = [...xml.matchAll(/<w:id w:val="(-?\d+)"\/>/g)].map((m) => m[1]);
    expect(ids).toHaveLength(124);
    expect(new Set(ids).size).toBe(124);
  });

  it('puts the agreement id in the header and the version in the footer', () => {
    // A body-only implementation would ship a running head still reading
    // "[PORTAL — AGREEMENT ID]" on every page.
    expect(map.EXPECTED.partTags['word/header6.xml']).toBe('OPAL_AGREEMENT_ID');
    expect(map.EXPECTED.partTags['word/footer6.xml']).toBe('OPAL_AGREEMENT_VERSION');
  });

  it('keeps the 7 support-detail fields OUTSIDE the repeatable row', async () => {
    const zip = await JSZip.loadAsync(SEED);
    const xml = await zip.file('word/document.xml').async('string');
    const inRow = _internals.nestedTagsUnder(xml, map.REPEAT_SUPPORT_ROW);

    expect(inRow.sort()).toEqual([...map.REPEAT_ROW_TAGS].sort());
    for (const t of map.SUPPORT_DETAIL_TAGS) expect(inRow).not.toContain(t);
  });

  it('leaves no bracketed placeholder in body text outside a content control', () => {
    // Inside a control a placeholder is the template working as designed. The
    // same string in ordinary prose is drafting debris no code path clears.
    const outsideErrors = seedReport.errors.filter((e) => e.code === 'placeholder_outside_control');
    expect(outsideErrors).toEqual([]);
  });
});

describe('the validator rejects a master that has been broken', () => {
  const cases = [
    {
      what: 'a required participant field has been deleted',
      code: 'missing_scalar_tags',
      mutate: (xml) => removeControl(xml, 'OPAL_PARTICIPANT_GOALS'),
    },
    {
      what: 'a required clause block has been deleted',
      code: 'missing_block_tags',
      mutate: (xml) => removeControl(xml, 'OPAL_CLAUSE_PRICING_PAYMENT'),
    },
    {
      what: 'the repeatable support row has been deleted',
      code: 'no_repeat_row',
      mutate: (xml) => removeControl(xml, map.REPEAT_SUPPORT_ROW),
    },
    {
      what: 'the custom-clause anchor has been deleted',
      code: 'no_custom_anchor',
      mutate: (xml) => removeControl(xml, map.CUSTOM_CLAUSE_ANCHOR),
    },
    {
      what: 'an internal governance block has been deleted',
      code: 'no_internal_block',
      mutate: (xml) => removeControl(xml, 'OPAL_INTERNAL_OWNER_GOVERNANCE'),
    },
  ];

  for (const c of cases) {
    it(`refuses it when ${c.what}`, async () => {
      const buffer = await mutateBody(c.mutate);
      const report = await validateMaster(buffer, { strictCounts: true });
      expect(report.ok).toBe(false);
      expect(report.errors.map((e) => e.code)).toContain(c.code);
    });
  }

  it('refuses a duplicated content-control id', async () => {
    // Two controls sharing an id is exactly the corruption a naive
    // cloneNode(true) leaves behind, and Word tolerates it until the next edit.
    const buffer = await mutateBody((xml) => {
      const ids = [...xml.matchAll(/<w:id w:val="(-?\d+)"\/>/g)].map((m) => m[1]);
      return xml.replace(`<w:id w:val="${ids[5]}"/>`, `<w:id w:val="${ids[0]}"/>`);
    });
    const report = await validateMaster(buffer, { strictCounts: true });
    expect(report.ok).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('duplicate_control_ids');
  });

  it('refuses a placeholder that has escaped into ordinary body text', async () => {
    const buffer = await mutateBody((xml) => xml.replace(
      '</w:body>',
      '<w:p><w:r><w:t>[PORTAL — SOMETHING NOBODY WILL EVER FILL IN]</w:t></w:r></w:p></w:body>'
    ));
    const report = await validateMaster(buffer, { strictCounts: true });
    expect(report.ok).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('placeholder_outside_control');
  });

  it('refuses a macro-bearing package', async () => {
    const zip = await JSZip.loadAsync(SEED);
    zip.file('word/vbaProject.bin', Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const report = await validateMaster(buffer);
    expect(report.ok).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('forbidden_part');
  });

  it('refuses a package that reaches out to the network for an image', async () => {
    const zip = await JSZip.loadAsync(SEED);
    const rels = await zip.file('word/_rels/document.xml.rels').async('string');
    zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>',
      '<Relationship Id="rIdEvil" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
      + 'Target="https://example.invalid/tracker.png" TargetMode="External"/></Relationships>'));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const report = await validateMaster(buffer);
    expect(report.ok).toBe(false);
    expect(report.errors.map((e) => e.code)).toEqual(
      expect.arrayContaining(['remote_image'])
    );
  });

  it('refuses an attached-template relationship', async () => {
    const zip = await JSZip.loadAsync(SEED);
    const rels = await zip.file('word/_rels/document.xml.rels').async('string');
    zip.file('word/_rels/document.xml.rels', rels.replace('</Relationships>',
      '<Relationship Id="rIdTpl" '
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" '
      + 'Target="file:///Users/somebody/evil.dotm" TargetMode="External"/></Relationships>'));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const report = await validateMaster(buffer);
    expect(report.ok).toBe(false);
    expect(report.errors.map((e) => e.code)).toContain('forbidden_relationship');
  });

  it('refuses something that is not a Word package at all', async () => {
    const notAZip = await validateMaster(Buffer.from('%PDF-1.7 this is a pdf'));
    expect(notAZip.ok).toBe(false);
    expect(notAZip.errors.map((e) => e.code)).toContain('not_a_zip');

    const empty = await validateMaster(Buffer.alloc(0));
    expect(empty.ok).toBe(false);
    expect(empty.errors.map((e) => e.code)).toContain('empty');
  });

  it('treats an unexpected extra tag as a warning, not a refusal', async () => {
    // An owner's revision that adds a control the portal does not know how to
    // populate is safe: it renders as a blank editable control.
    const buffer = await mutateBody((xml) => xml.replace('</w:body>',
      '<w:sdt><w:sdtPr><w:alias w:val="NEW"/><w:tag w:val="OPAL_SOMETHING_NEW"/>'
      + '<w:id w:val="987654"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>x</w:t></w:r></w:p>'
      + '</w:sdtContent></w:sdt></w:body>'));
    const report = await validateMaster(buffer, { strictCounts: true });
    expect(report.ok).toBe(true);
    expect(report.warnings.map((w) => w.code)).toContain('unknown_tags');
  });
});

describe('zip entry names are checked for traversal', () => {
  it('rejects an entry that escapes the package root', () => {
    expect(_internals.unsafeEntryName('../../etc/passwd')).toBeTruthy();
    expect(_internals.unsafeEntryName('/etc/passwd')).toBeTruthy();
    expect(_internals.unsafeEntryName('C:\\Windows\\system32')).toBeTruthy();
    expect(_internals.unsafeEntryName('word/document.xml')).toBeNull();
  });
});
