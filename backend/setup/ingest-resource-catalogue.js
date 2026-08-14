#!/usr/bin/env node
'use strict';

/**
 * Import the `7 Resources` catalogue into the admin ingestion register.
 *
 * This script reads ONE file: the catalogue JSON produced by the source audit.
 * It never touches the source vault. There is deliberately no fs call here that
 * points anywhere near `/Users/.../7 Resources` — the guarantee that no client
 * file was opened is structural, not procedural.
 *
 * WHAT IT DOES NOT DO
 * It does not create 650 resources. Most catalogue records must never become a
 * Resource Hub resource, so the register records the decision and stops there.
 * Resources are created only by the treatment appliers, which run separately
 * and only for treatments that permit it.
 *
 * SAFETY
 *   1. Dry run by default. --apply is required to write.
 *   2. The reconciliation total must equal the catalogue size, and the
 *      catalogue size must equal the count the catalogue itself records in its
 *      summary. A mismatch aborts before any write.
 *   3. One transaction. A failure part-way leaves the register untouched.
 *   4. Idempotent: keyed on (organisation_id, catalogue_id), so a re-run
 *      updates in place and cannot duplicate a register row or an audit event.
 *   5. The importer never stamps itself as a reviewer. reviewer_user_id stays
 *      NULL until a human decides something.
 *
 * WHERE THE CATALOGUE COMES FROM
 * It is built inside this repository, by:
 *
 *   node backend/setup/scan-resource-source.js --out build/scan.json
 *   node backend/setup/build-resource-catalogue.js --scan build/scan.json \
 *     --out backend/setup/catalogue/resource-catalogue.json
 *
 * This script used to default to an absolute path on one particular machine,
 * outside the repository, and to assert a hard-coded record count of 650 taken
 * from that one file. Between them those two facts made the register
 * unreproducible: nobody else could regenerate the input, and a regenerated
 * catalogue of any other size could never be imported. The expected size now
 * comes from the catalogue's own summary, with --expect available when the
 * operator wants to state the figure independently — which is the case that
 * actually needs a second opinion, because it is the one where a catalogue
 * might have been rebuilt against the wrong source.
 *
 *   node backend/setup/ingest-resource-catalogue.js
 *   node backend/setup/ingest-resource-catalogue.js --apply
 *   node backend/setup/ingest-resource-catalogue.js --apply --manifest out.json
 *   node backend/setup/ingest-resource-catalogue.js --catalogue other.json --expect 650
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../database');
const ing = require('../resource-ingestion');

const APPLY = process.argv.includes('--apply');

/**
 * In-repo default, written by build-resource-catalogue.js. Deliberately not a
 * committed file — it carries vault-relative paths — so a clean checkout has to
 * build one, which is the point.
 */
const DEFAULT_CATALOGUE = path.join(__dirname, 'catalogue', 'resource-catalogue.json');
// A bare `--catalogue` with no path must not fall through to the default and
// import a different file from the one the operator meant to name.
const CATALOGUE = process.argv.includes('--catalogue')
  ? (argValue('--catalogue') || '')
  : DEFAULT_CATALOGUE;
const MANIFEST = argValue('--manifest');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}

/**
 * Optional operator-supplied record count.
 *
 * A malformed --expect is rejected rather than ignored: silently dropping it
 * would turn a typo into a weaker check than the operator asked for.
 */
function expectedOverride() {
  if (!process.argv.includes('--expect')) return null;
  const raw = argValue('--expect');
  const n = Number(raw);
  // A bare `--expect` with no value counts as malformed, not as absent. Treating
  // it as absent would quietly downgrade the check the operator asked for.
  if (raw === null || raw === undefined || !Number.isInteger(n) || n <= 0) {
    throw new Error(`--expect must be a positive integer, got "${raw}".`);
  }
  return n;
}

async function resolveOrg() {
  const { rows } = await pool.query(
    'SELECT id, organisation_id FROM users WHERE email = $1', ['owner@opaltherapy.dev']);
  if (!rows.length || !rows[0].organisation_id) {
    throw new Error('Could not resolve the owner account or its organisation.');
  }
  return { orgId: rows[0].organisation_id, ownerId: rows[0].id };
}

/**
 * Everything the portal already holds, in the shape reconcile() expects.
 * Checksums come from resource_files; most resources have none, which is why a
 * checksum match is rare and a title match is only ever advisory.
 */
async function loadExisting(orgId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.title, r.source_publisher,
            COALESCE(ARRAY_AGG(f.checksum_sha256) FILTER (WHERE f.checksum_sha256 IS NOT NULL), '{}') AS checksums,
            COALESCE(ARRAY_AGG(f.file_name)       FILTER (WHERE f.file_name IS NOT NULL),       '{}') AS filenames
       FROM resources r
       LEFT JOIN resource_files f ON f.resource_id = r.id
      WHERE r.organisation_id IS NOT DISTINCT FROM $1
      GROUP BY r.id, r.title, r.source_publisher`, [orgId]);
  return rows;
}

/**
 * Read the catalogue and establish the figure everything else is checked
 * against.
 *
 * The catalogue must state its own size. That is what makes the internal
 * consistency check meaningful — a records array checked only against itself
 * proves nothing — so a catalogue with no summary.file_count is refused unless
 * the operator supplies --expect, which puts a human's figure in its place
 * rather than removing the check.
 */
function loadCatalogue(expectOverride) {
  if (!CATALOGUE) throw new Error('--catalogue was given with no path.');
  if (!fs.existsSync(CATALOGUE)) {
    throw new Error(
      `Catalogue not found: ${CATALOGUE}\n`
      + '  Build one first:\n'
      + '    node backend/setup/scan-resource-source.js --out build/scan.json\n'
      + '    node backend/setup/build-resource-catalogue.js --scan build/scan.json '
      + `--out ${DEFAULT_CATALOGUE}`);
  }
  const raw = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  const records = raw.records || [];
  if (!records.length) throw new Error('Catalogue contains no records.');

  const declared = raw.summary && raw.summary.file_count;
  if (declared && declared !== records.length) {
    throw new Error(
      `Catalogue is internally inconsistent: summary says ${declared} files, `
      + `records array holds ${records.length}. Refusing to import.`);
  }
  if (!declared && expectOverride === null) {
    throw new Error(
      'Catalogue declares no summary.file_count. Rebuild it with '
      + 'build-resource-catalogue.js, or state the expected size with --expect N.');
  }

  const expectedTotal = expectOverride === null ? declared : expectOverride;
  return { raw, records, expectedTotal };
}

function report(summary, results) {
  const pad = (n) => String(n).padStart(4);
  console.log('\n── Reconciliation dry run ─────────────────────────────────');
  console.log(`  ${pad(summary.matchedExisting)}  matched existing resources (checksum)`);
  console.log(`  ${pad(summary.possibleMatches)}  possible matches requiring human review`);
  console.log(`  ${pad(summary.newRecords)}  records not already held by the portal`);
  console.log(`  ${pad(summary.duplicates)}  duplicate copies`);
  console.log(`  ${pad(summary.excludedPrivate)}  excluded private records`);
  console.log(`  ${pad(summary.willBecomeLinks)}  will become links (no file hosted)`);
  console.log(`  ${pad(summary.willReceiveFiles)}  eligible to receive a hosted file`);

  console.log('\n── Treatment ──────────────────────────────────────────────');
  let total = 0;
  for (const [k, v] of Object.entries(summary.byTreatment)) {
    if (v) console.log(`  ${pad(v)}  ${k}`);
    total += v;
  }
  console.log(`  ${pad(total)}  TOTAL`);

  if (summary.privateChecksumCollisions.length) {
    console.log('\n  ⚠ PRIVATE FILE ALREADY IN THE PORTAL — investigate before proceeding:');
    for (const id of summary.privateChecksumCollisions) console.log(`      ${id}`);
  }

  const unmapped = results.filter((r) => !ing.TREATMENTS.includes(r.treatment));
  if (unmapped.length) throw new Error(`${unmapped.length} record(s) have an unknown treatment.`);
  return total;
}

/**
 * Upsert one register row.
 *
 * Returns what changed, so audit events describe real transitions rather than
 * restating the row on every run. The first sighting of a record emits a single
 * 'registered' event; later runs emit nothing unless a value genuinely moved.
 */
async function upsertRecord(client, orgId, result) {
  const { record, treatment, matchMethod, matchConfidence, match } = result;
  const identity = ing.redactedIdentity(record);

  const existing = await client.query(
    `SELECT id, treatment, ingestion_status, quality_status, linked_resource_id
       FROM resource_ingestion_register
      WHERE organisation_id = $1 AND catalogue_id = $2`, [orgId, record.id]);

  const ingestionStatus = ing.ingestionStatusFor(treatment);
  const qualityStatus = ing.qualityStatusFor(treatment);
  const nextAction = ing.nextActionFor(treatment);

  // A checksum match is the only evidence strong enough to link automatically.
  // Title evidence is recorded so a reviewer can see it, but links nothing.
  const linkedResourceId = matchConfidence === 'exact' && match ? match.id : null;

  const values = [
    orgId, record.id,
    identity.checksum_sha256, identity.source_reference, identity.source_filename,
    identity.extension, identity.size_bytes, identity.page_or_slide_count,
    identity.proposed_title,
    record.topic || null, record.resource_type || null,
    record.source_class || null, record.source_organisation || null,
    record.rights_status || null, record.privacy_class || null,
    record.duplicate_of || null,
    treatment, ingestionStatus, qualityStatus, nextAction,
    matchMethod, matchConfidence, linkedResourceId,
  ];

  const { rows } = await client.query(
    `INSERT INTO resource_ingestion_register (
       organisation_id, catalogue_id, checksum_sha256, source_reference, source_filename,
       extension, size_bytes, page_or_slide_count, proposed_title,
       topic, resource_type, source_class, source_organisation,
       rights_status, privacy_status, duplicate_of_catalogue_id,
       treatment, ingestion_status, quality_status, next_action,
       match_method, match_confidence, linked_resource_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     ON CONFLICT (organisation_id, catalogue_id) DO UPDATE SET
       checksum_sha256 = EXCLUDED.checksum_sha256,
       source_reference = EXCLUDED.source_reference,
       source_filename = EXCLUDED.source_filename,
       extension = EXCLUDED.extension,
       size_bytes = EXCLUDED.size_bytes,
       page_or_slide_count = EXCLUDED.page_or_slide_count,
       proposed_title = EXCLUDED.proposed_title,
       topic = EXCLUDED.topic,
       resource_type = EXCLUDED.resource_type,
       source_class = EXCLUDED.source_class,
       source_organisation = EXCLUDED.source_organisation,
       rights_status = EXCLUDED.rights_status,
       privacy_status = EXCLUDED.privacy_status,
       duplicate_of_catalogue_id = EXCLUDED.duplicate_of_catalogue_id,
       treatment = EXCLUDED.treatment,
       match_method = EXCLUDED.match_method,
       match_confidence = EXCLUDED.match_confidence,
       -- Workflow state is NOT clobbered once a human has moved it on. The
       -- importer may set the opening position; it may not undo a decision.
       ingestion_status = CASE
         WHEN resource_ingestion_register.reviewer_user_id IS NULL
           THEN EXCLUDED.ingestion_status ELSE resource_ingestion_register.ingestion_status END,
       quality_status = CASE
         WHEN resource_ingestion_register.reviewer_user_id IS NULL
           THEN EXCLUDED.quality_status ELSE resource_ingestion_register.quality_status END,
       next_action = EXCLUDED.next_action,
       linked_resource_id = COALESCE(resource_ingestion_register.linked_resource_id, EXCLUDED.linked_resource_id),
       updated_at = NOW()
     RETURNING id`, values);

  const registerId = rows[0].id;
  const before = existing.rows[0];
  const events = [];

  if (!before) {
    events.push(['registered', null, treatment, 'Imported from the 7 Resources catalogue.']);
  } else {
    if (before.treatment !== treatment) {
      events.push(['treatment', before.treatment, treatment, 'Catalogue re-import changed the treatment.']);
    }
    if (!before.linked_resource_id && linkedResourceId) {
      events.push(['linked_resource', null, linkedResourceId, 'Checksum match against an existing resource.']);
    }
  }

  for (const [field, from, to, reason] of events) {
    await client.query(
      `INSERT INTO resource_ingestion_events
         (organisation_id, register_id, catalogue_id, field, from_value, to_value, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [orgId, registerId, record.id, field, from, to, reason]);
  }

  return { registerId, created: !before, events: events.length };
}

async function main() {
  const expectOverride = expectedOverride();

  const { rows: [{ db }] } = await pool.query('SELECT current_database() AS db');
  console.log(`Database: ${db}`);
  console.log(`Catalogue: ${path.basename(CATALOGUE)}`);

  const { raw, records, expectedTotal } = loadCatalogue(expectOverride);
  console.log(`Expected records: ${expectedTotal}`
    + (expectOverride === null ? ' (from the catalogue summary)' : ' (from --expect)'));
  const { orgId } = await resolveOrg();
  const existing = await loadExisting(orgId);
  console.log(`Catalogue records: ${records.length}   Existing portal resources: ${existing.length}`);

  const results = ing.reconcile(records, existing);
  const summary = ing.summarise(results);
  const total = report(summary, results);

  // The gate. Everything must be accounted for, and the count must match the
  // catalogue's own declared figure, before a single row is written.
  if (total !== records.length) {
    throw new Error(`Treatments total ${total} but the catalogue holds ${records.length}.`);
  }
  if (records.length !== expectedTotal) {
    throw new Error(
      `Catalogue holds ${records.length} records, expected ${expectedTotal}. `
      + 'Refusing to import a catalogue of unexpected size.');
  }
  console.log(`\n✓ All ${total} records accounted for.`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  const manifest = { generatedFor: db, catalogue: CATALOGUE, total, created: 0, updated: 0, events: 0, byTreatment: summary.byTreatment, rows: [] };
  try {
    await client.query('BEGIN');
    for (const result of results) {
      const r = await upsertRecord(client, orgId, result);
      if (r.created) manifest.created += 1; else manifest.updated += 1;
      manifest.events += r.events;
      manifest.rows.push({ catalogueId: result.record.id, registerId: r.registerId, treatment: result.treatment });
    }

    const { rows: [check] } = await client.query(
      'SELECT COUNT(*)::int AS n FROM resource_ingestion_register WHERE organisation_id = $1', [orgId]);
    if (check.n !== expectedTotal) {
      throw new Error(`Register holds ${check.n} rows after import, expected ${expectedTotal}. Rolling back.`);
    }

    await client.query('COMMIT');
    console.log(`\n✓ Applied. created=${manifest.created} updated=${manifest.updated} events=${manifest.events}`);
    console.log(`✓ Register total verified inside the transaction: ${check.n}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (MANIFEST) {
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    console.log(`✓ Manifest written: ${MANIFEST}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('\ningestion failed:', err.message);
  pool.end().catch(() => {});
  process.exit(1);
});
