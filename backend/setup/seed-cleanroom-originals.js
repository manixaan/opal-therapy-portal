#!/usr/bin/env node
'use strict';

/**
 * Generate the clean-room Opal originals as branded DOCX and PDF, and register
 * them as staff-only clinical-review drafts.
 *
 * Each document is built from a spec in resource-cleanroom-content.js, which was
 * written from a clinical purpose rather than from the source document. The
 * source files were never opened — see the header of resource-cleanroom-plan.js.
 *
 * NOTHING PUBLISHES. Every resource lands on draft / clinical-review / staff
 * with clinical and brand gates pending, and a guard at the end of the
 * transaction rolls back if any of them is anywhere else.
 *
 *   node backend/setup/seed-cleanroom-originals.js            # dry run
 *   node backend/setup/seed-cleanroom-originals.js --apply
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../database');
const store = require('../resource-file-storage');
const quality = require('../resource-file-quality');
const builder = require('../opal-document-builder');
const { CLEANROOM_DOCUMENTS, DRAFT_FOOTER } = require('../resource-cleanroom-content');
const plan = require('../resource-cleanroom-plan');

const APPLY = process.argv.includes('--apply');
const OUT_DIR = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1] : null;

const DRAFT_VERSION = '0.1';

/**
 * Every string the spec asks for must survive into the rendered PDF.
 *
 * This exists because the first build silently truncated table cells mid-word —
 * the page parsed, had a text layer and passed every structural check, while
 * telling a support worker "where swallowing is unsafe — s". A gate that only
 * asks "does it render" cannot see that. Comparing intent against output can.
 */
function collectSpecStrings(spec) {
  const out = [spec.title];
  if (spec.subtitle) out.push(spec.subtitle);
  for (const s of spec.sections) {
    if (s.heading) out.push(s.heading);
    if (s.guidance) out.push(s.guidance);
    for (const p of s.paragraphs || []) out.push(p);
    for (const f of s.fields || []) out.push(f.label);
    if (s.table) {
      out.push(...s.table.headers);
      for (const row of s.table.rows) out.push(...row.filter(Boolean));
    }
  }
  for (const l of spec.limitations || []) out.push(l);
  return out.filter((s) => String(s).trim().length > 2);
}

const flatten = (s) => String(s).replace(/\s+/g, ' ').replace(/[’']/g, "'").trim();

async function verifyContentFidelity(spec, pdfBuffer) {
  const quality2 = require('../resource-file-quality');
  const inspected = await quality2.inspectPdf(pdfBuffer);
  if (!inspected.hasTextLayer) return ['PDF has no text layer to verify against.'];
  const texts = await quality2.pdfPageTexts(pdfBuffer);
  const haystack = flatten(` ${texts.join(' ')}`);
  return collectSpecStrings(spec)
    .filter((s) => !haystack.includes(flatten(s)))
    .map((s) => `Missing or truncated in PDF: "${String(s).slice(0, 60)}"`);
}

async function resolveOrg() {
  const { rows } = await pool.query(
    'SELECT id, organisation_id FROM users WHERE email = $1', ['owner@opaltherapy.dev']);
  if (!rows.length) throw new Error('Owner account not found.');
  return { orgId: rows[0].organisation_id, ownerId: rows[0].id };
}

async function main() {
  const { rows: [{ db }] } = await pool.query('SELECT current_database() AS db');
  console.log(`Database: ${db}`);

  const draftable = plan.draftable().map((d) => d.catalogueId);
  const specs = CLEANROOM_DOCUMENTS;
  const missing = draftable.filter((id) => !specs.find((s) => s.catalogueId === id));
  if (missing.length) throw new Error(`No content spec for: ${missing.join(', ')}`);
  const extra = specs.filter((s) => !draftable.includes(s.catalogueId));
  if (extra.length) {
    throw new Error(`Content written for items the plan marks not-draftable: `
      + `${extra.map((e) => e.catalogueId).join(', ')}`);
  }
  console.log(`Building ${specs.length} clean-room documents `
    + `(${plan.blocked().length} others are blocked and produce no file).\n`);

  // ── Build and gate everything before writing anything ─────────────────────
  const built = [];
  for (const spec of specs) {
    const full = { ...spec, footer: DRAFT_FOOTER };
    const docx = await builder.buildDocx(full);
    const pdf = await builder.buildPdf(full);

    const docxName = `opal-${spec.slug}-v${DRAFT_VERSION}.docx`;
    const pdfName = `opal-${spec.slug}-v${DRAFT_VERSION}.pdf`;

    const gDocx = await quality.assessFile(docx, { declaredFormat: 'docx', declaredName: docxName });
    const gPdf = await quality.assessFile(pdf, { declaredFormat: 'pdf', declaredName: pdfName });

    const fidelity = await verifyContentFidelity(full, pdf);
    const ok = gDocx.passed && gPdf.passed && fidelity.length === 0;
    console.log(`  ${ok ? '✓' : '✗'} ${spec.slug.padEnd(32)} `
      + `PDF ${String(pdf.length).padStart(6)}b ${String(gPdf.report.pageCount || 0).padStart(2)}pp  `
      + `DOCX ${String(docx.length).padStart(6)}b  fidelity ${fidelity.length ? `${fidelity.length} MISSING` : 'ok'}`);
    for (const f of [...gDocx.failures, ...gPdf.failures, ...fidelity]) console.log(`      FAIL: ${f}`);
    for (const w of [...gDocx.warnings, ...gPdf.warnings]) console.log(`      warn: ${w}`);
    if (!ok) throw new Error(`Quality gate failed for ${spec.slug}. Nothing written.`);

    built.push({ spec, docx, pdf, docxName, pdfName, gDocx, gPdf });

    if (OUT_DIR) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, docxName), docx);
      fs.writeFileSync(path.join(OUT_DIR, pdfName), pdf);
    }
  }
  console.log(`\n✓ All ${built.length * 2} generated files passed the quality gate.`);
  if (OUT_DIR) console.log(`✓ Copies written to ${OUT_DIR}`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written to the database. Re-run with --apply.');
    await pool.end();
    return;
  }

  const { orgId, ownerId } = await resolveOrg();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const b of built) {
      const { spec } = b;
      const planItem = plan.CLEANROOM_BACKLOG.find((p) => p.catalogueId === spec.catalogueId);
      const externalRef = `cleanroom:${spec.slug}`.slice(0, 80);

      const provenance = JSON.stringify({
        ingestion: 'clean-room-original',
        replacesCatalogueRecord: spec.catalogueId,
        cleanRoom: {
          sourceOpened: false,
          carriedAcross: 'general clinical purpose only',
          purpose: planItem ? planItem.purpose : null,
          method: 'Designed from first principles from the recorded purpose. No sentence, table, field '
            + 'order or layout derives from the source document.',
        },
        brand: { logoApplied: true, palette: 'FCA-aligned', logoAsset: 'opal-therapy-logo.png' },
        accessibility: {
          docx: 'heading styles, marked table header rows, image alt text, en-AU language',
          pdf: 'untagged — text layer and metadata only; not PDF/UA',
          humanReviewRequired: true,
        },
        generatedOn: '2026-08-11',
      });

      const { rows } = await client.query(
        `INSERT INTO resources (
           organisation_id, external_ref, slug, title, description, resource_type,
           content_version, provenance, created_by, source_publisher,
           status, publication_state, access_tier, source_class, rights_status,
           clinical_status, brand_review_status, authority_level, content_type,
           visibility, content_format, intended_audience, age_groups)
         VALUES ($1,$2,$3,$4,$5,'template',$6,$7::jsonb,$8,'Opal Therapy',
           'draft','clinical-review','staff','opal-original','opal-owned',
           'draft','pending','internal','resource','staff','markdown',
           '["clinician"]'::jsonb,'[]'::jsonb)
         ON CONFLICT (organisation_id, external_ref) WHERE external_ref IS NOT NULL
         DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           content_version = EXCLUDED.content_version,
           provenance = resources.provenance || EXCLUDED.provenance,
           updated_at = NOW()
         RETURNING id`,
        [orgId, externalRef, spec.slug, spec.title, spec.subtitle, DRAFT_VERSION, provenance, ownerId]);
      const resourceId = rows[0].id;

      for (const [format, buf, name, gate] of [
        ['pdf', b.pdf, b.pdfName, b.gPdf],
        ['docx', b.docx, b.docxName, b.gDocx],
      ]) {
        const key = store.buildKey(['opal-cleanroom', spec.slug, `${spec.slug}-v${DRAFT_VERSION}.${format}`]);
        store.put(key, buf);
        await client.query(
          `INSERT INTO resource_files (
             resource_id, file_name, file_mime, file_size_bytes, storage_backend,
             storage_key, format, checksum_sha256, access_tier, is_primary, uploaded_by, uploaded_at)
           VALUES ($1,$2,$3,$4,'rhub',$5,$6,$7,$8,$9,$10,NOW())
           ON CONFLICT (resource_id, storage_key) WHERE storage_key IS NOT NULL
           DO UPDATE SET
             file_size_bytes = EXCLUDED.file_size_bytes,
             checksum_sha256 = EXCLUDED.checksum_sha256,
             file_name = EXCLUDED.file_name`,
          [resourceId, name, quality.MIME_BY_FORMAT[format], buf.length, key, format,
            gate.report.checksumSha256, format === 'pdf' ? null : 'clinician', format === 'pdf', ownerId]);
      }

      await client.query(
        `UPDATE resource_cleanroom_provenance
            SET resource_id = $3, brand_gate = 'pending', accessibility_gate = 'pending', updated_at = NOW()
          WHERE organisation_id = $1 AND catalogue_id = $2`,
        [orgId, spec.catalogueId, resourceId]);

      await client.query(
        `UPDATE resource_ingestion_register
            SET opal_replacement_resource_id = $3, ingestion_status = 'imported',
                quality_status = 'pending-human',
                next_action = 'Clean-room draft generated. Clinical, brand and accessibility review required '
                  || 'before any use.', updated_at = NOW()
          WHERE organisation_id = $1 AND catalogue_id = $2`,
        [orgId, spec.catalogueId, resourceId]);
    }

    // Nothing may have escaped the staged state, and no clean-room draft may
    // have acquired an approval.
    const { rows: [guard] } = await client.query(
      `SELECT COUNT(*)::int AS bad FROM resources
        WHERE external_ref LIKE 'cleanroom:%'
          AND (status <> 'draft' OR publication_state <> 'clinical-review'
               OR access_tier <> 'staff' OR clinical_status <> 'draft'
               OR brand_review_status <> 'pending' OR approved_at IS NOT NULL)`);
    if (guard.bad) throw new Error(`${guard.bad} clean-room draft(s) are not in the staged state. Rolling back.`);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log(`\n✓ ${built.length} clean-room drafts stored as staff-only, clinical-review, unpublished.`);
  console.log('\nBlocked — no document generated, by design:');
  for (const b of plan.blocked()) {
    console.log(`  ${b.catalogueId}  ${b.riskTier.padEnd(14)} ${b.title}`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error('\nclean-room seed failed:', err.message);
  pool.end().catch(() => {});
  process.exit(1);
});
