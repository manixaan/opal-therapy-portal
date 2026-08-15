'use strict';

/**
 * Resource Hub hosting remediation — 2026-08-15 content-evidence audit.
 *
 * The bulk import (scripts/ingest-resource-files.js, commit 14a55c0) hosted
 * every importable register row regardless of treatment, on the practice
 * owner's instruction. A content-evidence audit of the hosted bytes (regex
 * over extracted text, project detectors from setup/scan-resource-source.js,
 * and page-render review of every file with no text layer) found the register
 * treatments themselves sound, but four groups of hosted material that must
 * not stay as they are:
 *
 *  1. QUARANTINE — files whose CONTENT carries a real participant's details
 *     (populated NDIS number / person fields in an otherwise blank template).
 *     Resource → excluded-private (terminal), identifying metadata scrubbed,
 *     register → privacy-excluded, hosted bytes deleted. Vault untouched.
 *
 *  2. JUNK — Office lock files (~$…) and similar stubs that were hosted as if
 *     they were documents. File row + bytes removed, resource archived,
 *     register → rejected-quality.
 *
 *  3. CONTROLLED INSTRUMENTS — treatment 'controlled-register' means "the
 *     instrument register holds metadata; no instrument document is held".
 *     Hosting proprietary test forms contradicts the recorded rights decision,
 *     so hosted bytes are withdrawn, resources retired+archived, register
 *     returned to its canonical 'registered' status. The instrument catalogue
 *     (controlled_instruments + assessments view) remains the staff surface.
 *
 *  4. RIGHTS-REVIEW — treatment says "metadata only until authorship is
 *     evidenced". The hosted copies are KEPT for the admin review queue, but
 *     moved out of any therapist's reach: publication_state → 'rights-review'
 *     (not browsable) and access_tier → 'admin' (files unreadable below
 *     admin). A review decision can then host, link or retire each item.
 *
 * Plus an ORPHAN pass: blobs on disk with no resource_files row (failed
 * import transactions left bytes behind — 10 iCloud stubs and one over-cap
 * file). Deletion is reference-aware: a blob is only unlinked when no other
 * file row shares its storage key.
 *
 * Dry-run by default:  node backend/scripts/remediate-resource-hosting.js
 * Apply:               node backend/scripts/remediate-resource-hosting.js --apply
 *
 * Output is counts, catalogue ids and hashes only — never names, paths or
 * document contents.
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('../database');

const STORE_ROOT = process.env.RESOURCE_HUB_STORAGE_PATH
  || '/Users/antonyxavier/Documents/Opal-Resource-Store';

const APPLY = process.argv.includes('--apply');

const AUDIT_TAG = 'content-evidence audit 2026-08-15';

/**
 * Files confirmed client-confidential by the audit, addressed by register
 * catalogue id + content hash — never by name.
 */
const CONFIDENTIAL = [
  {
    catalogueId: 'res-0607',
    sha256Prefix: 'ec678f171298',
    reason: `${AUDIT_TAG}: populated participant identifiers (NDIS number and completed person fields) `
      + 'found in the hosted copy of a plan template. Hosted bytes removed; identifying metadata scrubbed; '
      + 'source vault untouched.',
  },
];

/** Hosted junk confirmed by the audit (Office lock files, stubs). */
const JUNK = [
  {
    catalogueId: 'res-0094',
    sha256Prefix: '88c6f8ebdc54',
    reason: `${AUDIT_TAG}: hosted file is an Office lock stub (~$…, 165 bytes), not a document.`,
  },
];

function resolveInStore(storageKey) {
  if (!storageKey || path.isAbsolute(storageKey) || storageKey.includes('..')) {
    throw new Error('unsafe storage key');
  }
  return path.join(STORE_ROOT, storageKey);
}

/** Delete a blob unless another file row still references the same key. */
async function deleteBlobIfUnreferenced(client, storageKey, excludingFileId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM resource_files
      WHERE storage_key = $1 AND id <> $2`, [storageKey, excludingFileId]);
  if (rows[0].n > 0) return { deleted: false, sharedBy: rows[0].n };
  const full = resolveInStore(storageKey);
  if (APPLY && fs.existsSync(full)) fs.unlinkSync(full);
  return { deleted: true };
}

async function governanceEvent(client, resource, field, from, to, reason) {
  await client.query(
    `INSERT INTO resource_governance_events
       (organisation_id, resource_id, field, from_value, to_value, reason)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [resource.organisation_id, resource.id, field, from, to, reason]);
}

async function registerEvent(client, reg, field, from, to, reason) {
  await client.query(
    `INSERT INTO resource_ingestion_events
       (organisation_id, register_id, catalogue_id, field, from_value, to_value, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [reg.organisation_id, reg.id, reg.catalogue_id, field, from, to, reason]);
}

async function loadTarget(client, catalogueId, shaPrefix) {
  const { rows } = await client.query(
    `SELECT reg.id AS reg_id, reg.organisation_id, reg.catalogue_id, reg.treatment,
            reg.ingestion_status, r.id AS resource_id, r.publication_state, r.access_tier,
            r.status, rf.id AS file_id, rf.storage_key, rf.checksum_sha256
       FROM resource_ingestion_register reg
       JOIN resources r ON r.id = reg.linked_resource_id
       JOIN resource_files rf ON rf.resource_id = r.id
      WHERE reg.catalogue_id = $1`, [catalogueId]);
  if (!rows.length) return null;
  const row = rows[0];
  if (shaPrefix && !(row.checksum_sha256 || '').startsWith(shaPrefix)) {
    throw new Error(`${catalogueId}: stored checksum does not match the audit record — refusing.`);
  }
  return row;
}

async function quarantineConfidential(stats) {
  for (const item of CONFIDENTIAL) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const t = await loadTarget(client, item.catalogueId, item.sha256Prefix);
      if (!t) { console.log(`  ${item.catalogueId}: already unlinked — skipped`); await client.query('ROLLBACK'); continue; }
      const reg = { id: t.reg_id, organisation_id: t.organisation_id, catalogue_id: t.catalogue_id };
      const resource = { id: t.resource_id, organisation_id: t.organisation_id };

      if (APPLY) {
        // 1. Terminal quarantine on the resource; identifying metadata scrubbed.
        //    A quarantined record's title alone can be a disclosure.
        await client.query(
          `UPDATE resources
              SET publication_state = 'excluded-private',
                  access_tier = 'excluded-private',
                  status = 'archived',
                  archived_at = NOW(),
                  title = $2,
                  slug = NULL,
                  description = NULL,
                  source_reference = NULL,
                  updated_at = NOW()
            WHERE id = $1`,
          [t.resource_id, `Privacy-excluded resource (${t.catalogue_id})`]);
        await governanceEvent(client, resource, 'publication_state', t.publication_state, 'excluded-private', item.reason);
        await governanceEvent(client, resource, 'access_tier', t.access_tier || 'staff', 'excluded-private', item.reason);

        // 2. File row out, bytes out (reference-aware).
        await client.query(`DELETE FROM resource_files WHERE id = $1`, [t.file_id]);
        const del = await deleteBlobIfUnreferenced(client, t.storage_key, t.file_id);
        if (!del.deleted) console.log(`  ${t.catalogue_id}: blob retained — shared by ${del.sharedBy} other file(s)`);

        // 3. Register → privacy-excluded. The schema CHECK requires every
        //    identifying field to be NULL, in the same statement.
        await client.query(
          `UPDATE resource_ingestion_register
              SET treatment = 'privacy-excluded',
                  ingestion_status = 'excluded',
                  quality_status = 'not-applicable',
                  privacy_status = 'client-identifiable',
                  next_action = 'None. Permanently excluded from the Resource Hub.',
                  checksum_sha256 = NULL, source_reference = NULL, source_filename = NULL,
                  proposed_title = NULL, official_url = NULL,
                  linked_resource_id = NULL, linked_instrument_id = NULL,
                  opal_replacement_resource_id = NULL,
                  updated_at = NOW()
            WHERE id = $1`, [t.reg_id]);
        await registerEvent(client, reg, 'treatment', t.treatment, 'privacy-excluded', item.reason);
      }
      await client.query(APPLY ? 'COMMIT' : 'ROLLBACK');
      stats.quarantined += 1;
      console.log(`  quarantined ${t.catalogue_id} (sha ${String(t.checksum_sha256).slice(0, 12)})`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      stats.failed += 1;
      console.warn(`  FAILED ${item.catalogueId}: ${err.message}`);
    } finally {
      client.release();
    }
  }
}

async function removeJunk(stats) {
  for (const item of JUNK) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const t = await loadTarget(client, item.catalogueId, item.sha256Prefix);
      if (!t) { console.log(`  ${item.catalogueId}: already unlinked — skipped`); await client.query('ROLLBACK'); continue; }
      const reg = { id: t.reg_id, organisation_id: t.organisation_id, catalogue_id: t.catalogue_id };
      const resource = { id: t.resource_id, organisation_id: t.organisation_id };

      if (APPLY) {
        await client.query(`DELETE FROM resource_files WHERE id = $1`, [t.file_id]);
        await deleteBlobIfUnreferenced(client, t.storage_key, t.file_id);
        await client.query(
          `UPDATE resources
              SET status = 'archived', archived_at = NOW(), publication_state = 'retired', updated_at = NOW()
            WHERE id = $1`, [t.resource_id]);
        await governanceEvent(client, resource, 'publication_state', t.publication_state, 'retired', item.reason);
        await client.query(
          `UPDATE resource_ingestion_register
              SET treatment = 'rejected-quality', ingestion_status = 'blocked',
                  quality_status = 'failed',
                  next_action = 'Failed a quality gate. Re-source or remediate before reconsidering.',
                  linked_resource_id = NULL,
                  updated_at = NOW()
            WHERE id = $1`, [t.reg_id]);
        await registerEvent(client, reg, 'treatment', t.treatment, 'rejected-quality', item.reason);
      }
      await client.query(APPLY ? 'COMMIT' : 'ROLLBACK');
      stats.junkRemoved += 1;
      console.log(`  junk removed ${t.catalogue_id} (sha ${String(t.checksum_sha256).slice(0, 12)})`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      stats.failed += 1;
      console.warn(`  FAILED ${item.catalogueId}: ${err.message}`);
    } finally {
      client.release();
    }
  }
}

async function withdrawControlledInstruments(stats) {
  const { rows } = await pool.query(
    `SELECT reg.id AS reg_id, reg.organisation_id, reg.catalogue_id, reg.ingestion_status,
            r.id AS resource_id, r.publication_state,
            rf.id AS file_id, rf.storage_key
       FROM resource_ingestion_register reg
       JOIN resources r ON r.id = reg.linked_resource_id
       JOIN resource_files rf ON rf.resource_id = r.id
      WHERE reg.treatment = 'controlled-register' AND rf.storage_key IS NOT NULL
      ORDER BY reg.catalogue_id`);
  const reason = `${AUDIT_TAG}: treatment 'controlled-register' holds no instrument document — `
    + 'the recorded rights decision does not permit hosting a proprietary instrument. Hosted copy '
    + 'withdrawn; the instrument register remains the staff surface.';
  for (const t of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (APPLY) {
        await client.query(`DELETE FROM resource_files WHERE id = $1`, [t.file_id]);
        await deleteBlobIfUnreferenced(client, t.storage_key, t.file_id);
        await client.query(
          `UPDATE resources
              SET status = 'archived', archived_at = NOW(), publication_state = 'retired', updated_at = NOW()
            WHERE id = $1`, [t.resource_id]);
        await governanceEvent(client, { id: t.resource_id, organisation_id: t.organisation_id },
          'publication_state', t.publication_state, 'retired', reason);
        await client.query(
          `UPDATE resource_ingestion_register
              SET ingestion_status = 'registered', updated_at = NOW()
            WHERE id = $1`, [t.reg_id]);
        await registerEvent(client, { id: t.reg_id, organisation_id: t.organisation_id, catalogue_id: t.catalogue_id },
          'ingestion_status', t.ingestion_status, 'registered', reason);
      }
      await client.query(APPLY ? 'COMMIT' : 'ROLLBACK');
      stats.controlledWithdrawn += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      stats.failed += 1;
      console.warn(`  FAILED ${t.catalogue_id}: ${err.message}`);
    } finally {
      client.release();
    }
  }
  console.log(`  controlled-instrument hosted copies withdrawn: ${stats.controlledWithdrawn}`);
}

async function restrictRightsReview(stats) {
  const reason = `${AUDIT_TAG}: treatment 'rights-review' means metadata only until authorship is `
    + 'evidenced. Hosted copy kept for the admin rights-review queue; removed from therapist reach '
    + '(publication_state rights-review, access tier admin).';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT reg.id AS reg_id, reg.organisation_id, reg.catalogue_id, reg.ingestion_status,
              r.id AS resource_id, r.publication_state, r.access_tier
         FROM resource_ingestion_register reg
         JOIN resources r ON r.id = reg.linked_resource_id
        WHERE reg.treatment = 'rights-review'
          AND (r.publication_state <> 'rights-review' OR r.access_tier <> 'admin')
        ORDER BY reg.catalogue_id`);
    for (const t of rows) {
      if (APPLY) {
        await client.query(
          `UPDATE resources
              SET publication_state = 'rights-review', access_tier = 'admin', updated_at = NOW()
            WHERE id = $1`, [t.resource_id]);
        await governanceEvent(client, { id: t.resource_id, organisation_id: t.organisation_id },
          'publication_state', t.publication_state, 'rights-review', reason);
        await governanceEvent(client, { id: t.resource_id, organisation_id: t.organisation_id },
          'access_tier', t.access_tier || 'staff', 'admin', reason);
        await client.query(
          `UPDATE resource_ingestion_register SET ingestion_status = 'held', updated_at = NOW()
            WHERE id = $1`, [t.reg_id]);
        await registerEvent(client, { id: t.reg_id, organisation_id: t.organisation_id, catalogue_id: t.catalogue_id },
          'ingestion_status', t.ingestion_status, 'held', reason);
      }
      stats.rightsRestricted += 1;
    }
    await client.query(APPLY ? 'COMMIT' : 'ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    stats.failed += 1;
    console.warn(`  FAILED rights-review restriction: ${err.message}`);
  } finally {
    client.release();
  }
  console.log(`  rights-review resources restricted to admin: ${stats.rightsRestricted}`);
}

/** Blobs on disk with no resource_files row: failed-import leftovers. */
async function removeOrphanBlobs(stats) {
  const { rows } = await pool.query(
    `SELECT storage_key FROM resource_files WHERE storage_key LIKE 'resources/%'`);
  const referenced = new Set(rows.map((r) => r.storage_key));
  const base = path.join(STORE_ROOT, 'resources');
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      const rel = path.relative(STORE_ROOT, full);
      if (!referenced.has(rel)) {
        const size = fs.statSync(full).size;
        if (APPLY) fs.unlinkSync(full);
        stats.orphansRemoved += 1;
        stats.orphanBytes += size;
      }
    }
  };
  walk(base);
  console.log(`  orphan blobs removed: ${stats.orphansRemoved} (${(stats.orphanBytes / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  console.log(`store : ${STORE_ROOT}`);
  console.log(`mode  : ${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}\n`);
  const stats = {
    quarantined: 0, junkRemoved: 0, controlledWithdrawn: 0,
    rightsRestricted: 0, orphansRemoved: 0, orphanBytes: 0, failed: 0,
  };
  console.log('1. quarantine client-confidential hosted files');
  await quarantineConfidential(stats);
  console.log('2. remove hosted junk');
  await removeJunk(stats);
  console.log('3. withdraw controlled-instrument hosted copies');
  await withdrawControlledInstruments(stats);
  console.log('4. restrict rights-review resources to the admin queue');
  await restrictRightsReview(stats);
  console.log('5. remove orphan blobs');
  await removeOrphanBlobs(stats);
  console.log(`\nsummary: ${JSON.stringify(stats)}`);
  if (stats.failed > 0) process.exitCode = 1;
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
