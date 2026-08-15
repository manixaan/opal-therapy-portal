'use strict';

/**
 * Batch preview generation for every eligible hosted Resource Hub file.
 *
 * Idempotent: a re-run regenerates only what is missing or stale (original
 * changed, renderer version bumped). Excluded/retired/archived material is
 * refused by the service itself.
 *
 *   node backend/scripts/generate-resource-previews.js            # everything
 *   node backend/scripts/generate-resource-previews.js --limit 20 # pilot
 */

const { pool } = require('../database');
const previews = require('../resource-preview-service');

const args = process.argv.slice(2);
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? parseInt(args[i + 1], 10) : 100000;
})();

async function main() {
  const { rows } = await pool.query(
    `SELECT f.id, f.storage_key, f.format, f.checksum_sha256, f.access_tier,
            r.publication_state, r.archived_at
       FROM resource_files f
       JOIN resources r ON r.id = f.resource_id
      WHERE f.storage_key IS NOT NULL
      ORDER BY f.uploaded_at, f.id
      LIMIT $1`, [LIMIT]);

  console.log(`${rows.length} hosted files to check\n`);
  const tally = {};
  let done = 0;
  for (const row of rows) {
    const res = await previews.ensureDerivatives(pool, row);
    for (const r of res.results) {
      const bucket = `${res.format || 'unknown'}:${r.kind}:${r.outcome}`;
      tally[bucket] = (tally[bucket] || 0) + 1;
    }
    done += 1;
    if (done % 50 === 0) console.log(`  ${done}/${rows.length}…`);
  }

  console.log('\noutcomes:');
  for (const k of Object.keys(tally).sort()) console.log(`  ${k}  ${tally[k]}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
