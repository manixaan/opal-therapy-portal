#!/usr/bin/env node
'use strict';

/**
 * Seed the controlled instrument register with six standardised instruments.
 *
 * CONSERVATIVE BY CONSTRUCTION
 * Only two things are asserted per row: the instrument's NAME and its
 * ABBREVIATION. Those are matters of public record and cannot be got wrong by
 * inference. Everything that is a claim about someone else's property —
 * the current edition, the rights holder, the official URL, what use is
 * permitted, whether a licence exists — is left NULL or 'unreviewed', so the
 * register displays it as visibly unresolved rather than quietly plausible.
 *
 * Why not fill in the obvious ones? Because "obvious" is how a wrong edition
 * number or a stale distributor ends up looking authoritative in a clinical
 * governance record. A blank that says "not yet confirmed" is more useful than a
 * guess that reads as fact.
 *
 * WHODAS is LINKED, not duplicated: linked_module points at the existing WHODAS
 * module, and the register stores no items, no scoring and no PDFs. The only
 * licensing text recorded for it is a verbatim quotation of what the WHO manual
 * says, together with the fact that the compliance checklist is outstanding —
 * which is a description of the situation, not a conclusion about it.
 *
 * Idempotent on (organisation_id, key): re-running never duplicates and never
 * overwrites a reviewer's decisions.
 *
 *   node backend/setup/seed-controlled-instruments.js --dry-run
 *   node backend/setup/seed-controlled-instruments.js
 */

require('dotenv').config();
const { pool } = require('../database');

const DRY = process.argv.includes('--dry-run');

/**
 * `rightsHolder` is recorded ONLY where the publisher is unambiguous and
 * long-standing. Even then evidence_checked stays false: naming a publisher is
 * not the same as verifying the current licence terms with them.
 */
const INSTRUMENTS = [
  {
    key: 'whodas-2.0-36',
    name: 'WHO Disability Assessment Schedule 2.0 (36-item)',
    abbreviation: 'WHODAS 2.0',
    rightsHolder: 'World Health Organization',
    linkedModule: 'whodas',
    linkedModuleRoute: '/api/whodas/instrument',
    licensingNotes:
      'The WHODAS 2.0 manual (Geneva: World Health Organization; 2010, ISBN 978 92 4 154759 8) '
      + 'states at §5.1 that the instrument is placed in the public domain by WHO, subject to '
      + 'registration on the WHODAS 2.0 web site and to no substantive changes being made. '
      + 'That is a quotation of the source, not a determination that Opal has met those '
      + 'conditions. The compliance checklist at docs/whodas/03_LICENSING_COMPLIANCE.md has six '
      + 'outstanding items, including WHO registration, and remains unticked. Rights status '
      + 'therefore stays unreviewed until a person confirms it.',
    permittedUse: null,
    evidenceNotes:
      'Implemented in-app behind the ENABLE_WHODAS_ASSESSMENT flag, which is the licensing gate. '
      + 'Register links to that module; no instrument content is stored here.',
  },
  {
    key: 'copm',
    name: 'Canadian Occupational Performance Measure',
    abbreviation: 'COPM',
    rightsHolder: null,
    licensingNotes: null,
    permittedUse: null,
    evidenceNotes: 'Publisher, current edition and licence terms not yet confirmed by a person.',
  },
  {
    key: 'moca',
    name: 'Montreal Cognitive Assessment',
    abbreviation: 'MoCA',
    rightsHolder: null,
    licensingNotes: null,
    permittedUse: null,
    evidenceNotes:
      'Publisher, current version and training/certification requirements not yet confirmed. '
      + 'MoCA has historically required user registration or training — this must be verified '
      + 'before any clinical use is recorded as permitted.',
  },
  {
    key: 'rudas',
    name: 'Rowland Universal Dementia Assessment Scale',
    abbreviation: 'RUDAS',
    rightsHolder: null,
    licensingNotes: null,
    permittedUse: null,
    evidenceNotes: 'Rights holder, current version and distribution terms not yet confirmed by a person.',
  },
  {
    key: 'sensory-profile',
    name: 'Sensory Profile',
    abbreviation: 'Sensory Profile',
    rightsHolder: null,
    licensingNotes: null,
    permittedUse: null,
    evidenceNotes:
      'Commercially published assessment. Edition, publisher and purchase/licence terms not yet '
      + 'confirmed. No form, item content or scoring may be stored in this register.',
  },
  {
    key: 'mohost',
    name: 'Model of Human Occupation Screening Tool',
    abbreviation: 'MOHOST',
    rightsHolder: null,
    licensingNotes: null,
    permittedUse: null,
    evidenceNotes: 'Rights holder, current version and licence terms not yet confirmed by a person.',
  },
];

async function main() {
  const org = (await pool.query(
    'SELECT id FROM organisations ORDER BY created_at LIMIT 1')).rows[0];
  if (!org) throw new Error('No organisation found');
  const owner = (await pool.query(
    `SELECT id FROM users WHERE role = 'owner' AND is_active = TRUE ORDER BY created_at LIMIT 1`)).rows[0];

  console.log(`Organisation: ${org.id}`);
  console.log(`Mode:         ${DRY ? 'DRY RUN' : 'APPLY'}\n`);

  for (const i of INSTRUMENTS) {
    console.log(`${DRY ? 'would seed' : 'seeding'}  ${i.abbreviation.padEnd(16)} ${i.name}`);
    console.log(`     rightsHolder=${i.rightsHolder || '(unresolved)'}  linkedModule=${i.linkedModule || '(none)'}`);
    if (DRY) continue;

    const { rows } = await pool.query(
      `INSERT INTO controlled_instruments (
          organisation_id, key, name, abbreviation, rights_holder,
          licensing_notes, permitted_use, evidence_notes,
          linked_module, linked_module_route, created_by,
          access_restriction, rights_status, clinical_status, evidence_checked, state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
          'clinician','unreviewed','unreviewed',FALSE,'active')
       ON CONFLICT (organisation_id, key) DO UPDATE SET
          name = EXCLUDED.name,
          abbreviation = EXCLUDED.abbreviation,
          linked_module = EXCLUDED.linked_module,
          linked_module_route = EXCLUDED.linked_module_route,
          updated_at = NOW()
       RETURNING id, (xmax = 0) AS inserted`,
      [org.id, i.key, i.name, i.abbreviation, i.rightsHolder || null,
       i.licensingNotes || null, i.permittedUse || null, i.evidenceNotes || null,
       i.linkedModule || null, i.linkedModuleRoute || null, owner ? owner.id : null]);

    if (rows[0].inserted) {
      await pool.query(
        `INSERT INTO controlled_instrument_events
           (organisation_id, instrument_id, field, from_value, to_value, reason, actor_user_id)
         VALUES ($1,$2,'created',NULL,$3,$4,$5)`,
        [org.id, rows[0].id, i.key,
         'Seeded from the controlled instrument register list. All rights and clinical fields '
         + 'left unreviewed pending human confirmation.',
         owner ? owner.id : null]);
    }
  }

  if (!DRY) {
    const { rows } = await pool.query(
      `SELECT abbreviation, key, rights_status, clinical_status, evidence_checked,
              linked_module, edition, rights_holder, source_url, permitted_use
         FROM controlled_instruments WHERE organisation_id = $1 ORDER BY abbreviation`,
      [org.id]);
    console.log('\n── Register state ──');
    for (const r of rows) {
      const unresolved = ['edition', 'rights_holder', 'source_url', 'permitted_use']
        .filter((f) => !r[f]);
      console.log(`  ${r.abbreviation.padEnd(16)} rights=${r.rights_status} clinical=${r.clinical_status} `
        + `evidence=${r.evidence_checked} module=${r.linked_module || '-'}`);
      console.log(`     unresolved: ${unresolved.join(', ') || '(none)'}`);
    }
    const claimed = rows.filter((r) => r.rights_status !== 'unreviewed').length;
    console.log(`\n  rows asserting any licence position: ${claimed} (must be 0)`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('seed failed:', err.message);
  pool.end().catch(() => {});
  process.exit(1);
});
