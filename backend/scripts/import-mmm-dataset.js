#!/usr/bin/env node
'use strict';

/**
 * Import an official Modified Monash Model boundary dataset for billing.
 *
 * Source (MMM 2023, Department of Health, Disability and Ageing):
 *   https://data.gov.au/data/dataset/modified-monash-model-mmm-2023
 *   → "MMM 2023.zip" (contains MMM/MMM_2023b.zip → MMM2023.shp / .dbf,
 *     seven dissolved multipolygons built from ABS SA1 2021, GDA94).
 *
 * Usage (from backend/):
 *   node scripts/import-mmm-dataset.js --shp path/MMM2023.shp --dbf path/MMM2023.dbf \
 *        --version MMM2023b --published 2025-03-10 [--activate]
 *
 * Idempotent per version: re-importing a version replaces its rings. With
 * --activate the new version becomes the one billing classifies against;
 * stored client zones are re-checked automatically on their next use because
 * the address fingerprint includes the dataset version.
 *
 * Runs against the database in backend/.env. It writes reference data only
 * (no client data); run it locally first, and in staging/production only as
 * part of an authorised release.
 */

require('dotenv').config();
const fs = require('fs');
const { parseShapefile } = require('../billing/mmm-geometry');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

async function importDataset(pool, { shp, dbf, version, published, source, sourceUrl, activate }) {
  const records = parseShapefile(fs.readFileSync(shp), fs.readFileSync(dbf));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [ds] } = await client.query(
      `INSERT INTO mmm_datasets (version, source, source_url, published_on)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (version) DO UPDATE SET source = EXCLUDED.source, source_url = EXCLUDED.source_url,
         published_on = EXCLUDED.published_on, imported_at = NOW()
       RETURNING id`, [version, source, sourceUrl, published || null]);
    await client.query(`DELETE FROM mmm_dataset_rings WHERE dataset_id = $1`, [ds.id]);
    let n = 0;
    for (const rec of records) {
      for (const [i, ring] of rec.rings.entries()) {
        await client.query(
          `INSERT INTO mmm_dataset_rings (dataset_id, mmm, part_index, min_lng, min_lat, max_lng, max_lat, coords)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [ds.id, rec.mmm, i, ring.bbox[0], ring.bbox[1], ring.bbox[2], ring.bbox[3],
            Buffer.from(ring.coords.buffer, ring.coords.byteOffset, ring.coords.byteLength)]);
        n++;
      }
    }
    await client.query(`UPDATE mmm_datasets SET ring_count = $2 WHERE id = $1`, [ds.id, n]);
    if (activate) {
      await client.query(`UPDATE mmm_datasets SET is_active = FALSE WHERE is_active AND id <> $1`, [ds.id]);
      await client.query(`UPDATE mmm_datasets SET is_active = TRUE WHERE id = $1`, [ds.id]);
    }
    await client.query('COMMIT');
    return { datasetId: ds.id, rings: n, records: records.length };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  (async () => {
    const shp = arg('shp'), dbf = arg('dbf'), version = arg('version');
    if (!shp || !dbf || !version) {
      console.error('Usage: node scripts/import-mmm-dataset.js --shp <file.shp> --dbf <file.dbf> --version <label> [--published YYYY-MM-DD] [--activate]');
      process.exit(2);
    }
    const { pool } = require('../database');
    try {
      const r = await importDataset(pool, {
        shp, dbf, version, published: arg('published'),
        source: arg('source') || 'Department of Health, Disability and Ageing — Modified Monash Model 2023 (data.gov.au)',
        sourceUrl: arg('source-url') || 'https://data.gov.au/data/dataset/modified-monash-model-mmm-2023',
        activate: process.argv.includes('--activate'),
      });
      console.log(`Imported ${version}: ${r.records} MM categories, ${r.rings} rings${process.argv.includes('--activate') ? ' (active)' : ''}.`);
    } catch (e) {
      console.error('Import failed:', e.message);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  })();
}

module.exports = { importDataset };
