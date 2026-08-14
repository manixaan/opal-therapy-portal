/**
 * Guards for the five-resource Opal originals seed.
 *
 * The seed writes to a live database, so these assert the properties that make
 * re-running it safe — the ON CONFLICT targets and the unique indexes they rely
 * on — plus the rules it must never break: no vault access, no auto-approval,
 * no publication, no invented logo.
 *
 * Repeatability was also verified empirically against the dev database: three
 * consecutive runs held at 5 resources / 10 files / 5 collection links with no
 * record drifting out of clinical-review.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SEED = fs.readFileSync(
  path.join(__dirname, '..', 'setup', 'seed-opal-originals.js'), 'utf8');
const MIG_024 = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '024_resource_governance.sql'), 'utf8');
const MIG_026 = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '026_resource_file_access.sql'), 'utf8');

describe('the seed cannot create duplicates', () => {
  test('resources upsert on the pack id, not on title or slug', () => {
    expect(SEED).toMatch(/ON CONFLICT \(organisation_id, external_ref\)/);
    expect(SEED).toMatch(/DO UPDATE SET/);
  });

  test('a unique index exists to make that ON CONFLICT target valid', () => {
    expect(MIG_024).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uniq_resources_external_ref/);
    expect(MIG_024).toMatch(/ON resources \(organisation_id, external_ref\) WHERE external_ref IS NOT NULL/);
  });

  test('files upsert on (resource_id, storage_key)', () => {
    expect(SEED).toMatch(/ON CONFLICT \(resource_id, storage_key\)/);
    expect(MIG_026).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uniq_resource_files_key/);
  });

  test('category links cannot duplicate', () => {
    expect(SEED).toMatch(/INSERT INTO resource_collection_items[\s\S]{0,400}ON CONFLICT DO NOTHING/);
  });

  test('only one file per resource can be primary', () => {
    expect(MIG_026).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uniq_resource_files_primary[\s\S]{0,120}WHERE is_primary/);
  });
});

describe('the seed cannot widen access or skip review', () => {
  test('resources are inserted staff-only, draft and in clinical review', () => {
    const insert = SEED.slice(SEED.indexOf('INSERT INTO resources'), SEED.indexOf('RETURNING id, publication_state'));
    expect(insert).toMatch(/'draft','clinical-review','staff'/);
    expect(insert).toMatch(/'draft','pending'/);        // clinical_status, brand_review_status
  });

  test('nothing in the seed WRITES a published or approved state', () => {
    // 'published' may legitimately appear in the post-run assertion that counts
    // published rows and expects zero, so target writes rather than the word.
    expect(SEED).not.toMatch(/publication_state\s*=\s*'published'/);
    expect(SEED).not.toMatch(/publication_state\s*=\s*'approved'/);
    expect(SEED).not.toMatch(/status\s*=\s*'approved'/);
    // and no INSERT literal list may contain them
    const values = SEED.slice(SEED.indexOf('VALUES ($1,$2'), SEED.indexOf('ON CONFLICT (organisation_id'));
    expect(values).not.toMatch(/'published'/);
    expect(values).not.toMatch(/'approved'/);
  });

  test('the only mention of published is the assertion that there are none', () => {
    const mentions = SEED.match(/.*'published'.*/g) || [];
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatch(/publication_state === 'published'/);
  });

  test('the re-run path never resets governance fields back to seed defaults', () => {
    const update = SEED.slice(SEED.indexOf('DO UPDATE SET'), SEED.indexOf('RETURNING id, publication_state'));
    // It may refresh descriptive fields...
    expect(update).toMatch(/title = EXCLUDED\.title/);
    // ...but must not drag a reviewer's decisions backwards.
    expect(update).not.toMatch(/publication_state/);
    expect(update).not.toMatch(/clinical_status/);
    expect(update).not.toMatch(/rights_status/);
    expect(update).not.toMatch(/access_tier/);
    expect(update).not.toMatch(/brand_review_status/);
  });

  test('the DOCX is registered at a more restrictive tier than the PDF', () => {
    expect(SEED).toMatch(/isPdf \? null : 'clinician'/);
    expect(SEED).toMatch(/primary: isPdf/);
  });
});

describe('the seed cannot touch the historical source vault', () => {
  test('forbidden path fragments are refused outright', () => {
    expect(SEED).toMatch(/const FORBIDDEN = \['7 Resources', 'CLIENTS', 'paediatrics resources'\]/);
    expect(SEED).toMatch(/Refusing to read from a path containing/);
  });

  test('the pack directory is the only input, and must be supplied explicitly', () => {
    expect(SEED).toMatch(/--pack <handoff-pack-dir> is required/);
    // no hard-coded absolute source path anywhere
    expect(SEED).not.toMatch(/\/Users\/[^\s'"]*7 Resources/);
  });

  test('assertPackIsSafe runs before anything is read', () => {
    const main = SEED.slice(SEED.indexOf('async function main'));
    const guard = main.indexOf('assertPackIsSafe');
    const read = main.indexOf('readFileSync');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(read);
  });
});

describe('the seed records integrity metadata and no logo', () => {
  test('checksum, size, format, MIME and original filename are all recorded', () => {
    for (const f of ['checksum_sha256', 'file_size_bytes', 'format', 'file_mime', 'file_name']) {
      expect(SEED).toContain(f);
    }
    expect(SEED).toMatch(/store\.sha256\(buf\)/);
  });

  test('storage keys are built, never taken from the pack', () => {
    expect(SEED).toMatch(/store\.buildKey\(\[/);
  });

  test('the typographic wordmark is preserved and recorded, not replaced', () => {
    expect(SEED).toMatch(/wordmark/i);
    expect(SEED).not.toMatch(/logo\.(png|svg|jpg)/i);
  });
});
