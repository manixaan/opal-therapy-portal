#!/usr/bin/env node
'use strict';

/**
 * Apply the treatment matrix to the ingestion register.
 *
 * Runs after ingest-resource-catalogue.js, which registers all 650 records.
 * This script acts on the subset of treatments that produce something beyond a
 * register row: official links become resources, controlled instruments become
 * register entries, clean-room candidates get provenance records.
 *
 * The large treatments deliberately do nothing here. 294 vendor references, 152
 * rights-review items, 94 private records, 18 duplicates and 10 placeholders
 * are already fully accounted for by their register row — creating anything
 * further for them would be creating something that must not exist.
 *
 * NO FILE IS EVER COPIED BY THIS SCRIPT. It reads no vault path and writes no
 * resource_files row. Hosted files arrive only through the separate Opal
 * originals seeder, whose inputs are Opal's own documents.
 *
 *   node backend/setup/apply-resource-treatments.js            # dry run
 *   node backend/setup/apply-resource-treatments.js --apply
 */

require('dotenv').config();
const { pool } = require('../database');
const links = require('../resource-official-links');
const instruments = require('../resource-instrument-map');
const cleanroom = require('../resource-cleanroom-plan');

const APPLY = process.argv.includes('--apply');
const counts = {
  linkResources: 0, linkRecords: 0, linkUnverified: 0,
  instrumentsCreated: 0, instrumentsExisting: 0, instrumentRecords: 0,
  internalHeld: 0, cleanroomPlanned: 0,
  vendorQueued: 0, rightsHeld: 0, privateExcluded: 0, duplicates: 0, placeholders: 0,
};

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 150);
}

async function resolveOrg() {
  const { rows } = await pool.query(
    'SELECT id, organisation_id FROM users WHERE email = $1', ['owner@opaltherapy.dev']);
  if (!rows.length) throw new Error('Owner account not found.');
  return { orgId: rows[0].organisation_id, ownerId: rows[0].id };
}

/**
 * Audit values are varchar(120) and some canonical URLs are longer. The full
 * URL lives in the register's `official_url` column and in the event reason;
 * this only shortens the at-a-glance label, and marks it so a truncated value
 * is never mistaken for the address itself.
 */
function eventValue(v) {
  if (v == null) return null;
  const s = String(v);
  return s.length <= 120 ? s : `${s.slice(0, 117)}...`;
}

async function setRegister(client, orgId, catalogueId, patch, event) {
  const sets = [];
  const params = [orgId, catalogueId];
  for (const [col, val] of Object.entries(patch)) {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  }
  sets.push('updated_at = NOW()');
  const { rows } = await client.query(
    `UPDATE resource_ingestion_register SET ${sets.join(', ')}
      WHERE organisation_id = $1 AND catalogue_id = $2 RETURNING id`, params);
  if (!rows.length) throw new Error(`Register row missing for ${catalogueId}. Run the ingestion first.`);
  if (event) {
    await client.query(
      `INSERT INTO resource_ingestion_events
         (organisation_id, register_id, catalogue_id, field, from_value, to_value, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [orgId, rows[0].id, catalogueId, event.field,
        eventValue(event.from), eventValue(event.to), event.reason]);
  }
  return rows[0].id;
}

// ── A + B — official and nonprofit links ────────────────────────────────────
//
// One resource per VERIFIED PAGE, not per catalogue record. Three catalogued
// copies of the CCI distress workbook are three copies of one publication, and
// creating three resources would put three identical links in the library.

async function applyLinks(client, orgId, ownerId) {
  for (const link of links.VERIFIED_LINKS) {
    const externalRef = `ingest:link:${slugify(link.title)}`.slice(0, 80);
    const provenance = JSON.stringify({
      ingestion: 'official-link',
      catalogueIds: link.catalogueIds,
      pageTitleSeen: link.pageTitleSeen,
      publisherCopyrightSeen: link.copyrightSeen,
      evidence: link.evidence,
      verifiedOn: links.CHECKED_ON,
      supersedesLocalCopy: !!link.supersedesLocalCopy,
      localCopyHosted: false,
    });

    const { rows } = await client.query(
      `INSERT INTO resources (
         organisation_id, external_ref, slug, title, description, resource_type,
         external_url, source_publisher, source_title, source_verified_at,
         link_status, link_checked_at, review_due_at, provenance, created_by,
         status, publication_state, access_tier, source_class, rights_status,
         clinical_status, brand_review_status, authority_level, content_type,
         visibility, content_format)
       VALUES ($1,$2,$3,$4,$5,'link',$6,$7,$8,$9,'ok',NOW(),$10,$11::jsonb,$12,
         'approved','approved','staff',$13,'official-link-only',
         'unreviewed','not-required','external','resource','staff','markdown')
       ON CONFLICT (organisation_id, external_ref) WHERE external_ref IS NOT NULL
       DO UPDATE SET
         title = EXCLUDED.title,
         external_url = EXCLUDED.external_url,
         source_publisher = EXCLUDED.source_publisher,
         source_verified_at = EXCLUDED.source_verified_at,
         link_status = 'ok',
         link_checked_at = NOW(),
         review_due_at = EXCLUDED.review_due_at,
         provenance = resources.provenance || EXCLUDED.provenance,
         updated_at = NOW()
       RETURNING id`,
      [orgId, externalRef, slugify(link.title), link.title,
        `${link.publisherLong}. Opal links to the publisher's own page rather than hosting a copy.`,
        link.url, link.publisherLong, link.pageTitleSeen, links.CHECKED_ON,
        links.NEXT_REVIEW, provenance, ownerId, link.sourceClass]);

    const resourceId = rows[0].id;
    counts.linkResources += 1;

    for (const catalogueId of link.catalogueIds) {
      await setRegister(client, orgId, catalogueId, {
        ingestion_status: 'imported',
        quality_status: 'passed',
        official_url: link.url,
        linked_resource_id: resourceId,
        next_action: link.supersedesLocalCopy
          ? 'Live. The catalogued local copy is a superseded edition — do not circulate it.'
          : 'Live for staff. Re-check the publisher page at the next review date.',
      }, { field: 'official_url', to: link.url, reason: `Publisher page verified on ${links.CHECKED_ON}.` });
      counts.linkRecords += 1;
    }
  }

  for (const item of links.UNVERIFIED_LINKS) {
    await setRegister(client, orgId, item.catalogueId, {
      ingestion_status: 'needs-link-verification',
      quality_status: 'pending-human',
      next_action: item.reason,
    }, { field: 'ingestion_status', to: 'needs-link-verification', reason: item.reason });
    counts.linkUnverified += 1;
  }
}

// ── C — controlled instruments ──────────────────────────────────────────────

async function applyInstruments(client, orgId, ownerId) {
  const keyToId = new Map();

  const existing = await client.query(
    'SELECT id, key FROM controlled_instruments WHERE organisation_id = $1', [orgId]);
  for (const row of existing.rows) keyToId.set(row.key, row.id);
  counts.instrumentsExisting = keyToId.size;

  for (const inst of instruments.NEW_INSTRUMENTS) {
    if (keyToId.has(inst.key)) continue;          // never duplicate an entry
    const { rows } = await client.query(
      `INSERT INTO controlled_instruments (
         organisation_id, key, name, abbreviation, rights_holder, licensing_notes,
         permitted_use, access_restriction, rights_status, clinical_status,
         evidence_checked, state, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'clinician',$8,'unreviewed',FALSE,'active',$9)
       ON CONFLICT (organisation_id, key) DO UPDATE SET
         licensing_notes = EXCLUDED.licensing_notes, updated_at = NOW()
       RETURNING id`,
      [orgId, inst.key, inst.name, inst.abbreviation, inst.rightsHolder, inst.notes,
        'Register entry only. No form, manual, item content or scoring rule is held by the portal.',
        inst.rights, ownerId]);
    keyToId.set(inst.key, rows[0].id);
    counts.instrumentsCreated += 1;
  }

  for (const [catalogueId, key] of Object.entries(instruments.RECORD_TO_INSTRUMENT)) {
    const instrumentId = keyToId.get(key);
    if (!instrumentId) throw new Error(`Instrument "${key}" missing for ${catalogueId}.`);
    await setRegister(client, orgId, catalogueId, {
      linked_instrument_id: instrumentId,
      ingestion_status: 'registered',
      next_action: 'Confirm licence and permitted use with the rights holder. No file is held.',
    }, { field: 'linked_instrument', to: key, reason: 'Mapped to the controlled-instrument register.' });
    counts.instrumentRecords += 1;
  }
}

// ── D — five internal practitioner resources ────────────────────────────────
//
// Held, not imported. Section D permits import only where Opal ownership is
// clear, and nothing in the catalogue evidences authorship: these came from
// mentoring sessions, which is exactly the situation where the author is as
// likely to be the mentor as the practice. Guessing is forbidden, so they wait.

const INTERNAL_RECORDS = ['res-0085', 'res-0086', 'res-0087', 'res-0088', 'res-0089'];

async function applyInternal(client, orgId) {
  for (const catalogueId of INTERNAL_RECORDS) {
    await setRegister(client, orgId, catalogueId, {
      ingestion_status: 'needs-human-review',
      quality_status: 'pending-human',
      next_action: 'Confirm who authored this and whether Opal owns it. Mentoring materials are often the '
        + 'mentor\'s work. Import to the staff-only library once ownership is evidenced.',
    }, { field: 'ingestion_status', to: 'needs-human-review',
      reason: 'Authorship not evidenced by the catalogue; ownership must be confirmed by a person.' });
    counts.internalHeld += 1;
  }
}

// ── E — clean-room Opal originals ───────────────────────────────────────────

async function applyCleanroom(client, orgId) {
  for (const item of cleanroom.CLEANROOM_BACKLOG) {
    await client.query(
      `INSERT INTO resource_cleanroom_provenance (
         organisation_id, catalogue_id, clinical_purpose, inspiration_class,
         risk_tier, clinical_gate, rights_gate, brand_gate, accessibility_gate,
         legal_gate, blocker_note)
       VALUES ($1,$2,$3,'general-clinical-purpose-only',$4,'pending','passed','pending','pending',$5,$6)
       ON CONFLICT (organisation_id, catalogue_id) DO UPDATE SET
         clinical_purpose = EXCLUDED.clinical_purpose,
         risk_tier = EXCLUDED.risk_tier,
         legal_gate = EXCLUDED.legal_gate,
         blocker_note = EXCLUDED.blocker_note,
         updated_at = NOW()`,
      [orgId, item.catalogueId, item.purpose, item.riskTier,
        item.riskTier === 'legal' ? 'blocked' : 'not-required', item.blocker]);

    await setRegister(client, orgId, item.catalogueId, {
      ingestion_status: 'registered',
      quality_status: 'pending-human',
      next_action: item.blocker,
    }, { field: 'next_action', to: 'clean-room', reason: 'Added to the clean-room authoring backlog.' });
    counts.cleanroomPlanned += 1;
  }
}

// ── F, G, H, I, J — register-only treatments ────────────────────────────────
//
// Counted rather than acted on. Their register row already carries the decision,
// the reason and the next action; there is nothing further that may safely exist.

async function countRegisterOnly(client, orgId) {
  const { rows } = await client.query(
    `SELECT treatment, COUNT(*)::int AS n FROM resource_ingestion_register
      WHERE organisation_id = $1 GROUP BY treatment`, [orgId]);
  const by = Object.fromEntries(rows.map((r) => [r.treatment, r.n]));
  counts.vendorQueued = by['live-vendor-link'] || 0;
  counts.rightsHeld = by['rights-review'] || 0;
  counts.privateExcluded = by['privacy-excluded'] || 0;
  counts.duplicates = by['duplicate-archived'] || 0;
  counts.placeholders = by['unavailable-placeholder'] || 0;
}

/**
 * Vendor references have no verified page, because the catalogue holds no URLs
 * and 294 vendor pages cannot be confirmed by hand. They sit in the queue with
 * the vendor recorded, which is the state the brief asks for.
 */
async function queueVendorLinks(client, orgId) {
  await client.query(
    `UPDATE resource_ingestion_register
        SET ingestion_status = 'needs-link-verification',
            next_action = 'No canonical vendor page has been verified. Confirm the product page before any '
              || 'staff-facing link is shown. The local file is never served.',
            updated_at = NOW()
      WHERE organisation_id = $1 AND treatment = 'live-vendor-link'
        AND reviewer_user_id IS NULL`, [orgId]);
}

/** Duplicates keep their pointer to the master, which carries its own rights. */
async function verifyDuplicateMapping(client, orgId) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS unmapped FROM resource_ingestion_register
      WHERE organisation_id = $1 AND treatment = 'duplicate-archived'
        AND duplicate_of_catalogue_id IS NULL`, [orgId]);
  return rows[0].unmapped;
}

async function main() {
  const { rows: [{ db }] } = await pool.query('SELECT current_database() AS db');
  console.log(`Database: ${db}`);
  const { orgId, ownerId } = await resolveOrg();

  const { rows: [{ n }] } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM resource_ingestion_register WHERE organisation_id = $1', [orgId]);
  if (n !== 650) throw new Error(`Register holds ${n} rows, expected 650. Run the ingestion first.`);

  if (!APPLY) {
    console.log('\nDRY RUN — would apply:');
    console.log(`  ${links.VERIFIED_LINKS.length} verified link resources covering `
      + `${links.verifiedCatalogueIds().length} catalogue records`);
    console.log(`  ${links.UNVERIFIED_LINKS.length} link records held for verification`);
    console.log(`  ${instruments.NEW_INSTRUMENTS.length} new controlled instruments; `
      + `${Object.keys(instruments.RECORD_TO_INSTRUMENT).length} catalogue records mapped`);
    console.log(`  ${INTERNAL_RECORDS.length} internal resources held for ownership confirmation`);
    console.log(`  ${cleanroom.CLEANROOM_BACKLOG.length} clean-room provenance records`);
    console.log('\nRe-run with --apply.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await applyLinks(client, orgId, ownerId);
    await applyInstruments(client, orgId, ownerId);
    await applyInternal(client, orgId);
    await applyCleanroom(client, orgId);
    await queueVendorLinks(client, orgId);
    await countRegisterOnly(client, orgId);
    const unmapped = await verifyDuplicateMapping(client, orgId);
    if (unmapped) throw new Error(`${unmapped} duplicate record(s) have no master mapping. Rolling back.`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log('\n── Applied ────────────────────────────────────────────────');
  console.log(`  Official/nonprofit link resources : ${counts.linkResources} (covering ${counts.linkRecords} records)`);
  console.log(`  Link records held for verification: ${counts.linkUnverified}`);
  console.log(`  Instruments created / pre-existing: ${counts.instrumentsCreated} / ${counts.instrumentsExisting}`);
  console.log(`  Catalogue records mapped to instruments: ${counts.instrumentRecords}`);
  console.log(`  Internal resources held            : ${counts.internalHeld}`);
  console.log(`  Clean-room backlog records         : ${counts.cleanroomPlanned}`);
  console.log('  ── register-only (nothing created, by design) ──');
  console.log(`  Vendor references                  : ${counts.vendorQueued}`);
  console.log(`  Rights review                      : ${counts.rightsHeld}`);
  console.log(`  Private, excluded                  : ${counts.privateExcluded}`);
  console.log(`  Duplicates archived                : ${counts.duplicates}`);
  console.log(`  Unavailable placeholders           : ${counts.placeholders}`);
  await pool.end();
}

main().catch((err) => {
  console.error('\ntreatment apply failed:', err.message);
  pool.end().catch(() => {});
  process.exit(1);
});
