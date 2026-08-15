'use strict';

/**
 * Resource Hub storage reconciliation.
 *
 * Answers, with live data, the question the counts kept raising: why does the
 * source vault, the register, the resources table, the file table and the
 * store on disk each report a different number? The totals are DIFFERENT
 * ENTITIES, and this script shows each step of the walk from one to the next
 * so an unexplained discrepancy stands out from an explained one.
 *
 * Read-only. Prints counts, treatments and hashes — never filenames or paths
 * from the vault.
 *
 *   node backend/scripts/audit-resource-storage.js
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('../database');

const STORE_ROOT = process.env.RESOURCE_HUB_STORAGE_PATH
  || '/Users/antonyxavier/Documents/Opal-Resource-Store';

async function one(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

function walkFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name !== '.DS_Store') out.push(full);
    }
  };
  walk(dir);
  return out;
}

async function main() {
  const report = {};

  // ── Register: what the audit decided about every vault item ──────────────
  report.register = {
    total: (await one(`SELECT COUNT(*)::int AS n FROM resource_ingestion_register`))[0].n,
    byTreatment: Object.fromEntries(
      (await one(`SELECT treatment, COUNT(*)::int AS n FROM resource_ingestion_register GROUP BY 1 ORDER BY 2 DESC`))
        .map((r) => [r.treatment, r.n])),
    linkedToResources: (await one(
      `SELECT COUNT(*)::int AS n FROM resource_ingestion_register WHERE linked_resource_id IS NOT NULL`))[0].n,
    linkedToInstruments: (await one(
      `SELECT COUNT(*)::int AS n FROM resource_ingestion_register WHERE linked_instrument_id IS NOT NULL`))[0].n,
  };

  // ── Resources: what therapists and admins can address ────────────────────
  report.resources = {
    total: (await one(`SELECT COUNT(*)::int AS n FROM resources`))[0].n,
    byPublicationState: Object.fromEntries(
      (await one(`SELECT publication_state, COUNT(*)::int AS n FROM resources GROUP BY 1 ORDER BY 2 DESC`))
        .map((r) => [r.publication_state, r.n])),
    archived: (await one(`SELECT COUNT(*)::int AS n FROM resources WHERE archived_at IS NOT NULL`))[0].n,
    externalLink: (await one(`SELECT COUNT(*)::int AS n FROM resources WHERE external_url IS NOT NULL`))[0].n,
    withHostedFiles: (await one(
      `SELECT COUNT(DISTINCT resource_id)::int AS n FROM resource_files WHERE storage_key IS NOT NULL`))[0].n,
  };

  // ── Files and blobs ──────────────────────────────────────────────────────
  const fileRows = await one(
    `SELECT storage_key, checksum_sha256 FROM resource_files WHERE storage_key IS NOT NULL`);
  const distinctKeys = new Set(fileRows.map((r) => r.storage_key));
  const distinctHashes = new Set(fileRows.map((r) => r.checksum_sha256).filter(Boolean));

  const derivRows = await one(
    `SELECT storage_key, kind FROM resource_file_derivatives`);

  const diskAll = walkFiles(STORE_ROOT).map((f) => path.relative(STORE_ROOT, f));
  const diskOriginals = diskAll.filter((k) => !k.startsWith('derivatives/'));
  const diskDerivatives = diskAll.filter((k) => k.startsWith('derivatives/'));

  const diskSet = new Set(diskAll);
  const missingBlobs = [...distinctKeys].filter((k) => !diskSet.has(k));
  const missingDerivatives = derivRows.filter((r) => !diskSet.has(r.storage_key));
  const referenced = new Set([...distinctKeys, ...derivRows.map((r) => r.storage_key)]);
  const orphanBlobs = diskAll.filter((k) => !referenced.has(k));

  let storeBytes = 0;
  for (const k of diskAll) {
    try { storeBytes += fs.statSync(path.join(STORE_ROOT, k)).size; } catch { /* raced */ }
  }

  report.files = {
    fileRows: fileRows.length,
    distinctStorageKeys: distinctKeys.size,
    distinctContentHashes: distinctHashes.size,
    sharedKeyPairs: fileRows.length - distinctKeys.size,
    derivativeRows: derivRows.length,
  };
  report.store = {
    root: STORE_ROOT,
    originals: diskOriginals.length,
    derivatives: diskDerivatives.length,
    totalBytes: storeBytes,
    totalMB: Math.round(storeBytes / 1024 / 1024),
    missingBlobs: missingBlobs.length,
    missingDerivativeBlobs: missingDerivatives.length,
    orphanBlobs: orphanBlobs.length,
  };

  // ── The walk from 650 register rows to hosted files ──────────────────────
  const t = report.register.byTreatment;
  report.reconciliation = {
    registerRows: report.register.total,
    'privacy-excluded (never hosted, identity nulled)': t['privacy-excluded'] || 0,
    'duplicate-archived (master row carries the copy)': t['duplicate-archived'] || 0,
    'unavailable-placeholder (iCloud stub, no real bytes)': t['unavailable-placeholder'] || 0,
    'rejected-quality (junk found hosted, since removed)': t['rejected-quality'] || 0,
    'controlled-register (instrument metadata only)': t['controlled-register'] || 0,
    'rights-review (hosted, admin queue only)': t['rights-review'] || 0,
    'hosted for staff (vendor/official/staff-only/opal-drafts)':
      (t['live-vendor-link'] || 0) + (t['live-official-link'] || 0)
      + (t['staff-only'] || 0) + (t['opal-original-draft'] || 0),
  };

  // Resources with no register row: clean-room originals and R1-era content.
  report.resourcesNotFromRegister = (await one(
    `SELECT COUNT(*)::int AS n FROM resources r
      WHERE NOT EXISTS (SELECT 1 FROM resource_ingestion_register reg WHERE reg.linked_resource_id = r.id)`))[0].n;

  console.log(JSON.stringify(report, null, 1));

  const problems = [];
  if (missingBlobs.length) problems.push(`${missingBlobs.length} file rows point at missing blobs`);
  if (missingDerivatives.length) problems.push(`${missingDerivatives.length} derivative rows point at missing blobs`);
  if (orphanBlobs.length) problems.push(`${orphanBlobs.length} orphan blobs on disk`);
  if (problems.length) {
    console.error(`\nPROBLEMS: ${problems.join('; ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nCONSISTENT: every DB reference resolves to a blob and every blob is referenced.');
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
