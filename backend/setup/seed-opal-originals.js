#!/usr/bin/env node
'use strict';

/**
 * Seed the FIVE approved Opal original drafts from the Resource Hub handoff
 * pack — and nothing else.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *  - It does not import the 650-record catalogue. That is an admin migration
 *    register, not hub content.
 *  - It never reads, copies, references or resolves anything under the
 *    historical source vault (`~/Documents/7 Resources`). Its only input is the
 *    handoff pack directory passed on the command line.
 *  - It does not approve, publish or widen access. Every resource lands
 *    staff-only, unpublished, in clinical review, exactly as the pack requires.
 *  - It does not invent or attach a logo. The drafts carry a typographic Opal
 *    wordmark and are recorded with brand review PENDING, which by itself is
 *    enough to block approval.
 *
 * IDEMPOTENCE
 * Resources are keyed on (organisation_id, external_ref) — the pack's stable
 * ids like 'ot-er-001' — and files on (resource_id, storage_key). Re-running
 * updates the governed fields it owns and re-verifies the bytes; it never
 * duplicates, and it never resets a reviewer's clinical/rights decision back to
 * the seed defaults once someone has moved them.
 *
 *   node backend/setup/seed-opal-originals.js --pack <dir> --dry-run
 *   node backend/setup/seed-opal-originals.js --pack <dir>
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../database');
const store = require('../resource-file-storage');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DRY = process.argv.includes('--dry-run');
const PACK = arg('--pack', null);

// The vault is out of bounds by policy, and this is the mechanical guarantee.
const FORBIDDEN = ['7 Resources', 'CLIENTS', 'paediatrics resources'];

function assertPackIsSafe(dir) {
  const abs = path.resolve(dir);
  for (const bad of FORBIDDEN) {
    if (abs.includes(bad)) {
      throw new Error(`Refusing to read from a path containing "${bad}": ${abs}`);
    }
  }
  if (!fs.existsSync(path.join(abs, '00_ADMIN', 'portal-resource-seed.json'))) {
    throw new Error(`Not a handoff pack (no 00_ADMIN/portal-resource-seed.json): ${abs}`);
  }
  return abs;
}

async function main() {
  if (!PACK) throw new Error('--pack <handoff-pack-dir> is required');
  const pack = assertPackIsSafe(PACK);

  const seed = JSON.parse(fs.readFileSync(
    path.join(pack, '00_ADMIN', 'portal-resource-seed.json'), 'utf8'));

  const org = (await pool.query(
    'SELECT id FROM organisations ORDER BY created_at LIMIT 1')).rows[0];
  if (!org) throw new Error('No organisation found');
  const owner = (await pool.query(
    `SELECT id FROM users WHERE role = 'owner' AND is_active = TRUE ORDER BY created_at LIMIT 1`)).rows[0];
  if (!owner) throw new Error('No owner user found');

  console.log(`Pack:         ${pack}`);
  console.log(`Organisation: ${org.id}`);
  console.log(`Storage root: ${store.root()}`);
  console.log(`Mode:         ${DRY ? 'DRY RUN' : 'APPLY'}\n`);

  // ── Categories ────────────────────────────────────────────────────────────
  for (const c of seed.categories) {
    if (DRY) continue;
    await pool.query(
      `INSERT INTO resource_collections (organisation_id, key, name, tagline, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,TRUE)
       ON CONFLICT DO NOTHING`,
      [org.id, c.slug, c.label, c.description || null, 1000 + (c.order || 0)]);
  }
  console.log(`Categories ensured: ${seed.categories.length}`);

  const report = [];

  for (const r of seed.resources) {
    // ── Parent resource ─────────────────────────────────────────────────────
    // COALESCE on the review fields: a reviewer who has already moved this
    // record must not be dragged back to the seed defaults by a re-run.
    const params = [
      org.id, r.id, r.slug, r.title, r.summary, r.resourceType,
      JSON.stringify(r.audiences || []), JSON.stringify([r.ageGroups || []].flat()),
      r.version, owner.id,
      JSON.stringify({
        seed: {
          source: 'opal-resource-hub handoff pack',
          packId: r.id,
          at: new Date().toISOString(),
          brandNote: 'Typographic Opal Therapy wordmark; approved logo asset not supplied.',
          note: 'Clean-room Opal original. Clinical, accessibility and brand review outstanding.',
        },
        classification: {
          sourceClass: {
            value: 'opal-original',
            method: 'handoff-pack-declared',
            confidence: 'high',
            at: new Date().toISOString(),
            by: 'seed-opal-originals.js',
          },
        },
      }),
    ];

    let resourceId = null;
    if (!DRY) {
      const { rows } = await pool.query(
        `INSERT INTO resources (
            organisation_id, external_ref, slug, title, description, resource_type,
            intended_audience, age_groups, content_version, created_by, provenance,
            status, publication_state, access_tier, source_class, rights_status,
            clinical_status, brand_review_status, source_publisher,
            authority_level, content_type, visibility)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb,
            'draft','clinical-review','staff','opal-original','opal-owned',
            'draft','pending','Opal Therapy','internal','resource','staff')
         ON CONFLICT (organisation_id, external_ref) WHERE external_ref IS NOT NULL
         DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            resource_type = EXCLUDED.resource_type,
            intended_audience = EXCLUDED.intended_audience,
            age_groups = EXCLUDED.age_groups,
            content_version = EXCLUDED.content_version,
            provenance = resources.provenance || EXCLUDED.provenance,
            source_class = 'opal-original',
            source_publisher = 'Opal Therapy',
            updated_at = NOW()
         RETURNING id, publication_state, access_tier, status`,
        params);
      resourceId = rows[0].id;
    }

    // ── Files ───────────────────────────────────────────────────────────────
    // PDF is the primary staff file. DOCX is the editable master and sits at
    // the MORE restrictive clinician tier: an editable clinical worksheet is
    // not something to hand to every staff account.
    const files = [];
    for (const f of r.files || []) {
      const src = path.join(pack, f.path);
      if (!fs.existsSync(src)) { console.log(`  ! missing in pack: ${f.path}`); continue; }
      const buf = fs.readFileSync(src);
      const original = path.basename(src);
      const key = store.buildKey(['opal-originals', r.slug, `${r.slug}-v${r.version}.${f.format}`]);
      const isPdf = f.format === 'pdf';
      const rec = {
        original,
        key,
        format: f.format,
        mime: store.mimeForFormat(f.format),
        bytes: buf.length,
        sha256: store.sha256(buf),
        tier: isPdf ? null : 'clinician',   // null = inherit (staff); DOCX narrows
        primary: isPdf,
      };
      files.push(rec);
      if (DRY) continue;

      store.put(key, buf);
      const { rows } = await pool.query(
        `INSERT INTO resource_files (
            resource_id, file_name, file_mime, file_size_bytes, storage_backend,
            storage_key, format, checksum_sha256, access_tier, is_primary, uploaded_by, uploaded_at)
         VALUES ($1,$2,$3,$4,'rhub',$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (resource_id, storage_key) WHERE storage_key IS NOT NULL
         DO UPDATE SET
            file_name = EXCLUDED.file_name,
            file_mime = EXCLUDED.file_mime,
            file_size_bytes = EXCLUDED.file_size_bytes,
            format = EXCLUDED.format,
            checksum_sha256 = EXCLUDED.checksum_sha256,
            access_tier = EXCLUDED.access_tier,
            is_primary = EXCLUDED.is_primary
         RETURNING id`,
        [resourceId, original, rec.mime, rec.bytes, key, f.format, rec.sha256,
         rec.tier, rec.primary, owner.id]);
      rec.fileId = rows[0].id;
    }

    // ── Category link ───────────────────────────────────────────────────────
    if (!DRY && r.category) {
      await pool.query(
        `INSERT INTO resource_collection_items (collection_id, resource_id, sort_order)
         SELECT c.id, $2, 0 FROM resource_collections c
          WHERE c.key = $1 AND c.organisation_id IS NOT DISTINCT FROM $3
         ON CONFLICT DO NOTHING`,
        [r.category, resourceId, org.id]);
    }

    report.push({ packId: r.id, slug: r.slug, resourceId, files });
    console.log(`${DRY ? 'would seed' : 'seeded'}  ${r.id}  ${r.slug}`);
    for (const f of files) {
      console.log(`    ${f.format.toUpperCase().padEnd(4)} ${f.primary ? 'primary' : '       '} ` +
        `tier=${f.tier || 'inherit(staff)'}  ${f.bytes} bytes  sha256=${f.sha256.slice(0, 12)}…`);
      if (f.fileId) console.log(`         fileId=${f.fileId}`);
      console.log(`         key=${f.key}`);
    }
  }

  if (!DRY) {
    const { rows: check } = await pool.query(
      `SELECT external_ref, id, status, publication_state, access_tier, clinical_status,
              brand_review_status, content_version
         FROM resources WHERE organisation_id = $1 AND external_ref = ANY($2::text[])
         ORDER BY external_ref`,
      [org.id, seed.resources.map((r) => r.id)]);
    console.log('\n── Seeded state ──');
    for (const c of check) {
      console.log(`  ${c.external_ref}  ${c.id}`);
      console.log(`     status=${c.status} publication=${c.publication_state} access=${c.access_tier} ` +
        `clinical=${c.clinical_status} brand=${c.brand_review_status} v=${c.content_version}`);
    }
    const published = check.filter((c) => c.publication_state === 'published').length;
    console.log(`\n  published: ${published} (must be 0)`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('seed failed:', err.message);
  pool.end().catch(() => {});
  process.exit(1);
});
