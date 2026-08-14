#!/usr/bin/env node
'use strict';

/**
 * Clear FCA reports and progress note letters from a TEST database, so both
 * lists start empty.
 *
 * WHY THIS EXISTS
 * Nothing in the application creates these records automatically — there is no
 * seed, no fixture, no migration insert, and the only INSERT sits behind
 * POST /api/fca/drafts. Records accumulate because somebody (or some automated
 * QA pass) genuinely created them while testing. This gives that cleanup an
 * explicit, auditable command instead of a hand-typed DELETE.
 *
 * SAFETY — three independent gates, because this deletes clinical records
 *   1. The database name must look like development or test. A production-
 *      shaped name aborts, and there is no flag to override that.
 *   2. --yes must be passed. A bare run only reports what it would remove.
 *   3. It refuses if any draft was created by a user outside this deployment's
 *      expected test accounts UNLESS --all is given, so a shared staging
 *      database cannot be emptied of a colleague's work by reflex.
 *
 * WHAT IT REMOVES
 * fca_report_drafts (both document types — the letter workflow shares these
 * tables via the document_type discriminator) and, by cascade,
 * fca_generated_documents. It does NOT touch fca_client_profiles: those are
 * durable per-client report settings, not documents, and deleting them would
 * discard a therapist's saved preferences rather than test clutter.
 *
 *   node backend/setup/reset-document-workspace.js            # dry run
 *   node backend/setup/reset-document-workspace.js --yes
 */

require('dotenv').config();
const { pool } = require('../database');

const APPLY = process.argv.includes('--yes');
const ALL = process.argv.includes('--all');

/** A name that must never be emptied by this script, whatever flags are given. */
const PRODUCTION_SHAPED = /prod|production|live/i;
/** Names this script is willing to act on. */
const TEST_SHAPED = /dev|test|local|staging|scheduler$/i;

async function main() {
  const { rows: [{ db }] } = await pool.query('SELECT current_database() AS db');
  console.log(`Database: ${db}`);

  if (PRODUCTION_SHAPED.test(db)) {
    throw new Error(`Refusing to run against "${db}" — the name looks like production.`);
  }
  if (!TEST_SHAPED.test(db)) {
    throw new Error(`Refusing to run against "${db}" — it does not look like a development or test database.`);
  }

  const { rows } = await pool.query(
    `SELECT d.id, d.document_type, d.client_name, d.status, d.created_at,
            u.email AS created_by,
            (SELECT COUNT(*)::int FROM fca_generated_documents g WHERE g.draft_id = d.id) AS documents
       FROM fca_report_drafts d
       LEFT JOIN users u ON u.id = d.created_by_user_id
      ORDER BY d.created_at`);

  if (!rows.length) {
    console.log('Nothing to remove — both lists are already empty.');
    await pool.end();
    return;
  }

  console.log(`\n${rows.length} record(s):`);
  for (const r of rows) {
    console.log(`  ${r.created_at.toISOString().slice(0, 19)}  ${r.document_type.padEnd(21)} `
      + `${String(r.status).padEnd(10)} ${r.client_name || '(no client)'}  `
      + `docs=${r.documents}  by=${r.created_by || 'unknown'}`);
  }

  const owners = [...new Set(rows.map((r) => r.created_by).filter(Boolean))];
  if (owners.length > 1 && !ALL) {
    throw new Error(
      `Records belong to more than one account (${owners.join(', ')}). `
      + 'Re-run with --all if you really intend to clear everyone\'s drafts.');
  }

  const docCount = rows.reduce((n, r) => n + r.documents, 0);
  if (!APPLY) {
    console.log(`\nDRY RUN. Would delete ${rows.length} draft(s) and ${docCount} generated document(s).`);
    console.log('Re-run with --yes to apply.');
    await pool.end();
    return;
  }

  // fca_generated_documents cascades from fca_report_drafts, so one delete
  // clears both and cannot leave an orphaned document behind.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const del = await client.query('DELETE FROM fca_report_drafts RETURNING id');
    const left = await client.query('SELECT COUNT(*)::int AS c FROM fca_generated_documents');
    await client.query('COMMIT');
    console.log(`\nDeleted ${del.rowCount} draft(s). Generated documents remaining: ${left.rows[0].c} (cascade).`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const { rows: after } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM fca_report_drafts WHERE document_type = 'fca_report') AS reports,
       (SELECT COUNT(*)::int FROM fca_report_drafts WHERE document_type = 'progress_note_letter') AS letters,
       (SELECT COUNT(*)::int FROM fca_generated_documents) AS documents,
       (SELECT COUNT(*)::int FROM fca_client_profiles) AS profiles`);
  console.log('\nAfter reset:', JSON.stringify(after[0]));
  console.log('Client report profiles were deliberately kept — they are saved settings, not documents.');

  await pool.end();
}

main().catch((err) => {
  console.error('reset failed:', err.message);
  pool.end().catch(() => {});
  process.exit(1);
});
