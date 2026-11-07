#!/usr/bin/env node
'use strict';

/**
 * IMPORT INDUCTION PACKS — place every backend/induction-packs/*.json in an
 * organisation's Assign Learning as a draft, without opening the portal.
 *
 *   npm run inductions:import                        # the first owner's organisation
 *   npm run inductions:import -- --email owner@x     # a named owner's organisation
 *   npm run inductions:import -- --refresh           # also refresh revised packs
 *
 * --refresh brings a revised pack into a database that already holds it, for
 * as long as it is safe to: a workflow that has never been assigned
 * (current_version 0, so no learner has a pinned copy) has its draft replaced,
 * matched on the pack title ignoring case; and each pack walkthrough whose
 * steps differ from its published version gets a new published version, the
 * way the workshop's Publish does — learners mid-way restart that module on
 * their next visit, which is the engine's normal rule for an update. A
 * workflow that HAS been assigned is left alone and reported.
 *
 * Runs exactly what "Import existing" runs for packs (importInductionPacks in
 * learning-routes.js): idempotent by title, so a pack already present — and
 * any edits the Owner has made to it — is left alone. Local databases only;
 * it reads backend/.env like the server does.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { pool } = require('../database');
const { importInductionPacks } = require('../learning-routes');
const lc = require('../learning-content');
const { loadPacks } = require('../induction-packs');

async function resolveOwner(email) {
  let { rows } = email
    ? await pool.query(
      `SELECT id, organisation_id FROM users WHERE lower(email) = lower($1) AND role = 'owner'`, [email])
    : await pool.query(
      `SELECT id, organisation_id FROM users WHERE role = 'owner' AND organisation_id IS NOT NULL ORDER BY created_at LIMIT 1`);
  if (!rows.length || !rows[0].organisation_id) {
    throw new Error(email ? `No owner login with an organisation for ${email}` : 'No owner login with an organisation found');
  }
  return rows[0];
}

async function refreshPacks(org) {
  const { packs } = loadPacks();
  for (const p of packs) {
    const content = { sections: p.sections };
    if (p.sequential) content.sequential = true;
    const { rows: wfs } = await pool.query(
      `SELECT id, title, current_version FROM learning_workflows
        WHERE organisation_id IS NOT DISTINCT FROM $1 AND lower(trim(title)) = lower(trim($2))`, [org, p.title]);
    for (const w of wfs) {
      if (Number(w.current_version) > 0) { console.log(`· kept    ${w.title} — already assigned, edit it in the portal`); continue; }
      await pool.query(
        `UPDATE learning_workflows SET title = $2, description = $3, category = $4, draft_content = $5, updated_at = NOW()
          WHERE id = $1`, [w.id, p.title, p.description, p.category, JSON.stringify(content)]);
      console.log(`↻ refreshed ${p.title} (draft)`);
    }
    for (const m of p.walkthroughs) {
      const { rows } = await pool.query(
        `SELECT m.id, m.current_version, v.steps, v.title, v.description FROM walkthrough_modules m
           LEFT JOIN walkthrough_module_versions v ON v.module_id = m.id AND v.version = m.current_version
          WHERE m.organisation_id IS NOT DISTINCT FROM $1 AND m.key = $2`, [org, m.key]);
      const row = rows[0];
      if (!row) continue;
      // Step keys are generated when absent, so compare without them.
      const strip = (steps) => (steps || []).map((s) => Object.assign({}, s, { key: undefined }));
      const same = lc.equalContent(strip(row.steps), strip(m.steps)) && row.title === m.title && (row.description || '') === m.description;
      if (same) continue;
      const v = Number(row.current_version) + 1;
      await pool.query(
        `UPDATE walkthrough_modules SET title = $2, description = $3, minutes = $4, thumb = $5,
                start_context = $6::jsonb, draft_steps = $7::jsonb, current_version = $8, updated_at = NOW()
          WHERE id = $1`,
        [row.id, m.title, m.description, m.minutes, m.thumb || null, JSON.stringify(m.start_context), JSON.stringify(m.steps), v]);
      await pool.query(
        `INSERT INTO walkthrough_module_versions (module_id, version, title, description, minutes, roles, thumb, start_context, steps)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb)`,
        [row.id, v, m.title, m.description, m.minutes, JSON.stringify(m.roles), m.thumb || null,
          JSON.stringify(m.start_context), JSON.stringify(m.steps)]);
      console.log(`↻ republished walkthrough ${m.key} → v${v}`);
    }
  }
}

async function main() {
  const i = process.argv.indexOf('--email');
  const owner = await resolveOwner(i > -1 ? process.argv[i + 1] : null);
  if (process.argv.includes('--refresh')) await refreshPacks(owner.organisation_id);
  const { created, skipped } = await importInductionPacks(owner.organisation_id, owner.id);
  created.forEach((c) => console.log(`✓ added   ${c.title} (${c.items} items, draft)`));
  skipped.forEach((s) => console.log(`· skipped ${s.title} — ${s.reason.replace(/_/g, ' ')}`));
  if (!created.length && !skipped.length) console.log('No induction packs found.');
}

main()
  .catch((e) => { console.error(`✗ ${e.message}`); process.exitCode = 1; })
  .finally(() => pool.end());
