'use strict';

/**
 * The joint between the source scan and the ingestion importer.
 *
 * `build-resource-catalogue.js` is the only thing standing between a scanner
 * that speaks camelCase evidence and an importer that speaks snake_case risk.
 * Two properties matter more than the field mapping itself:
 *
 *   1. Every record it emits must be one `treatmentFor()` can decide on. That
 *      function throws on an unmapped portal_action rather than guessing, so a
 *      single untranslatable record would abort a whole import part-way. The
 *      tests below therefore import the REAL function and run it over the real
 *      output, rather than re-asserting a copy of the mapping table.
 *   2. A flagged record must arrive private and empty-handed. The scanner
 *      already strips identity before it writes; these tests hand the builder
 *      scan records that have NOT been stripped, because the guarantee worth
 *      testing is the one that holds when the upstream pass failed.
 *
 * The fixtures are synthetic and built inline. Nothing here reads the vault: a
 * unit test that needed a client file present in order to prove that client
 * files are excluded would be its own counter-argument.
 */

const build = require('../setup/build-resource-catalogue');
const ing = require('../resource-ingestion');

/**
 * The client root, taken from the denylist under test rather than typed out.
 *
 * Two reasons. A fixture built from the constant follows it if the denylist
 * ever changes, and a test file that contains no literal client path cannot
 * itself become the thing `resource-privacy-leak.test.js` is looking for.
 */
const CLIENT_ROOT = ing.FORBIDDEN_PATH_PREFIXES[0];

/** A minimal, deliberately un-redacted scan record. */
const scanRecord = (o = {}) => ({
  id: 'src-000000000001',
  relativePath: 'MENTAL HEALTH/anxiety/worksheet.pdf',
  sourceFilename: 'worksheet.pdf',
  displayTitle: 'Worksheet',
  extension: 'pdf',
  sizeBytes: 4096,
  pageCount: 2,
  sha256: 'a'.repeat(64),
  privacyEvidence: 'no-obvious-pii',
  piiSignals: {},
  piiStrongCount: 0,
  piiWeakCount: 0,
  contactDetailCount: 0,
  ...o,
});

const scan = (records, summary = {}) => ({
  schema_version: '1.1',
  summary: { file_count: records.length, scanner: 'test', ...summary },
  records,
});

const byId = (catalogue, id) => catalogue.records.find((r) => r.id === id);

// ── The contract with the importer ──────────────────────────────────────────

describe('every emitted record is one the importer can decide on', () => {
  const records = [
    scanRecord({ id: 'src-ordinary0001' }),
    scanRecord({ id: 'src-confidenti01', privacyClass: 'client-confidential', relativePath: `${CLIENT_ROOT}A/plan.pdf` }),
    scanRecord({ id: 'src-privreview01', privacyClass: 'privacy-review' }),
    scanRecord({ id: 'src-icloudstub01', excludeReason: 'icloud-placeholder', extension: 'icloud', sha256: undefined }),
    scanRecord({ id: 'src-junkartefac1', excludeReason: 'system-artifact', sha256: undefined }),
    scanRecord({ id: 'src-unreadable01', excludeReason: 'unreadable', error: 'read: EACCES', sha256: undefined }),
    scanRecord({ id: 'src-master00001', relativePath: 'ADL/master.pdf', sha256: 'b'.repeat(64), isCanonicalCopy: true, duplicateGroupSize: 2 }),
    scanRecord({ id: 'src-copy00000001', relativePath: 'ADL/copies/master.pdf', sha256: 'b'.repeat(64), isCanonicalCopy: false, duplicateOfPath: 'ADL/master.pdf', duplicateGroupSize: 2 }),
    scanRecord({ id: 'src-rescued00001', privacyClass: 'client-path-generic-duplicate', relativePath: `${CLIENT_ROOT}…`, usesSafeCopyAt: 'ADL/master.pdf', sourceFilename: null, displayTitle: null }),
  ];
  const catalogue = build.buildCatalogue(scan(records));

  test('treatmentFor() accepts every record, and none falls through to a guess', () => {
    expect(catalogue.records).toHaveLength(records.length);
    for (const record of catalogue.records) {
      const treatment = ing.treatmentFor(record);   // throws if unmapped
      expect(ing.TREATMENTS).toContain(treatment);
    }
  });

  test('every portal_action emitted is a key the importer actually maps', () => {
    const emitted = new Set(catalogue.records.map((r) => r.portal_action));
    expect(emitted.size).toBeGreaterThan(1);
    for (const action of emitted) {
      expect(Object.keys(ing.TREATMENT_BY_PORTAL_ACTION)).toContain(action);
    }
  });

  test('the summary states the size the importer will check it against', () => {
    expect(catalogue.summary.file_count).toBe(catalogue.records.length);
  });

  test('reconciliation accounts for every record exactly once', () => {
    const summary = ing.summarise(ing.reconcile(catalogue.records, []));
    const total = Object.values(summary.byTreatment).reduce((a, b) => a + b, 0);
    expect(total).toBe(catalogue.records.length);
  });

  test('an unmapped action would be caught at build time, not at import time', () => {
    // Proves the build-time gate is load-bearing rather than decorative: a
    // record the importer cannot decide on stops the build.
    const broken = build.buildCatalogue(scan([scanRecord()]));
    broken.records[0].portal_action = 'something-nobody-mapped';
    expect(() => build.assertTranslatable(broken.records)).toThrow(/Unmapped portal_action/);
  });

  test('an ordinary record goes to a human, carrying no invented classification', () => {
    const r = byId(catalogue, 'src-ordinary0001');
    expect(r.portal_action).toBe('hold-for-rights-review');
    expect(ing.treatmentFor(r)).toBe('rights-review');
    // The scanner cannot know any of these, so it must not claim them.
    expect(r.topic).toBeNull();
    expect(r.resource_type).toBeNull();
    expect(r.source_class).toBeNull();
    expect(r.source_organisation).toBeNull();
    // …and the rights position is recorded as unreviewed, never as a licence.
    expect(r.rights_status).toBe('not-reviewed');
    expect(ing.permitsFileHosting(ing.treatmentFor(r))).toBe(false);
  });

  test('a duplicate is archived only when its master is in the catalogue', () => {
    const copy = byId(catalogue, 'src-copy00000001');
    expect(copy.duplicate_of).toBe('src-master00001');
    expect(ing.treatmentFor(copy)).toBe('duplicate-archived');
  });

  test('a duplicate whose master is absent goes to review rather than claiming one', () => {
    const orphan = build.buildCatalogue(scan([
      scanRecord({ id: 'src-orphan000001', isCanonicalCopy: false, duplicateOfPath: 'NOT/IN/THE/SCAN.pdf' }),
    ]));
    expect(orphan.records[0].duplicate_of).toBeNull();
    expect(orphan.records[0].portal_action).toBe('hold-for-rights-review');
  });

  test('an iCloud stub is blocked as unavailable, not reviewed as if it were there', () => {
    const stub = byId(catalogue, 'src-icloudstub01');
    expect(ing.ingestionStatusFor(ing.treatmentFor(stub))).toBe('blocked');
  });
});

// ── Privacy ─────────────────────────────────────────────────────────────────

describe('a flagged scan record becomes a private catalogue record', () => {
  test('client-confidential yields a private record with no identity at all', () => {
    // Handed to the builder WITH its identity intact, which is the case the
    // scanner is supposed to have already prevented.
    const catalogue = build.buildCatalogue(scan([scanRecord({
      id: 'src-leaky0000001',
      privacyClass: 'client-confidential',
      relativePath: `${CLIENT_ROOT}Household/assessment-summary.pdf`,
      sourceFilename: 'assessment-summary.pdf',
      displayTitle: 'Assessment Summary',
      sha256: 'c'.repeat(64),
    })]));
    const record = catalogue.records[0];

    expect(ing.PRIVATE_PRIVACY_CLASSES).toContain(record.privacy_class);
    expect(ing.isPrivate(record)).toBe(true);
    expect(ing.treatmentFor(record)).toBe('privacy-excluded');

    expect(record.source_filename).toBeNull();
    expect(record.display_title).toBeNull();
    expect(record.sha256).toBeNull();
    expect(record.rights_status).toBeNull();
    expect(record.source_relative_path).not.toMatch(/assessment-summary/);

    // And nothing survives into the register row either.
    const identity = ing.redactedIdentity(record);
    expect(identity.source_filename).toBeNull();
    expect(identity.proposed_title).toBeNull();
    expect(identity.checksum_sha256).toBeNull();
    expect(identity.source_reference).toBeNull();
  });

  test('privacy-review is private too — weak evidence quarantines, it does not publish', () => {
    const catalogue = build.buildCatalogue(scan([scanRecord({
      id: 'src-weakflag0001',
      privacyClass: 'privacy-review',
      relativePath: 'PAEDS/fine motor/checklist.pdf',
      sourceFilename: 'checklist.pdf',
      displayTitle: 'Checklist',
      sha256: 'd'.repeat(64),
    })]));
    const record = catalogue.records[0];

    expect(ing.PRIVATE_PRIVACY_CLASSES).toContain(record.privacy_class);
    expect(ing.treatmentFor(record)).toBe('privacy-excluded');
    expect(record.portal_action).toBe('exclude-from-resource-hub');
    expect(record.source_filename).toBeNull();
    expect(record.display_title).toBeNull();
    expect(record.sha256).toBeNull();
    // The containing folder survives, so a reviewer can still find the file.
    expect(record.source_relative_path).toBe('PAEDS/fine motor/…');
  });

  test('both of the scanner\'s flagged classes land inside the importer\'s private set', () => {
    for (const scannerClass of ['client-confidential', 'privacy-review']) {
      expect(ing.PRIVATE_PRIVACY_CLASSES)
        .toContain(build.PRIVACY_CLASS_BY_SCAN_CLASS[scannerClass]);
    }
  });

  test('a rescued generic duplicate is still excluded, and points at the safe copy', () => {
    const catalogue = build.buildCatalogue(scan([scanRecord({
      id: 'src-rescued00002',
      privacyClass: 'client-path-generic-duplicate',
      relativePath: `${CLIENT_ROOT}…`,
      sourceFilename: null,
      displayTitle: null,
      usesSafeCopyAt: 'ADL/master.pdf',
    })]));
    const record = catalogue.records[0];
    expect(ing.treatmentFor(record)).toBe('privacy-excluded');
    expect(record.scan_evidence.uses_safe_copy_at).toBe('ADL/master.pdf');
  });

  test('a forbidden vault root excludes a record the scan called clean', () => {
    // The record claims no PII. Where it sits overrides what it claims.
    const catalogue = build.buildCatalogue(scan([scanRecord({
      id: 'src-forbidden001',
      relativePath: 'paediatrics resources/notes.pdf',
      privacyEvidence: 'no-obvious-pii',
    })]));
    const record = catalogue.records[0];
    expect(ing.treatmentFor(record)).toBe('privacy-excluded');
    expect(record.source_filename).toBeNull();
    expect(record.sha256).toBeNull();
  });

  test('an unassessed record is not recorded as though it had been cleared', () => {
    const catalogue = build.buildCatalogue(scan([
      scanRecord({ id: 'src-noassess0001', privacyEvidence: undefined, excludeReason: 'system-artifact' }),
    ]));
    expect(catalogue.records[0].privacy_class).toBe(build.PRIVACY_CLASS_UNASSESSED);
    expect(ing.PRIVATE_PRIVACY_CLASSES).not.toContain(build.PRIVACY_CLASS_UNASSESSED);
    expect(catalogue.records[0].portal_action).toBe('hold-for-rights-review');
  });

  test('the build refuses to emit a private record that kept an identifying field', () => {
    const catalogue = build.buildCatalogue(scan([scanRecord({
      id: 'src-tampered0001', privacyClass: 'client-confidential',
    })]));
    catalogue.records[0].display_title = 'Something Identifying';
    expect(() => build.assertTranslatable(catalogue.records))
      .toThrow(/still carry an identifying field/);
  });

  test('no document author or company is carried into the catalogue', () => {
    // A dc:creator value is evidence, not a licence, and on a personal file it
    // is frequently a person. It is dropped rather than promoted.
    const catalogue = build.buildCatalogue(scan([scanRecord({
      documentAuthor: 'A Person', documentCompany: 'Some Publisher',
    })]));
    expect(JSON.stringify(catalogue)).not.toMatch(/A Person|Some Publisher/);
    expect(catalogue.records[0].source_organisation).toBeNull();
  });
});

// ── Determinism ─────────────────────────────────────────────────────────────

describe('ids are stable', () => {
  const records = [
    scanRecord({ id: 'src-stable000001' }),
    scanRecord({ id: 'src-stable000002', relativePath: 'ADL/second.pdf', sourceFilename: 'second.pdf' }),
    scanRecord({ id: 'src-stable000003', relativePath: 'ADL/third.pdf', sourceFilename: 'third.pdf' }),
  ];

  test('the same scan yields the same ids twice', () => {
    const first = build.buildCatalogue(scan(records));
    const second = build.buildCatalogue(scan(records));
    expect(second.records.map((r) => r.id)).toEqual(first.records.map((r) => r.id));
  });

  test('the same scan yields byte-identical records twice', () => {
    // Ordering is part of the guarantee: a catalogue whose records shuffled
    // between builds would produce a meaningless diff on every regeneration.
    const first = build.buildCatalogue(scan(records));
    const second = build.buildCatalogue(scan(records));
    expect(JSON.stringify(second.records)).toBe(JSON.stringify(first.records));
  });

  test('an id follows its file, not its position in the scan', () => {
    const before = build.buildCatalogue(scan(records));
    const after = build.buildCatalogue(scan([
      scanRecord({ id: 'src-inserted0001', relativePath: 'ADL/inserted.pdf' }),
      ...records,
    ]));
    const target = byId(before, 'src-stable000002');
    expect(byId(after, 'src-stable000002').source_relative_path)
      .toBe(target.source_relative_path);
  });

  test('a scan record with no id gets a deterministic one derived from its path', () => {
    const shaped = { relativePath: 'ADL/no-id.pdf', sourceFilename: 'no-id.pdf', extension: 'pdf' };
    const a = build.catalogueIdFor(shaped);
    const b = build.catalogueIdFor({ ...shaped });
    expect(a).toBe(b);
    expect(a).toMatch(/^src-[0-9a-f]{12}$/);
    // Different file, different id.
    expect(build.catalogueIdFor({ relativePath: 'ADL/other.pdf' })).not.toBe(a);
  });

  test('every id fits the register column that has to store it', () => {
    const catalogue = build.buildCatalogue(scan(records));
    for (const r of catalogue.records) expect(r.id.length).toBeLessThanOrEqual(20);
  });

  test('a colliding id stops the build rather than merging two documents', () => {
    expect(() => build.buildCatalogue(scan([
      scanRecord({ id: 'src-same00000001', relativePath: 'ADL/one.pdf' }),
      scanRecord({ id: 'src-same00000001', relativePath: 'ADL/two.pdf' }),
    ]))).toThrow(/Duplicate catalogue id/);
  });
});

// ── Path redaction ──────────────────────────────────────────────────────────

describe('path redaction', () => {
  test('the basename goes, the containing folder stays', () => {
    expect(build.redactPath('PAEDS/SENSORY/child-name.pdf')).toBe('PAEDS/SENSORY/…');
  });

  test('redacting an already-redacted path changes nothing', () => {
    const once = build.redactPath('PAEDS/SENSORY/x.pdf');
    expect(build.redactPath(once)).toBe(once);
    expect(build.redactPath(`${CLIENT_ROOT}…`)).toBe(`${CLIENT_ROOT}…`);
  });

  test('a vault-root file redacts to the marker alone, never to a filename', () => {
    expect(build.redactPath('loose-file.pdf')).toBe('…');
  });

  test('an oddly-shaped path still satisfies the register\'s shape constraint', () => {
    // migration 030 rejects an absolute path, a traversal or a drive letter, and
    // a rejected row aborts the whole import transaction. Scan paths are data,
    // so the builder must not be the reason one gets that far.
    for (const p of ['/etc/passwd', '~/secret/x.pdf', '../../up.pdf', 'C:/x/y.pdf']) {
      const open = build.buildCatalogue(scan([scanRecord({ id: 'src-oddpath00001', relativePath: p })]));
      const ref = ing.redactedIdentity(open.records[0]).source_reference;
      expect(ref).not.toBeNull();
      expect(ref).not.toMatch(/^[/~]/);
      expect(ref).not.toMatch(/\.\./);
      expect(ref).not.toMatch(/^[A-Za-z]:/);

      const flagged = build.buildCatalogue(scan([scanRecord({
        id: 'src-oddpath00002', relativePath: p, privacyClass: 'privacy-review',
      })]));
      expect(ing.redactedIdentity(flagged.records[0]).source_reference).toBeNull();
    }
  });
});

// ── Input validation ────────────────────────────────────────────────────────

describe('the builder refuses input it cannot vouch for', () => {
  test('a scan with no records array is rejected', () => {
    expect(() => build.buildCatalogue({ schema_version: '1.1', summary: {} }))
      .toThrow(/no records array/);
  });

  test('an empty scan is rejected rather than producing an empty catalogue', () => {
    expect(() => build.buildCatalogue(scan([]))).toThrow(/no records/);
  });

  test('an ambiguous duplicate master resolves to none, not to a coin toss', () => {
    // Two scan records claiming the same path cannot both be the master.
    const index = build.buildPathIndex([
      { relativePath: 'ADL/master.pdf', id: 'src-one000000001' },
      { relativePath: 'ADL/master.pdf', id: 'src-two000000001' },
    ]);
    expect(index.get('ADL/master.pdf')).toBeUndefined();
  });

  test('a redacted path is never used as a duplicate master address', () => {
    const index = build.buildPathIndex([{ relativePath: `${CLIENT_ROOT}…`, id: 'src-redacted0001' }]);
    expect(index.size).toBe(0);
  });
});
