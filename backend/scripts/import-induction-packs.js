#!/usr/bin/env node
'use strict';

/**
 * IMPORT INDUCTION PACKS — place every backend/induction-packs/*.json in an
 * organisation's Assign Learning as a draft, without opening the portal.
 *
 *   npm run inductions:import                        # the first owner's organisation
 *   npm run inductions:import -- --email owner@x     # a named owner's organisation
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

async function main() {
  const i = process.argv.indexOf('--email');
  const owner = await resolveOwner(i > -1 ? process.argv[i + 1] : null);
  const { created, skipped } = await importInductionPacks(owner.organisation_id, owner.id);
  created.forEach((c) => console.log(`✓ added   ${c.title} (${c.items} items, draft)`));
  skipped.forEach((s) => console.log(`· skipped ${s.title} — ${s.reason.replace(/_/g, ' ')}`));
  if (!created.length && !skipped.length) console.log('No induction packs found.');
}

main()
  .catch((e) => { console.error(`✗ ${e.message}`); process.exitCode = 1; })
  .finally(() => pool.end());
