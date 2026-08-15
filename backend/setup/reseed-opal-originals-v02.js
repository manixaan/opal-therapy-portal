#!/usr/bin/env node
'use strict';

/**
 * Replace the five Opal originals' stored bytes with the branded version 0.2
 * files, preserving every identifier and every governance state.
 *
 * WHAT IS PRESERVED, AND WHY IT MATTERS
 *   resource id   — favourites, collection membership, view history and any
 *                   link a therapist has bookmarked all point at it.
 *   file id       — the download URL is /api/rh2/files/:fileId. A new id would
 *                   silently break every existing link to the file.
 *   lifecycle     — status, publication_state, access_tier, clinical_status and
 *                   brand_review_status are NOT touched. A new logo is not a
 *                   clinical review, and re-seeding must never look like one.
 *
 * The v0.1 object is left in storage under its own key. That is deliberate:
 * superseding recoverably means the previous bytes remain retrievable if the
 * new ones turn out to be wrong.
 *
 * Every file passes the quality gate BEFORE anything is written. A corrupt or
 * password-protected replacement, or one containing what looks like a client
 * identifier, aborts the whole run rather than half-replacing the set.
 *
 *   node backend/setup/reseed-opal-originals-v02.js            # dry run
 *   node backend/setup/reseed-opal-originals-v02.js --apply
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../database');
const store = require('../resource-file-storage');
const quality = require('../resource-file-quality');

const APPLY = process.argv.includes('--apply');
const PACK = process.argv.includes('--pack')
  ? process.argv[process.argv.indexOf('--pack') + 1]
  : '/Users/antonyxavier/Documents/Codex/2026-08-10/can-you-review-this-work-structure/'
    + 'outputs/opal-resource-hub/01_OPAL_ORIGINALS';

const NEW_VERSION = '0.2';

function loadManifest() {
  const p = path.join(PACK, 'opal-originals-manifest.json');
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!m.resources || m.resources.length !== 5) {
    throw new Error(`Expected 5 originals in the manifest, found ${(m.resources || []).length}.`);
  }
  for (const r of m.resources) {
    if (r.version !== NEW_VERSION) {
      throw new Error(`${r.id} is version ${r.version} in the manifest, expected ${NEW_VERSION}.`);
    }
  }
  return m;
}

async function main() {
  const { rows: [{ db }] } = await pool.query('SELECT current_database() AS db');
  console.log(`Database: ${db}`);
  const manifest = loadManifest();
  console.log(`Manifest: ${manifest.resources.length} originals at version ${NEW_VERSION}`);
  console.log(`Logo asset declared: ${manifest.official_logo_asset}\n`);

  // ── Gate every file first ─────────────────────────────────────────────────
  const planned = [];
  for (const r of manifest.resources) {
    const dir = path.join(PACK, r.category, r.slug);
    for (const format of ['pdf', 'docx']) {
      const filename = format === 'pdf' ? r.pdf_filename : r.docx_filename;
      const src = path.join(dir, filename);
      if (!fs.existsSync(src)) throw new Error(`Missing ${format} for ${r.id}: ${src}`);
      const buf = fs.readFileSync(src);

      const verdict = await quality.assessFile(buf, { declaredFormat: format, declaredName: filename });
      const flag = verdict.passed ? '✓' : '✗';
      console.log(`  ${flag} ${r.slug.padEnd(34)} ${format.toUpperCase().padEnd(4)} `
        + `${String(buf.length).padStart(7)} bytes  `
        + `${verdict.report.pageCount ? `${verdict.report.pageCount}pp  ` : ''}`
        + `sha=${verdict.report.checksumSha256.slice(0, 12)}`);
      for (const f of verdict.failures) console.log(`      FAIL: ${f}`);
      for (const w of verdict.warnings) console.log(`      warn: ${w}`);
      if (!verdict.passed) throw new Error(`Quality gate failed for ${r.slug} ${format}. Nothing written.`);

      planned.push({ resourceRef: r.id, slug: r.slug, format, filename, buf, verdict });
    }
  }
  console.log('\n✓ All 10 files passed the quality gate.');

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  const changed = [];
  try {
    await client.query('BEGIN');

    for (const r of manifest.resources) {
      const { rows: resRows } = await client.query(
        `SELECT id, status, publication_state, access_tier, clinical_status,
                brand_review_status, content_version
           FROM resources WHERE external_ref = $1`, [r.id]);
      if (!resRows.length) throw new Error(`No resource with external_ref ${r.id}.`);
      const resource = resRows[0];
      const before = { ...resource };

      for (const format of ['pdf', 'docx']) {
        const plan = planned.find((p) => p.resourceRef === r.id && p.format === format);
        // Match the EXISTING row by format so the file id survives.
        const { rows: fileRows } = await client.query(
          `SELECT id, storage_key, file_size_bytes, checksum_sha256, is_primary, access_tier
             FROM resource_files WHERE resource_id = $1 AND format = $2`, [resource.id, format]);
        if (fileRows.length !== 1) {
          throw new Error(`Expected exactly one ${format} file for ${r.slug}, found ${fileRows.length}.`);
        }
        const file = fileRows[0];
        const newKey = store.buildKey(['opal-originals', r.slug, `${r.slug}-v${NEW_VERSION}.${format}`]);
        store.put(newKey, plan.buf);

        await client.query(
          `UPDATE resource_files
              SET file_name = $2, file_mime = $3, file_size_bytes = $4,
                  storage_key = $5, checksum_sha256 = $6, uploaded_at = NOW()
            WHERE id = $1`,
          [file.id, plan.filename, quality.MIME_BY_FORMAT[format], plan.buf.length,
            newKey, plan.verdict.report.checksumSha256]);

        changed.push({
          slug: r.slug, format, fileId: file.id,
          bytesBefore: Number(file.file_size_bytes), bytesAfter: plan.buf.length,
          sha256Before: file.checksum_sha256, sha256After: plan.verdict.report.checksumSha256,
          isPrimary: file.is_primary, accessTier: file.access_tier,
          pages: plan.verdict.report.pageCount || null,
        });
      }

      // Content version and the brand note. Lifecycle columns are absent from
      // this statement on purpose — see the header.
      await client.query(
        `UPDATE resources
            SET content_version = $2,
                provenance = provenance || $3::jsonb,
                updated_at = NOW()
          WHERE id = $1`,
        [resource.id, NEW_VERSION, JSON.stringify({
          contentVersion: NEW_VERSION,
          officialLogoApplied: true,
          logoAsset: 'opal-therapy-logo.svg',
          brandPalette: r.brand_palette || null,
          reseededOn: '2026-08-11',
          brandReviewStillPending: true,
          accessibilityReviewStillPending: true,
        })]);

      const { rows: afterRows } = await client.query(
        `SELECT status, publication_state, access_tier, clinical_status, brand_review_status
           FROM resources WHERE id = $1`, [resource.id]);
      const after = afterRows[0];
      for (const col of ['status', 'publication_state', 'access_tier', 'clinical_status', 'brand_review_status']) {
        if (before[col] !== after[col]) {
          throw new Error(`Re-seed altered ${col} on ${r.slug} (${before[col]} → ${after[col]}). Rolling back.`);
        }
      }
    }

    // Nothing may have become published or left staff-only.
    const { rows: [guard] } = await client.query(
      `SELECT COUNT(*)::int AS bad FROM resources
        WHERE source_class = 'opal-original' AND content_version = $1
          AND (publication_state <> 'clinical-review' OR status <> 'draft' OR access_tier <> 'staff')`,
      [NEW_VERSION]);
    if (guard.bad) throw new Error(`${guard.bad} original(s) left the staged state. Rolling back.`);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log('\n── Re-seeded ──────────────────────────────────────────────');
  for (const c of changed) {
    console.log(`  ${c.slug.padEnd(34)} ${c.format.toUpperCase().padEnd(4)} `
      + `${c.isPrimary ? 'primary  ' : 'secondary'} tier=${c.accessTier || 'inherit(staff)'}`);
    console.log(`      bytes  ${c.bytesBefore} → ${c.bytesAfter}`);
    console.log(`      sha256 ${String(c.sha256Before).slice(0, 16)} → ${c.sha256After.slice(0, 16)}`);
    console.log(`      fileId ${c.fileId} (unchanged)`);
  }
  console.log('\n  Lifecycle verified unchanged: draft / clinical-review / staff.');
  await pool.end();
}

main().catch((err) => {
  console.error('\nre-seed failed:', err.message);
  pool.end().catch(() => {});
  process.exit(1);
});
