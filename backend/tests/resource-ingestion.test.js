'use strict';

/**
 * Unit tests for the ingestion decision logic.
 *
 * These run against the real catalogue where it is available, because the
 * headline claim — "all 650 records are accounted for" — is only worth testing
 * against the actual file. Where it is absent (a clean checkout on another
 * machine) the catalogue-dependent block is skipped and the pure-logic tests
 * still run.
 */

const fs = require('fs');
const ing = require('../resource-ingestion');
const links = require('../resource-official-links');
const instruments = require('../resource-instrument-map');
const plan = require('../resource-cleanroom-plan');

const CATALOGUE = '/Users/antonyxavier/Documents/Codex/2026-08-10/can-you-review-this-work-structure/'
  + 'outputs/opal-resource-hub/00_ADMIN/resource-catalog.json';
const haveCatalogue = fs.existsSync(CATALOGUE);
const catalogue = haveCatalogue ? JSON.parse(fs.readFileSync(CATALOGUE, 'utf8')) : null;

const record = (o = {}) => ({
  id: 'res-9999',
  source_relative_path: 'MENTAL HEALTH/example.pdf',
  source_filename: 'example.pdf',
  display_title: 'Example',
  privacy_class: 'no-obvious-pii-from-file-level-review',
  portal_action: 'hold-for-rights-review',
  ...o,
});

describe('treatment assignment', () => {
  test('every catalogue portal_action maps to a known treatment', () => {
    for (const t of Object.values(ing.TREATMENT_BY_PORTAL_ACTION)) {
      expect(ing.TREATMENTS).toContain(t);
    }
  });

  test('an unmapped portal_action throws rather than guessing', () => {
    expect(() => ing.treatmentFor(record({ portal_action: 'something-new' })))
      .toThrow(/Unmapped portal_action/);
  });

  test('a client-identifiable privacy class forces exclusion whatever the action says', () => {
    const r = record({ privacy_class: 'client-identifiable', portal_action: 'keep-reference-only-or-link-to-vendor' });
    expect(ing.treatmentFor(r)).toBe('privacy-excluded');
  });

  test.each(['CLIENTS/notes.pdf', 'paediatrics resources/x.pdf', '[PRIVATE-REDACTED]/sub/y.pdf'])(
    'a forbidden vault root forces exclusion: %s', (p) => {
      const r = record({ source_relative_path: p, portal_action: 'link-to-current-official-source-preferred' });
      expect(ing.treatmentFor(r)).toBe('privacy-excluded');
    });

  test('the two official-link actions converge on one treatment', () => {
    expect(ing.treatmentFor(record({ portal_action: 'link-to-current-official-source-preferred' })))
      .toBe('live-official-link');
    expect(ing.treatmentFor(record({ portal_action: 'official-link-preferred-pending-rights-check' })))
      .toBe('live-official-link');
  });
});

describe('redaction', () => {
  test('a private record yields no filename, path, title or checksum', () => {
    const id = ing.redactedIdentity(record({
      privacy_class: 'client-identifiable',
      portal_action: 'exclude-from-resource-hub',
      source_filename: 'Jane-Doe-assessment.pdf',
      display_title: 'Jane Doe assessment',
      sha256: 'abc123',
      source_relative_path: '[PRIVATE-REDACTED]/2024/Jane-Doe-assessment.pdf',
    }));
    expect(id.source_filename).toBeNull();
    expect(id.source_reference).toBeNull();
    expect(id.proposed_title).toBeNull();
    expect(id.checksum_sha256).toBeNull();
    expect(JSON.stringify(id)).not.toMatch(/jane/i);
  });

  test('a non-private record keeps the directory but drops the filename', () => {
    const ref = ing.redactSourceReference(record({ source_relative_path: 'PAEDS/fine motor/sheet.pdf' }));
    expect(ref).toBe('PAEDS/fine motor');
    expect(ref).not.toMatch(/sheet\.pdf/);
  });

  test('a source reference is never absolute, a traversal, or a drive letter', () => {
    for (const p of ['/etc/passwd', '~/secrets/x.pdf', '../../up.pdf', 'C:/Users/x.pdf']) {
      const ref = ing.redactSourceReference(record({ source_relative_path: p }));
      expect(ref).not.toMatch(/^[/~]/);
      expect(ref).not.toMatch(/\.\./);
      expect(ref).not.toMatch(/^[A-Za-z]:/);
    }
  });
});

describe('reconciliation', () => {
  const existing = [
    { id: 'R-sum', title: 'Checksum Match', source_publisher: 'Someone', checksums: ['deadbeef'] },
    { id: 'R-title', title: 'Shared Title', source_publisher: 'Centre for Clinical Interventions', checksums: [] },
  ];

  test('a checksum match reconciles automatically', () => {
    const [r] = ing.reconcile([record({ sha256: 'DEADBEEF' })], existing);
    expect(r.matchMethod).toBe('sha256');
    expect(r.matchConfidence).toBe('exact');
    expect(r.treatment).toBe('reconciled-existing');
    expect(r.match.id).toBe('R-sum');
  });

  test('a title match alone does NOT change the treatment', () => {
    const [r] = ing.reconcile(
      [record({ display_title: 'Shared Title', source_organisation: 'Unrelated Publisher' })], existing);
    expect(r.matchConfidence).toBe('possible');
    expect(r.treatment).toBe('rights-review');       // unchanged — a human decides
    expect(r.treatment).not.toBe('reconciled-existing');
  });

  test('title plus organisation is stronger evidence but still does not reconcile', () => {
    const [r] = ing.reconcile(
      [record({ display_title: 'Shared Title', source_organisation: 'Centre for Clinical Interventions Pty Ltd' })],
      existing);
    expect(r.matchMethod).toBe('title-and-organisation');
    expect(r.matchConfidence).toBe('probable');
    expect(r.treatment).toBe('rights-review');
  });

  test('a private record never links to portal content, even on a checksum hit', () => {
    const [r] = ing.reconcile([record({
      privacy_class: 'client-identifiable', portal_action: 'exclude-from-resource-hub', sha256: 'deadbeef',
    })], existing);
    expect(r.match).toBeNull();
    expect(r.matchMethod).toBe('none');
    // …but the collision IS surfaced, because a client file already in the hub
    // is an incident rather than a tidy cross-reference.
    expect(r.privateChecksumCollision).toBe('R-sum');
  });

  test('normalisation collapses version noise and separators', () => {
    expect(ing.normalizeTitle('report_ver_1.pdf')).toBe(ing.normalizeTitle('Report v2'));
    expect(ing.normalizeTitle('ABC-Chart.pdf')).toBe('abc chart');
  });

  test('an empty or placeholder organisation never counts as agreement', () => {
    expect(ing.normalizeOrganisation('not-yet-confirmed')).toBe('');
    expect(ing.normalizeOrganisation('Unknown')).toBe('');
  });
});

describe('derived workflow state', () => {
  test('only staff-only and clean-room treatments may host a file', () => {
    for (const t of ing.TREATMENTS) {
      const allowed = t === 'staff-only' || t === 'opal-original-draft';
      expect(ing.permitsFileHosting(t)).toBe(allowed);
    }
  });

  test('link treatments never permit file hosting', () => {
    expect(ing.permitsFileHosting('live-official-link')).toBe(false);
    expect(ing.permitsFileHosting('live-vendor-link')).toBe(false);
  });

  test('placeholders are blocked, not merely unreviewed', () => {
    expect(ing.ingestionStatusFor('unavailable-placeholder')).toBe('blocked');
    expect(ing.qualityStatusFor('unavailable-placeholder')).toBe('not-applicable');
  });

  test('private records are never queued for a quality assessment', () => {
    expect(ing.qualityStatusFor('privacy-excluded')).toBe('not-applicable');
  });
});

// ── Against the real catalogue ──────────────────────────────────────────────

(haveCatalogue ? describe : describe.skip)('the 650-record catalogue', () => {
  let results;
  let summary;

  beforeAll(() => {
    results = ing.reconcile(catalogue.records, []);
    summary = ing.summarise(results);
  });

  test('holds exactly 650 records and agrees with its own summary', () => {
    expect(catalogue.records).toHaveLength(650);
    expect(catalogue.summary.file_count).toBe(650);
  });

  test('every record receives exactly one treatment, totalling 650', () => {
    const total = Object.values(summary.byTreatment).reduce((a, b) => a + b, 0);
    expect(total).toBe(650);
    expect(summary.total).toBe(650);
  });

  test('the treatment split matches the audited group sizes', () => {
    expect(summary.byTreatment).toMatchObject({
      'live-vendor-link': 294,
      'rights-review': 152,
      'privacy-excluded': 94,
      'controlled-register': 38,
      'live-official-link': 21,          // 12 government + 9 nonprofit
      'opal-original-draft': 18,
      'duplicate-archived': 18,
      'unavailable-placeholder': 10,
      'staff-only': 5,
    });
  });

  test('no catalogue record survives redaction with an identifying field when private', () => {
    const leaking = catalogue.records
      .filter((r) => ing.isPrivate(r))
      .filter((r) => {
        const id = ing.redactedIdentity(r);
        return id.source_filename || id.proposed_title || id.source_reference || id.checksum_sha256;
      });
    expect(leaking).toHaveLength(0);
  });

  test('every duplicate record points at a master', () => {
    const dupes = catalogue.records.filter((r) => ing.treatmentFor(r) === 'duplicate-archived');
    expect(dupes).toHaveLength(18);
    for (const d of dupes) expect(d.duplicate_of).toBeTruthy();
  });

  test('the 38 controlled records all map to an instrument, with no duplicate entries', () => {
    const controlled = catalogue.records.filter((r) => ing.treatmentFor(r) === 'controlled-register');
    expect(controlled).toHaveLength(38);
    for (const r of controlled) {
      expect(instruments.RECORD_TO_INSTRUMENT[r.id]).toBeTruthy();
    }
    // Several files per instrument is expected; several entries per instrument
    // is the failure this guards against.
    const keys = new Set(Object.values(instruments.RECORD_TO_INSTRUMENT));
    const declared = instruments.NEW_INSTRUMENTS.map((i) => i.key);
    expect(new Set(declared).size).toBe(declared.length);
    for (const k of declared) expect(instruments.PRE_EXISTING_KEYS).not.toContain(k);
    expect(keys.size).toBe(declared.length + instruments.PRE_EXISTING_KEYS.length);
  });

  test('all 21 link records are either verified or explicitly unverified — none silently dropped', () => {
    const linkRecords = catalogue.records
      .filter((r) => ing.treatmentFor(r) === 'live-official-link').map((r) => r.id);
    const verified = links.verifiedCatalogueIds();
    const unverified = links.UNVERIFIED_LINKS.map((u) => u.catalogueId);
    expect(linkRecords).toHaveLength(21);
    expect(verified.length + unverified.length).toBe(21);
    for (const id of linkRecords) {
      expect(verified.includes(id) || unverified.includes(id)).toBe(true);
    }
  });

  test('every verified link is https and carries evidence', () => {
    for (const l of links.VERIFIED_LINKS) {
      expect(l.url).toMatch(/^https:\/\//);
      expect(l.publisher).toBeTruthy();
      expect(l.pageTitleSeen).toBeTruthy();
      expect(String(l.evidence).length).toBeGreaterThan(20);
    }
  });

  test('the 18 clean-room candidates all have a plan, and high-risk ones have a blocker', () => {
    const candidates = catalogue.records
      .filter((r) => ing.treatmentFor(r) === 'opal-original-draft').map((r) => r.id);
    expect(candidates).toHaveLength(18);
    expect(plan.CLEANROOM_BACKLOG).toHaveLength(18);
    for (const id of candidates) {
      expect(plan.CLEANROOM_BACKLOG.find((p) => p.catalogueId === id)).toBeTruthy();
    }
    for (const item of plan.CLEANROOM_BACKLOG) {
      expect(item.purpose.length).toBeGreaterThan(20);
      if (item.riskTier !== 'standard') {
        expect(item.authorDraft).toBe(false);
        expect(item.blocker).toMatch(/REQUIRED|RECOMMEND|OVERLAPS/);
      }
    }
  });

  test('the legal-tier item produces no draft', () => {
    const legal = plan.CLEANROOM_BACKLOG.filter((p) => p.riskTier === 'legal');
    expect(legal.length).toBeGreaterThan(0);
    for (const l of legal) expect(l.authorDraft).toBe(false);
  });

  test('315 records will become links and none of them may host a file', () => {
    expect(summary.willBecomeLinks).toBe(315);
    const hosting = results.filter((r) => ing.isLinkTreatment(r.treatment) && ing.permitsFileHosting(r.treatment));
    expect(hosting).toHaveLength(0);
  });

  test('private files were never hashed by the audit, so no collision check is possible', () => {
    const privates = catalogue.records.filter((r) => ing.isPrivate(r));
    expect(privates).toHaveLength(94);
    expect(privates.every((r) => !r.sha256)).toBe(true);
    expect(summary.privateChecksumCollisions).toHaveLength(0);
  });
});
