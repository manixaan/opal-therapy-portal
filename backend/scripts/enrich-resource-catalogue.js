'use strict';

/**
 * Deterministic catalogue enrichment for the bulk-imported resources.
 *
 * Everything here is a RULE over metadata the register already holds — no
 * model, no inference service, no content generation. The register's audit
 * fields (topic, resource_type, source_class, source_organisation) were
 * populated by the human-reviewed catalogue; this script translates them into
 * the vocabulary the Resource Hub browses by:
 *
 *   register.topic            → therapy_area tag links (+ clinical_population)
 *   register.resource_type    → resources.content_type (library type filter)
 *   register.source_class     → resources.source_class (attribution badge)
 *   register.source_organisation → resources.source_publisher (badge label,
 *                               placeholders like 'not-yet-confirmed' dropped)
 *   title keywords            → additional therapy_area tag links
 *   title artifacts           → cleaned display title (vendor codes, fused
 *                               camelCase, trailing format words)
 *   shared content hash       → exact duplicate suppressed (lower catalogue id
 *                               stays; the other resource is archived)
 *
 * Idempotent: tags upsert ON CONFLICT DO NOTHING, scalar updates only touch
 * rows whose value would change, duplicate archiving skips already-archived.
 * Additive: existing tags are never removed, a populated publisher or a
 * classified source_class is never overwritten.
 *
 *   node backend/scripts/enrich-resource-catalogue.js            # dry run
 *   node backend/scripts/enrich-resource-catalogue.js --apply
 */

const { pool } = require('../database');

const APPLY = process.argv.includes('--apply');

/** register.topic → therapy_area tag names (must exist or be creatable). */
const TOPIC_TAGS = {
  'social-communication-and-safety': ['Social skills', 'Communication supports'],
  'emotional-regulation-and-mental-health': ['Emotional regulation'],
  'fine-motor-and-handwriting': ['Fine motor', 'Handwriting'],
  'routines-executive-function-and-visual-supports': ['Executive functioning', 'Routine building'],
  'ndis-funding-and-navigation': ['NDIS'],
  'money-and-budgeting': ['Money management'],
  'sensory-processing-and-interoception': ['Sensory processing'],
  'housing-and-home-modifications': ['Home safety'],
  'self-care-and-daily-living': ['Personal care', 'ADLs'],
  'assistive-technology-and-manual-handling': ['Assistive technology'],
  'aged-care-and-dementia': [],
  'assessments-and-outcome-measures': [],
  'paediatric-general': [],
  'general-occupational-therapy': [],
};

/** Topics that carry a clinical population signal. */
const TOPIC_POPULATION = {
  'paediatric-general': 'paediatric',
  'aged-care-and-dementia': 'older_adult',
};

/** register.resource_type → resources.content_type (library vocabulary). */
const TYPE_CONTENT = {
  'reference-or-handout': 'article',
  'factsheet-or-information-sheet': 'article',
  'visual-support-cards-or-poster': 'download',
  'worksheet-form-or-template': 'template',
  'practice-template-or-plan': 'template',
  'assessment-or-rating-scale': 'download',
  'slide-deck-or-digital-activity': 'download',
  'game-or-interactive-activity': 'download',
  'resource-pack-archive': 'download',
  'guide-workbook-or-resource-pack': 'clinical_guide',
  checklist: 'checklist',
  'instructions-or-procedure': 'tutorial',
};

/** register.source_class → resources.source_class (migration 024 vocabulary). */
const SOURCE_CLASS = {
  'commercial-educational-resource': 'commercial',
  'standardised-or-accredited-instrument': 'standardised-instrument',
  'occupational-therapy-company-material': 'provider-company',
  'government-or-official-guidance': 'government-official',
  'nonprofit-or-public-health-publisher': 'nonprofit',
  'internal-practitioner-material': 'internal',
  // Honest unknowns stay unknown; the badge then says nothing rather than guess.
  'unverified-or-internal': null,
  'third-party-copyrighted-unknown-publisher': null,
};

/** Organisation values that are audit placeholders, not publishers. */
const PUBLISHER_PLACEHOLDERS = /^(not-yet-confirmed|publisher-not-yet-confirmed|internal-origin-not-yet-confirmed|unknown)$/i;

/**
 * Keyword → tag rules applied to titles. Curated from the actual corpus;
 * additive only, so a wrong-ish extra tag costs a click, never hides a
 * resource.
 */
const KEYWORD_TAGS = [
  [/handwrit|letter formation|letter writing|pencil control|pre-?writing|tracing/i, ['Handwriting', 'Fine motor']],
  [/scissor|cutting skill/i, ['Fine motor']],
  [/toilet/i, ['Toileting']],
  [/sleep|bedtime/i, ['Sleep']],
  [/emotion|feeling|zones of regulation|calm(?:ing)?\b|anxiety|worry|self-?esteem|coping/i, ['Emotional regulation']],
  [/sensory|interoception/i, ['Sensory processing']],
  [/social stor|friendship|conversation|personal space|social skill|turn taking|sharing/i, ['Social skills']],
  [/money|budget|spending|shopping/i, ['Money management']],
  [/cooking|recipe|meal|kitchen/i, ['Cooking']],
  [/routine|schedule|timetable|visual support|first.?then|now and next/i, ['Routine building']],
  [/school readiness|classroom|school participation/i, ['School participation']],
  [/\bplay\b/i, ['Play skills']],
  [/dressing|grooming|self-?care|hygiene|shower|brushing teeth|toothbrush/i, ['Personal care']],
  [/feeding|chewing|mealtime|fussy eat|picky eat/i, ['Feeding']],
  [/gross motor|balance|coordination|ball skills/i, ['Gross motor']],
  [/\bndis\b|support plan|plan review/i, ['NDIS']],
  [/wheelchair|hoist|transfer|manual handling|pressure care|seating/i, ['Assistive technology']],
];

/** Clean a display title without inventing content. */
function cleanTitle(raw) {
  let t = String(raw || '').trim();
  // Fused camelCase from filenames: CalculateTheCost → Calculate The Cost.
  t = t.replace(/([a-z])([A-Z])/g, '$1 $2');
  // Vendor code prefixes: "Za2 T 19 ", "T Tp 123 ", "Au T2 S 456 " — short
  // letter+digit tokens (optionally chained) before at least two real words.
  t = t.replace(/^(?:[A-Za-z]{1,2}\d{1,4}\s+)+(?:[Tt]\s+\d+\s+)?(?=\S+\s+\S)/, '');
  // Leading list numbers: "05 KICA Form" → "KICA Form".
  t = t.replace(/^\d{1,3}\s+(?=[A-Za-z])/, '');
  // Trailing format words describe the file, not the resource.
  t = t.replace(/\s+(powerpoint|pdf|docx?|pptx?)\s*$/i, '');
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t.length >= 3 ? t : String(raw || '').trim();
}

async function main() {
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);
  const stats = {
    tagLinks: 0, newTags: 0, titles: 0, contentTypes: 0, sourceClasses: 0,
    publishers: 0, populations: 0, duplicatesArchived: 0,
  };

  const { rows } = await pool.query(
    `SELECT reg.id AS reg_id, reg.catalogue_id, reg.topic, reg.resource_type AS reg_type,
            reg.source_class AS reg_source_class, reg.source_organisation,
            -- Dedupe on the STORED file's hash: the register's checksum column
            -- is the audit's record and is null for some rows, but every
            -- hosted blob was hashed at copy time.
            (SELECT rf.checksum_sha256 FROM resource_files rf
              WHERE rf.resource_id = r.id ORDER BY rf.is_primary DESC LIMIT 1) AS checksum_sha256,
            r.id, r.organisation_id, r.title, r.content_type, r.source_class,
            r.source_publisher, r.clinical_population, r.archived_at
       FROM resource_ingestion_register reg
       JOIN resources r ON r.id = reg.linked_resource_id
      ORDER BY reg.catalogue_id`);
  console.log(`${rows.length} register-linked resources\n`);

  // ── Tag ids (create the few that the mapping needs and the seed lacks) ────
  const wantedTags = new Set();
  for (const names of Object.values(TOPIC_TAGS)) names.forEach((n) => wantedTags.add(n));
  for (const [, names] of KEYWORD_TAGS) names.forEach((n) => wantedTags.add(n));
  const tagId = new Map();
  for (const name of wantedTags) {
    const { rows: t } = await pool.query(
      `SELECT id FROM resource_tags WHERE category = 'therapy_area' AND name = $1`, [name]);
    if (t.length) { tagId.set(name, t[0].id); continue; }
    if (APPLY) {
      const { rows: created } = await pool.query(
        `INSERT INTO resource_tags (category, name) VALUES ('therapy_area', $1)
         ON CONFLICT (category, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [name]);
      tagId.set(name, created[0].id);
    }
    stats.newTags += 1;
  }

  // ── Duplicate suppression: same content hash, two live resources ─────────
  const byHash = new Map();
  for (const r of rows) {
    if (!r.checksum_sha256 || r.archived_at) continue;
    if (!byHash.has(r.checksum_sha256)) byHash.set(r.checksum_sha256, []);
    byHash.get(r.checksum_sha256).push(r);
  }
  for (const [hash, group] of byHash) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.catalogue_id.localeCompare(b.catalogue_id));
    for (const dup of group.slice(1)) {
      if (APPLY) {
        await pool.query(
          `UPDATE resources SET status = 'archived', archived_at = NOW(),
                  publication_state = 'retired', updated_at = NOW() WHERE id = $1`, [dup.id]);
        await pool.query(
          `UPDATE resource_ingestion_register
              SET treatment = 'duplicate-archived', ingestion_status = 'archived',
                  duplicate_of_catalogue_id = $2, updated_at = NOW() WHERE id = $1`,
          [dup.reg_id, group[0].catalogue_id]);
        await pool.query(
          `INSERT INTO resource_ingestion_events
             (organisation_id, register_id, catalogue_id, field, from_value, to_value, reason)
           VALUES ($1,$2,$3,'treatment',NULL,'duplicate-archived',$4)`,
          [dup.organisation_id, dup.reg_id, dup.catalogue_id,
            `Byte-identical to ${group[0].catalogue_id} (sha ${hash.slice(0, 12)}); one card, one document.`]);
      }
      dup.archived_at = new Date();
      stats.duplicatesArchived += 1;
    }
  }

  // ── Per-resource scalar + tag enrichment ─────────────────────────────────
  for (const r of rows) {
    if (r.archived_at) continue;

    const sets = [];
    const params = [r.id];
    const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    const cleaned = cleanTitle(r.title);
    if (cleaned && cleaned !== r.title) { set('title', cleaned.slice(0, 300)); stats.titles += 1; }

    const ct = TYPE_CONTENT[r.reg_type];
    const wantedCt = (r.topic === 'ndis-funding-and-navigation' && (ct === 'article' || !ct))
      ? 'ndis_guide' : ct;
    if (wantedCt && r.content_type !== wantedCt) { set('content_type', wantedCt); stats.contentTypes += 1; }

    const sc = SOURCE_CLASS[r.reg_source_class];
    if (sc && (!r.source_class || r.source_class === 'unknown') && r.source_class !== sc) {
      set('source_class', sc);
      stats.sourceClasses += 1;
    }

    const org = String(r.source_organisation || '').trim();
    if (org && !PUBLISHER_PLACEHOLDERS.test(org) && !r.source_publisher) {
      set('source_publisher', org.slice(0, 200));
      stats.publishers += 1;
    }

    const pop = TOPIC_POPULATION[r.topic];
    const havePop = Array.isArray(r.clinical_population) ? r.clinical_population : [];
    if (pop && !havePop.includes(pop)) {
      set('clinical_population', JSON.stringify(havePop.concat(pop)));
      stats.populations += 1;
    }

    if (sets.length && APPLY) {
      await pool.query(`UPDATE resources SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, params);
      if (sc && (!r.source_class || r.source_class === 'unknown')) {
        await pool.query(
          `INSERT INTO resource_governance_events
             (organisation_id, resource_id, field, from_value, to_value, reason)
           VALUES ($1,$2,'source_class',$3,$4,'Backfilled from the ingestion register''s audited source classification.')`,
          [r.organisation_id, r.id, r.source_class || 'unknown', sc]);
      }
    }

    // Tags: topic mapping plus keyword rules over the (cleaned) title.
    const names = new Set(TOPIC_TAGS[r.topic] || []);
    for (const [re, tagNames] of KEYWORD_TAGS) {
      if (re.test(cleaned)) tagNames.forEach((n) => names.add(n));
    }
    for (const name of names) {
      const id = tagId.get(name);
      if (!id) continue; // dry run over a tag not yet created
      if (APPLY) {
        const res = await pool.query(
          `INSERT INTO resource_tag_links (resource_id, tag_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`, [r.id, id]);
        stats.tagLinks += res.rowCount;
      } else {
        stats.tagLinks += 1; // upper bound in dry run
      }
    }
  }

  console.log(JSON.stringify(stats, null, 1));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
