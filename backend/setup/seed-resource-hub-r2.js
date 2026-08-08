'use strict';

/**
 * SEED RESOURCE HUB R2 — DEVELOPMENT / PILOT CONTENT
 *
 * Idempotent seed for the Resource Hub R2 build (migration 011). Loads the
 * content modules in backend/setup/r2-content/ and upserts:
 *
 *   - resources (upsert by organisation_id + slug; marker source_reference='r2-seed:<hash>')
 *   - resource_versions (version 1 'initial' for policies)
 *   - resource_collections + items (8 curated shelves)
 *   - learning_paths + items (4 starter kits)
 *   - resource_tag_links + resource_tags.aliases (existing R1 vocabulary only)
 *   - external_sources + resource_external_sources (official source registry)
 *   - resource_quick_links (9 links)
 *   - pd_events (3 sample events, future dates relative to run time)
 *   - quizzes + quiz_questions (Responsible AI knowledge check)
 *
 *   node backend/setup/seed-resource-hub-r2.js          # seed / refresh
 *   node backend/setup/seed-resource-hub-r2.js --clean  # remove R2-seeded rows only
 *
 * Safe to run repeatedly. HUMAN EDITS ARE NEVER CLOBBERED: the seed stamps
 * source_reference with 'r2-seed:<hash16>' — a fingerprint of the title,
 * description and content it wrote. On re-run a resource row is refreshed
 * ONLY when it still matches that fingerprint AND is still status='approved';
 * a row whose text was edited by a person (or that an owner archived,
 * rejected or flagged) is left untouched and reported as preserved. Legacy
 * rows marked with the bare 'r2-seed' marker are refreshed only when their
 * text already equals what this seed would write. Only rows created by this
 * seed are ever removed by --clean.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('crypto');
const { Pool } = require('pg');

const core = require('./r2-content/core');
const ndisClinical = require('./r2-content/ndis-clinical');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'therapy_scheduler',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD,
});

const SEED_MARKER = 'r2-seed';
const VERIFIED_AT = '2026-08-08';

// Fingerprint of the human-editable text this seed writes. Stored in
// source_reference as 'r2-seed:<hash16>' so a re-run can tell "still exactly
// what the seed wrote" apart from "a person edited this" without extra columns.
const seedHash = (r) => crypto.createHash('sha256')
  .update([r.title || '', r.description || '', r.content || ''].join('\u0000'))
  .digest('hex').slice(0, 16);
const seedRef = (r) => `${SEED_MARKER}:${seedHash(r)}`;

const ALL_RESOURCES = [...core.resources, ...ndisClinical.resources];
const COLLECTIONS = core.collections;
const LEARNING_PATHS = core.learningPaths;
const QUICK_LINKS = core.quickLinks;
const PD_EVENTS = core.pdEvents;
const QUIZ = core.quiz;
const EXTERNAL_SOURCES = ndisClinical.externalSources;

// ── Tag links + aliases ─────────────────────────────────────────────────────
// Maps seeded resources onto the EXISTING R1 77-tag vocabulary (no new tags
// are ever created) and stamps aliases onto those tags so common shorthand
// searches — FCA, AT, NDIS pricing, case notes, wheelchair, PD, rural trip,
// professional boundaries, school, risk assessment — hit via the tag-alias
// search path, not just incidental substring matches.

const TAG_ALIASES = [
  { category: 'type', name: 'Assessment support',
    aliases: ['FCA', 'functional capacity assessment', 'functional assessment'] },
  { category: 'therapy_area', name: 'Assistive technology',
    aliases: ['AT', 'assistive tech'] },
  { category: 'type', name: 'NDIS evidence guide',
    aliases: ['NDIS pricing', 'PAPL', 'price guide', 'pricing arrangements'] },
  { category: 'type', name: 'Report-writing phrase bank',
    aliases: ['case notes', 'clinical notes', 'progress notes', 'documentation'] },
  { category: 'therapy_area', name: 'Equipment prescription',
    aliases: ['wheelchair', 'seating', 'pressure care'] },
  { category: 'type', name: 'PD video',
    aliases: ['PD', 'professional development', 'CPD'] },
  { category: 'population', name: 'Remote/rural clients',
    aliases: ['rural trip', 'rural travel', 'remote travel'] },
  { category: 'type', name: 'Risk/safety guide',
    aliases: ['risk assessment', 'professional boundaries', 'safety planning'] },
  { category: 'therapy_area', name: 'School participation',
    aliases: ['school', 'classroom'] },
];

// slug → [[category, name], ...] — every pair must exist in the R1 vocabulary.
const TAG_LINKS = {
  // Assessment + reporting
  'fca-workflow': [['type', 'Assessment support']],
  'template-fca-report': [['type', 'Assessment support'], ['type', 'Report-writing phrase bank']],
  'writing-functional-impact': [['type', 'Report-writing phrase bank'], ['type', 'Assessment support']],
  'functional-observation': [['type', 'Assessment support']],
  'adl-assessment-overview': [['type', 'Assessment support'], ['therapy_area', 'ADLs']],
  'cognitive-assessment-overview': [['type', 'Assessment support']],
  'ef-assessment-overview': [['type', 'Assessment support'], ['therapy_area', 'Executive functioning']],
  'occupational-performance-assessment': [['type', 'Assessment support']],
  'assessment-tool-directory': [['type', 'Assessment support']],
  // Documentation
  'clinical-note-quality': [['type', 'Report-writing phrase bank']],
  'template-clinical-note': [['type', 'Report-writing phrase bank'], ['type', 'Template']],
  'policy-clinical-documentation': [['type', 'Report-writing phrase bank']],
  'goal-writing': [['type', 'Report-writing phrase bank']],
  'clinical-recommendations': [['type', 'Report-writing phrase bank']],
  // Assistive technology + equipment
  'at-assessment-workflow': [['therapy_area', 'Assistive technology'], ['therapy_area', 'Equipment prescription']],
  'equipment-trial-guide': [['therapy_area', 'Assistive technology'], ['therapy_area', 'Equipment prescription']],
  'wheelchair-seating-overview': [['therapy_area', 'Equipment prescription'], ['therapy_area', 'Mobility']],
  'pressure-management': [['therapy_area', 'Equipment prescription']],
  'bathroom-transfer-equipment': [['therapy_area', 'Equipment prescription'], ['therapy_area', 'Home safety']],
  'home-modifications': [['therapy_area', 'Home safety'], ['therapy_area', 'Assistive technology']],
  // NDIS
  'ndis-pricing-arrangements-2026-27': [['type', 'NDIS evidence guide']],
  'ndis-pricing-claiming-quick-guide': [['type', 'NDIS evidence guide']],
  'ndis-support-catalogue-2026-27': [['type', 'NDIS evidence guide']],
  'what-are-ndis-supports': [['type', 'NDIS evidence guide']],
  'would-we-fund-it': [['type', 'NDIS evidence guide']],
  'ndis-provider-pack': [['type', 'NDIS evidence guide']],
  // Professional development + supervision
  'ot-cpd-requirements': [['type', 'PD video']],
  'policy-cpd': [['type', 'PD video']],
  'policy-supervision': [['type', 'PD video']],
  'template-supervision-agenda': [['type', 'PD video'], ['type', 'Template']],
  // Rural + community safety
  'rural-remote-overview': [['population', 'Remote/rural clients']],
  'rural-pre-trip-checklist': [['population', 'Remote/rural clients'], ['type', 'Risk/safety guide']],
  'rural-clinical-planning': [['population', 'Remote/rural clients']],
  'policy-rural-remote-travel': [['population', 'Remote/rural clients'], ['type', 'Risk/safety guide']],
  'policy-lone-worker-safety': [['type', 'Risk/safety guide']],
  'working-safely-community-settings': [['type', 'Risk/safety guide'], ['population', 'Community-based therapy']],
  'telehealth-practice-guide': [['population', 'Remote/rural clients']],
  // Risk + professional boundaries
  'clinical-risk-assessment': [['type', 'Risk/safety guide']],
  'policy-professional-boundaries': [['type', 'Risk/safety guide']],
  'professional-boundaries-guide': [['type', 'Risk/safety guide']],
  'policy-child-safe-practice': [['type', 'Risk/safety guide'], ['population', 'Children']],
  // School + clinical areas
  'school-based-ot': [['therapy_area', 'School participation'], ['population', 'School-based therapy']],
  'handwriting-fine-motor': [['therapy_area', 'Handwriting'], ['therapy_area', 'Fine motor'], ['therapy_area', 'School participation']],
  'emotional-regulation': [['therapy_area', 'Emotional regulation']],
  'sensory-regulation': [['therapy_area', 'Sensory processing'], ['therapy_area', 'Emotional regulation']],
  'executive-functioning': [['therapy_area', 'Executive functioning']],
  'ef-intervention': [['therapy_area', 'Executive functioning']],
  'routine-development': [['therapy_area', 'Routine building']],
  'community-participation': [['therapy_area', 'Community access'], ['population', 'Community-based therapy']],
  'caregiver-coaching': [['therapy_area', 'Parent coaching']],
};

function assertUniqueSlugs() {
  const seen = new Set();
  for (const r of ALL_RESOURCES) {
    if (seen.has(r.slug)) throw new Error(`duplicate slug in content modules: ${r.slug}`);
    seen.add(r.slug);
  }
}

async function resolveOrgAndOwner() {
  const { rows } = await pool.query(
    `SELECT id, organisation_id FROM users WHERE email = $1`, ['owner@opaltherapy.dev']);
  if (!rows.length || !rows[0].organisation_id) {
    throw new Error('owner@opaltherapy.dev not found (run seed-users.js first)');
  }
  return { orgId: rows[0].organisation_id, ownerId: rows[0].id };
}

async function clean(orgId) {
  const r = await pool.query(
    `DELETE FROM resources WHERE organisation_id IS NOT DISTINCT FROM $1
      AND (source_reference = $2 OR source_reference LIKE $2 || ':%')`,
    [orgId, SEED_MARKER]);
  console.log(`- removed ${r.rowCount} seeded resources (cascade: versions, collection items, path items, quiz, source links, tag links)`);

  const ta = await pool.query(
    `UPDATE resource_tags SET aliases = '[]'::jsonb
      WHERE (category, name) IN (${TAG_ALIASES.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')})`,
    TAG_ALIASES.flatMap((t) => [t.category, t.name]));
  console.log(`- reset aliases on ${ta.rowCount} tags`);

  const c = await pool.query(
    `DELETE FROM resource_collections WHERE organisation_id IS NOT DISTINCT FROM $1 AND key = ANY($2)`,
    [orgId, COLLECTIONS.map((x) => x.key)]);
  console.log(`- removed ${c.rowCount} collections`);

  const p = await pool.query(
    `DELETE FROM learning_paths WHERE organisation_id IS NOT DISTINCT FROM $1 AND key = ANY($2)`,
    [orgId, LEARNING_PATHS.map((x) => x.key)]);
  console.log(`- removed ${p.rowCount} learning paths`);

  const e = await pool.query(
    `DELETE FROM external_sources WHERE organisation_id IS NOT DISTINCT FROM $1 AND name = ANY($2)`,
    [orgId, EXTERNAL_SOURCES.map((x) => x.name)]);
  console.log(`- removed ${e.rowCount} external sources`);

  const q = await pool.query(
    `DELETE FROM resource_quick_links WHERE organisation_id IS NOT DISTINCT FROM $1 AND label = ANY($2)`,
    [orgId, QUICK_LINKS.map((x) => x.label)]);
  console.log(`- removed ${q.rowCount} quick links`);

  const pd = await pool.query(
    `DELETE FROM pd_events WHERE organisation_id IS NOT DISTINCT FROM $1 AND source = $2`,
    [orgId, SEED_MARKER]);
  console.log(`- removed ${pd.rowCount} PD events`);

  console.log('done: R2-seeded rows removed (R1 data untouched)');
}

async function upsertResources(orgId, ownerId) {
  const idBySlug = new Map();
  let inserted = 0;
  let refreshed = 0;
  const preserved = [];

  for (const r of ALL_RESOURCES) {
    const values = [
      orgId, r.slug, r.title, r.description || null, r.contentType, // 1-5
      r.externalUrl || null, seedRef(r), ownerId,                   // 6-8
      r.content || null, r.contentType, r.minutes || 5,             // 9-11
      !!r.mandatory, !!r.ack, !!r.cpdEligible, r.cpdHours || null,  // 12-15
      r.authority || 'internal', r.sourcePublisher || null,         // 16-17
      r.sourceTitle || null, r.sourceEffective || null,             // 18-19
      (r.authority && r.authority !== 'internal') || r.sourcePublisher ? VERIFIED_AT : null, // 20
    ];

    const { rows: existing } = await pool.query(
      `SELECT id, title, description, content, status, source_reference
         FROM resources WHERE organisation_id IS NOT DISTINCT FROM $1 AND slug = $2`,
      [orgId, r.slug]);

    if (!existing.length) {
      const { rows } = await pool.query(
        `INSERT INTO resources (
           organisation_id, slug, title, description, resource_type, status, visibility,
           external_url, source_reference, created_by, approved_by, approved_at,
           content, content_format, content_type, estimated_minutes,
           mandatory, acknowledgement_required, cpd_eligible, cpd_hours,
           authority_level, source_publisher, source_title, source_effective_date,
           source_verified_at, last_reviewed_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, 'approved', 'staff',
           $6, $7, $8, $8, NOW(),
           $9, 'markdown', $10, $11,
           $12, $13, $14, $15,
           $16, $17, $18, $19,
           $20, $20, NOW()
         ) RETURNING id`, values);
      idBySlug.set(r.slug, rows[0].id);
      inserted++;
      continue;
    }

    const row = existing[0];
    idBySlug.set(r.slug, row.id);

    // Human-edit guard: only refresh a row that (a) is seed-owned, (b) has not
    // been moved out of 'approved' by a person (archived/rejected/flagged),
    // and (c) still carries exactly the text the seed last wrote. Legacy rows
    // with the bare marker qualify only when their text equals this seed's.
    const ref = String(row.source_reference || '');
    const seedOwned = ref === SEED_MARKER || ref.startsWith(`${SEED_MARKER}:`);
    const storedHash = ref.startsWith(`${SEED_MARKER}:`) ? ref.slice(SEED_MARKER.length + 1) : null;
    const currentHash = seedHash({ title: row.title, description: row.description, content: row.content });
    const untouched = seedOwned && row.status === 'approved'
      && (storedHash ? currentHash === storedHash : currentHash === seedHash(r));
    if (!untouched) {
      preserved.push(r.slug);
      continue;
    }

    await pool.query(
      `UPDATE resources SET
         title = $3, description = $4, resource_type = $5, status = 'approved',
         visibility = 'staff', external_url = $6, source_reference = $7,
         approved_by = $8, content = $9, content_format = 'markdown', content_type = $10,
         estimated_minutes = $11, mandatory = $12, acknowledgement_required = $13,
         cpd_eligible = $14, cpd_hours = $15, authority_level = $16,
         source_publisher = $17, source_title = $18, source_effective_date = $19,
         source_verified_at = $20, last_reviewed_at = $20, updated_at = NOW()
       WHERE organisation_id IS NOT DISTINCT FROM $1 AND slug = $2`, values);
    refreshed++;
  }
  return { idBySlug, inserted, refreshed, preserved };
}

async function upsertPolicyVersions(idBySlug, ownerId) {
  let created = 0;
  for (const r of ALL_RESOURCES) {
    if (r.contentType !== 'policy') continue;
    const res = await pool.query(
      `INSERT INTO resource_versions (resource_id, version, title, content, change_note, change_kind, created_by)
       VALUES ($1, 1, $2, $3, 'Initial seeded draft', 'initial', $4)
       ON CONFLICT (resource_id, version) DO NOTHING`,
      [idBySlug.get(r.slug), r.title, r.content, ownerId]);
    created += res.rowCount;
  }
  return created;
}

async function upsertCollections(orgId, idBySlug) {
  const skipped = [];
  const counts = {};
  for (let i = 0; i < COLLECTIONS.length; i++) {
    const c = COLLECTIONS[i];
    const { rows } = await pool.query(
      `INSERT INTO resource_collections (organisation_id, key, name, tagline, icon, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       ON CONFLICT (organisation_id, key) DO UPDATE SET
         name = EXCLUDED.name, tagline = EXCLUDED.tagline, icon = EXCLUDED.icon,
         sort_order = EXCLUDED.sort_order, is_active = TRUE
       RETURNING id`,
      [orgId, c.key, c.name, c.tagline, c.icon, i]);
    const collectionId = rows[0].id;

    await pool.query(`DELETE FROM resource_collection_items WHERE collection_id = $1`, [collectionId]);
    let sort = 0;
    for (const slug of c.slugs) {
      const rid = idBySlug.get(slug);
      if (!rid) { skipped.push(`collection ${c.key}: unknown slug ${slug}`); continue; }
      await pool.query(
        `INSERT INTO resource_collection_items (collection_id, resource_id, sort_order)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [collectionId, rid, sort++]);
    }
    counts[c.key] = sort;
  }
  return { counts, skipped };
}

async function upsertLearningPaths(orgId, idBySlug) {
  const skipped = [];
  const counts = {};
  for (let i = 0; i < LEARNING_PATHS.length; i++) {
    const p = LEARNING_PATHS[i];
    const { rows } = await pool.query(
      `INSERT INTO learning_paths (organisation_id, key, name, description, target_role, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       ON CONFLICT (organisation_id, key) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description,
         target_role = EXCLUDED.target_role, sort_order = EXCLUDED.sort_order, is_active = TRUE
       RETURNING id`,
      [orgId, p.key, p.name, p.description, p.targetRole || null, i]);
    const pathId = rows[0].id;

    await pool.query(`DELETE FROM learning_path_items WHERE path_id = $1`, [pathId]);
    let sort = 0;
    for (const slug of p.slugs) {
      const rid = idBySlug.get(slug);
      if (!rid) { skipped.push(`path ${p.key}: unknown slug ${slug}`); continue; }
      await pool.query(
        `INSERT INTO learning_path_items (path_id, resource_id, sort_order, required)
         VALUES ($1, $2, $3, TRUE) ON CONFLICT (path_id, resource_id) DO NOTHING`,
        [pathId, rid, sort++]);
    }
    counts[p.key] = sort;
  }
  return { counts, skipped };
}

async function upsertTagLinksAndAliases(idBySlug) {
  const skipped = [];
  let aliasTags = 0;
  for (const t of TAG_ALIASES) {
    const res = await pool.query(
      `UPDATE resource_tags SET aliases = $3::jsonb WHERE category = $1 AND name = $2`,
      [t.category, t.name, JSON.stringify(t.aliases)]);
    if (!res.rowCount) skipped.push(`aliases: unknown tag ${t.category}/${t.name}`);
    aliasTags += res.rowCount;
  }

  let newLinks = 0;
  for (const [slug, tags] of Object.entries(TAG_LINKS)) {
    const rid = idBySlug.get(slug);
    if (!rid) { skipped.push(`tag links: unknown slug ${slug}`); continue; }
    for (const [category, name] of tags) {
      const res = await pool.query(
        `INSERT INTO resource_tag_links (resource_id, tag_id)
         SELECT $1, id FROM resource_tags WHERE category = $2 AND name = $3
         ON CONFLICT DO NOTHING`, [rid, category, name]);
      newLinks += res.rowCount;
      if (!res.rowCount) {
        const chk = await pool.query(
          'SELECT 1 FROM resource_tags WHERE category = $1 AND name = $2', [category, name]);
        if (!chk.rows.length) skipped.push(`tag links: unknown tag ${category}/${name} (${slug})`);
      }
    }
  }
  return { aliasTags, newLinks, skipped };
}

async function upsertExternalSources(orgId, idBySlug) {
  const skipped = [];
  const idByKey = new Map();
  for (const s of EXTERNAL_SOURCES) {
    const existing = await pool.query(
      `SELECT id FROM external_sources WHERE organisation_id IS NOT DISTINCT FROM $1 AND name = $2`,
      [orgId, s.name]);
    let id;
    if (existing.rows.length) {
      id = existing.rows[0].id;
      await pool.query(
        `UPDATE external_sources SET publisher = $2, url = $3, authority = $4, status = 'current',
           effective_date = $5, last_verified_at = $6, next_verify_at = $6::date + INTERVAL '90 days',
           verified_after_change = TRUE
         WHERE id = $1`,
        [id, s.publisher, s.url, s.authority, s.effectiveDate || null, VERIFIED_AT]);
    } else {
      const { rows } = await pool.query(
        `INSERT INTO external_sources (organisation_id, name, publisher, url, authority, status,
           effective_date, last_verified_at, next_verify_at)
         VALUES ($1, $2, $3, $4, $5, 'current', $6, $7, $7::date + INTERVAL '90 days')
         RETURNING id`,
        [orgId, s.name, s.publisher, s.url, s.authority, s.effectiveDate || null, VERIFIED_AT]);
      id = rows[0].id;
    }
    idByKey.set(s.key, id);
  }

  // Link resources to their sources.
  let links = 0;
  for (const r of ALL_RESOURCES) {
    if (!Array.isArray(r.sources)) continue;
    for (const key of r.sources) {
      const sid = idByKey.get(key);
      if (!sid) { skipped.push(`resource ${r.slug}: unknown external source key ${key}`); continue; }
      const res = await pool.query(
        `INSERT INTO resource_external_sources (resource_id, source_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [idBySlug.get(r.slug), sid]);
      links += res.rowCount;
    }
  }
  return { count: idByKey.size, newLinks: links, skipped };
}

async function upsertQuickLinks(orgId) {
  for (const q of QUICK_LINKS) {
    const existing = await pool.query(
      `SELECT id FROM resource_quick_links WHERE organisation_id IS NOT DISTINCT FROM $1 AND label = $2`,
      [orgId, q.label]);
    if (existing.rows.length) {
      await pool.query(
        `UPDATE resource_quick_links SET url = $2, icon = $3, sort_order = $4, is_active = TRUE WHERE id = $1`,
        [existing.rows[0].id, q.url, q.icon, q.sort]);
    } else {
      await pool.query(
        `INSERT INTO resource_quick_links (organisation_id, label, url, icon, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)`,
        [orgId, q.label, q.url, q.icon, q.sort]);
    }
  }
  return QUICK_LINKS.length;
}

async function upsertPdEvents(orgId, ownerId) {
  // Dates are relative to run time, so refresh seeded events on every run.
  await pool.query(
    `DELETE FROM pd_events WHERE organisation_id IS NOT DISTINCT FROM $1 AND source = $2`,
    [orgId, SEED_MARKER]);
  for (const e of PD_EVENTS) {
    const start = new Date(Date.now() + e.daysFromNow * 24 * 3600e3);
    start.setUTCHours(e.startHour - 8, 0, 0, 0); // Perth-local start hour (AWST, no DST)
    const end = new Date(start.getTime() + e.durationHours * 3600e3);
    await pool.query(
      `INSERT INTO pd_events (organisation_id, title, provider, description, topic,
         starts_at, ends_at, timezone, mode, location, cost_cents, cpd_hours,
         registration_url, target_roles, source, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Australia/Perth', $8, $9, $10, $11, $12, $13, $14, 'upcoming', $15)`,
      [orgId, e.title, e.provider, e.description, e.topic,
       start.toISOString(), end.toISOString(), e.mode, e.location, e.costCents, e.cpdHours,
       e.registrationUrl, JSON.stringify(e.targetRoles), SEED_MARKER, ownerId]);
  }
  return PD_EVENTS.length;
}

async function upsertQuiz(idBySlug) {
  const resourceId = idBySlug.get(QUIZ.resourceSlug);
  if (!resourceId) throw new Error(`quiz resource slug not found: ${QUIZ.resourceSlug}`);
  const { rows } = await pool.query(
    `INSERT INTO quizzes (resource_id, pass_threshold, is_active)
     VALUES ($1, $2, TRUE)
     ON CONFLICT (resource_id) DO UPDATE SET pass_threshold = EXCLUDED.pass_threshold, is_active = TRUE
     RETURNING id`,
    [resourceId, QUIZ.passThreshold]);
  const quizId = rows[0].id;
  await pool.query(`DELETE FROM quiz_questions WHERE quiz_id = $1`, [quizId]);
  for (let i = 0; i < QUIZ.questions.length; i++) {
    const q = QUIZ.questions[i];
    await pool.query(
      `INSERT INTO quiz_questions (quiz_id, sort_order, question, kind, options, correct_index)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [quizId, i, q.question, q.kind, JSON.stringify(q.options), q.correctIndex]);
  }
  return QUIZ.questions.length;
}

async function printSummary(orgId) {
  const counts = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM resources WHERE organisation_id IS NOT DISTINCT FROM $1
          AND (source_reference = $2 OR source_reference LIKE $2 || ':%')) AS resources,
       (SELECT COUNT(*) FROM resource_collections WHERE organisation_id IS NOT DISTINCT FROM $1) AS collections,
       (SELECT COUNT(*) FROM resource_collection_items i JOIN resource_collections c ON c.id = i.collection_id
          WHERE c.organisation_id IS NOT DISTINCT FROM $1) AS collection_items,
       (SELECT COUNT(*) FROM learning_paths WHERE organisation_id IS NOT DISTINCT FROM $1) AS paths,
       (SELECT COUNT(*) FROM learning_path_items i JOIN learning_paths p ON p.id = i.path_id
          WHERE p.organisation_id IS NOT DISTINCT FROM $1) AS path_items,
       (SELECT COUNT(*) FROM external_sources WHERE organisation_id IS NOT DISTINCT FROM $1) AS sources,
       (SELECT COUNT(*) FROM resource_external_sources l JOIN resources r ON r.id = l.resource_id
          WHERE r.organisation_id IS NOT DISTINCT FROM $1
            AND (r.source_reference = $2 OR r.source_reference LIKE $2 || ':%')) AS source_links,
       (SELECT COUNT(*) FROM resource_tag_links l JOIN resources r ON r.id = l.resource_id
          WHERE r.organisation_id IS NOT DISTINCT FROM $1
            AND (r.source_reference = $2 OR r.source_reference LIKE $2 || ':%')) AS tag_links,
       (SELECT COUNT(*) FROM resource_tags WHERE aliases <> '[]'::jsonb) AS alias_tags,
       (SELECT COUNT(*) FROM resource_quick_links WHERE organisation_id IS NOT DISTINCT FROM $1) AS quick_links,
       (SELECT COUNT(*) FROM pd_events WHERE organisation_id IS NOT DISTINCT FROM $1 AND source = $2) AS pd_events,
       (SELECT COUNT(*) FROM quiz_questions q JOIN quizzes z ON z.id = q.quiz_id
          JOIN resources r ON r.id = z.resource_id
          WHERE r.organisation_id IS NOT DISTINCT FROM $1
            AND (r.source_reference = $2 OR r.source_reference LIKE $2 || ':%')) AS quiz_questions,
       (SELECT COUNT(*) FROM resource_versions v JOIN resources r ON r.id = v.resource_id
          WHERE r.organisation_id IS NOT DISTINCT FROM $1
            AND (r.source_reference = $2 OR r.source_reference LIKE $2 || ':%')) AS versions`,
    [orgId, SEED_MARKER]);
  const c = counts.rows[0];
  console.log('\nDatabase totals (idempotency check):');
  console.log(`  resources=${c.resources} collections=${c.collections} collection_items=${c.collection_items}`);
  console.log(`  paths=${c.paths} path_items=${c.path_items} sources=${c.sources} source_links=${c.source_links}`);
  console.log(`  tag_links=${c.tag_links} alias_tags=${c.alias_tags}`);
  console.log(`  quick_links=${c.quick_links} pd_events=${c.pd_events} quiz_questions=${c.quiz_questions} policy_versions=${c.versions}`);
  return c;
}

async function main() {
  assertUniqueSlugs();
  const { orgId, ownerId } = await resolveOrgAndOwner();

  if (process.argv.includes('--clean')) {
    await clean(orgId);
    return;
  }

  console.log(`Seeding Resource Hub R2 content for organisation ${orgId}`);
  console.log(`  ${ALL_RESOURCES.length} resources defined in content modules\n`);

  const up = await upsertResources(orgId, ownerId);
  const idBySlug = up.idBySlug;
  console.log(`+ resources: ${up.inserted} inserted, ${up.refreshed} refreshed, ${up.preserved.length} preserved (marker source_reference='${SEED_MARKER}:<hash>')`);
  if (up.preserved.length) {
    console.log('  Preserved (human-edited or lifecycle-changed — NOT overwritten):');
    for (const s of up.preserved) console.log(`    ~ ${s}`);
  }

  const versions = await upsertPolicyVersions(idBySlug, ownerId);
  console.log(`+ policy versions created this run: ${versions}`);

  const tags = await upsertTagLinksAndAliases(idBySlug);
  console.log(`+ tag aliases set on ${tags.aliasTags} tags; new tag links this run: ${tags.newLinks}`);

  const col = await upsertCollections(orgId, idBySlug);
  console.log('+ collections:');
  for (const [k, n] of Object.entries(col.counts)) console.log(`    ${k.padEnd(26)} ${n} items`);

  const lp = await upsertLearningPaths(orgId, idBySlug);
  console.log('+ learning paths:');
  for (const [k, n] of Object.entries(lp.counts)) console.log(`    ${k.padEnd(26)} ${n} items`);

  const ext = await upsertExternalSources(orgId, idBySlug);
  console.log(`+ external sources registered: ${ext.count} (new resource links this run: ${ext.newLinks})`);

  const ql = await upsertQuickLinks(orgId);
  console.log(`+ quick links: ${ql}`);

  const pd = await upsertPdEvents(orgId, ownerId);
  console.log(`+ PD events (future-dated): ${pd}`);

  const qq = await upsertQuiz(idBySlug);
  console.log(`+ quiz on '${QUIZ.resourceSlug}': ${qq} questions, pass threshold ${QUIZ.passThreshold}`);

  const skipped = [...col.skipped, ...lp.skipped, ...ext.skipped, ...tags.skipped];
  if (skipped.length) {
    console.log('\nSkipped (unresolved references):');
    for (const s of skipped) console.log(`  ! ${s}`);
  } else {
    console.log('\nNothing skipped — all references resolved.');
  }

  await printSummary(orgId);
  console.log('\ndone: Resource Hub R2 content seeded.');
  console.log('  Remove with: node backend/setup/seed-resource-hub-r2.js --clean');
}

main()
  .then(() => pool.end())
  .catch((err) => { console.error('seed failed: ' + err.message); pool.end(); process.exit(1); });
