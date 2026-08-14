#!/usr/bin/env node
'use strict';

/**
 * Classify existing Resource Hub records into `source_class` from the evidence
 * already in the row (`authority_level`), so the publisher badge tells the
 * truth about authorship.
 *
 * WHAT THIS IS NOT
 * This is a classification of AUTHORSHIP, not a rights review. `rights_status`
 * is deliberately left at 'unreviewed' for every row it touches: knowing who
 * wrote something tells you nothing about whether Opal may host, modify or
 * redistribute it. Because approvalBlockers() refuses any record whose rights
 * are unreviewed, nothing here becomes approvable or publishable as a result.
 *
 * Mapping, and why each is defensible:
 *   internal            -> opal-original   Opal-authored hub content. Several of
 *                                          these cite an external source_publisher
 *                                          (e.g. the NDIS guides link ndis.gov.au);
 *                                          that records the source they POINT AT,
 *                                          not who wrote them. They contain no
 *                                          reproduced third-party text.
 *   official_regulatory -> government-official
 *   professional_body   -> nonprofit
 *   external_reference  -> (left 'unknown') Genuinely ambiguous. These need a
 *                                          human to say who published them, and
 *                                          leaving them unknown means they render
 *                                          "Source under review" rather than
 *                                          claiming an authorship we cannot verify.
 *
 * Idempotent and non-clobbering: only rows still sitting at the migration
 * default 'unknown' are touched, so a human reclassification is never undone by
 * a re-run. Run with --dry-run to preview.
 *
 *   node backend/setup/classify-resource-source-class.js --dry-run
 *   node backend/setup/classify-resource-source-class.js
 */

require('dotenv').config();
const { pool } = require('../database');

const MAP = {
  internal: 'opal-original',
  opal_approved: 'opal-original',
  official_regulatory: 'government-official',
  professional_body: 'nonprofit',
  // external_reference is intentionally absent — see the header.
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const { rows: before } = await pool.query(
    `SELECT authority_level, source_class, COUNT(*)::int AS c
       FROM resources GROUP BY 1, 2 ORDER BY 1, 2`);
  console.log('Before:');
  for (const r of before) {
    console.log(`  authority=${String(r.authority_level).padEnd(20)} source_class=${String(r.source_class).padEnd(24)} ${r.c}`);
  }

  let total = 0;
  for (const [authority, sourceClass] of Object.entries(MAP)) {
    const sql = dryRun
      ? `SELECT COUNT(*)::int AS c FROM resources
          WHERE authority_level = $1 AND source_class = 'unknown'`
      : `UPDATE resources SET source_class = $2, updated_at = NOW()
          WHERE authority_level = $1 AND source_class = 'unknown'
          RETURNING id`;
    const params = dryRun ? [authority] : [authority, sourceClass];
    const res = await pool.query(sql, params);
    const n = dryRun ? res.rows[0].c : res.rowCount;
    total += n;
    if (n) console.log(`${dryRun ? 'would set' : 'set'} ${n} row(s): ${authority} -> ${sourceClass}`);
  }

  const { rows: left } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM resources WHERE source_class = 'unknown'`);
  const { rows: rights } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM resources WHERE rights_status <> 'unreviewed'`);

  console.log(`\n${dryRun ? 'Would classify' : 'Classified'}: ${total}`);
  console.log(`Still 'unknown' (need a human): ${left[0].c}`);
  console.log(`Rows with a reviewed rights status: ${rights[0].c} — classification does not review rights.`);

  await pool.end();
}

main().catch((err) => {
  console.error('classify failed:', err.message);
  pool.end().catch(() => {});
  process.exit(1);
});
