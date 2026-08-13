'use strict';

/**
 * Bring catalogued source documents into the hub as real, downloadable files.
 *
 * WHAT CHANGED, AND WHY THIS SCRIPT EXISTS
 * The register was built on the rule that Opal links to a rights holder rather
 * than hosting their file. The practice owner has since decided the documents
 * are to be hosted and organised regardless of whether a canonical source URL
 * could be found. This script implements that decision.
 *
 * WHAT IT DOES NOT DO
 * It does not invent a licence. `rights_status` travels from the register to
 * `resources.copyright_status` unchanged — an unreviewed item stays unreviewed
 * once it is in the hub, so the record keeps telling the truth about what has
 * actually been confirmed.
 *
 * Files are copied, never moved: the source folder is left untouched.
 *
 * Idempotent. A register row already carrying linked_resource_id is skipped, so
 * the script can be re-run after a partial batch without duplicating anything.
 *
 *   node backend/scripts/ingest-resource-files.js --limit 20        # pilot
 *   node backend/scripts/ingest-resource-files.js --all             # everything
 *   node backend/scripts/ingest-resource-files.js --dry-run         # no writes
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('../database');

const SOURCE_ROOT = '/Users/antonyxavier/Documents/7 Resources';
// Deliberately outside the repository: 1.6 GB of third-party documents must
// never become committable, and .gitignore is one careless `git add -f` away
// from being bypassed.
const STORE_ROOT = process.env.DOCUMENT_STORAGE_PATH
  || '/Users/antonyxavier/Documents/Opal-Resource-Store';

const MIME = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.zip': 'application/zip',
};

/** resource_files.format vocabulary. Anything else is stored as NULL. */
const ALLOWED_FORMATS = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'png', 'jpg', 'link']);

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ALL = args.includes('--all');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? parseInt(args[i + 1], 10) : (ALL ? 100000 : 20);
})();

/** Build filename -> absolute path once. 650 files, one walk. */
function indexSourceTree(root) {
  const index = new Map();
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === '.DS_Store') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      // First match wins; duplicates across folders are already resolved in the
      // register as duplicate-archived, so a collision here is not a decision.
      else if (!index.has(e.name)) index.set(e.name, full);
    }
  };
  walk(root);
  return index;
}

async function folderIdFor(client, orgId, name, cache) {
  if (cache.has(name)) return cache.get(name);
  const { rows: found } = await client.query(
    `SELECT id FROM resource_folders
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND name = $2 AND parent_id IS NULL`,
    [orgId, name]);
  let id = found[0] && found[0].id;
  if (!id) {
    const { rows } = await client.query(
      `INSERT INTO resource_folders (organisation_id, name, description)
       VALUES ($1, $2, $3) RETURNING id`,
      [orgId, name, 'Catalogued practice resources, grouped by resource type.']);
    id = rows[0].id;
  }
  cache.set(name, id);
  return id;
}

/** Human-readable folder name for a register resource_type slug. */
function folderName(resourceType) {
  if (!resourceType) return 'Uncategorised';
  return resourceType
    .split('-or-')[0]
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function main() {
  console.log(`source : ${SOURCE_ROOT}`);
  console.log(`store  : ${STORE_ROOT}`);
  console.log(`mode   : ${DRY ? 'DRY RUN' : 'WRITE'}  limit=${LIMIT}\n`);

  const index = indexSourceTree(SOURCE_ROOT);
  console.log(`indexed ${index.size} files on disk\n`);

  const { rows } = await pool.query(
    `SELECT id, catalogue_id, organisation_id, source_filename, source_reference,
            proposed_title, resource_type, rights_status, topic, source_organisation,
            ingestion_status
       FROM resource_ingestion_register
      -- 'blocked' is excluded too: those 10 rows point at iCloud placeholder
      -- stubs rather than real documents, so importing them would store an
      -- empty shell and report it as a resource.
      WHERE ingestion_status NOT IN ('excluded','archived','blocked')
        AND linked_resource_id IS NULL
        AND source_filename IS NOT NULL
      ORDER BY resource_type, catalogue_id
      LIMIT $1`, [LIMIT]);

  console.log(`${rows.length} register rows to process\n`);

  const cache = new Map();
  const stats = { imported: 0, missingFile: 0, failed: 0, bytes: 0 };
  const missing = [];

  for (const row of rows) {
    const src = index.get(row.source_filename);
    if (!src) { stats.missingFile++; missing.push(row.catalogue_id); continue; }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const folderId = await folderIdFor(client, row.organisation_id, folderName(row.resource_type), cache);
      const ext = path.extname(row.source_filename).toLowerCase();
      const buf = fs.readFileSync(src);
      const checksum = crypto.createHash('sha256').update(buf).digest('hex');
      // Content-addressed, so re-running cannot write a second copy and the
      // stored name never echoes the source filename.
      const storageKey = `resources/${checksum.slice(0, 2)}/${checksum}${ext}`;
      const dest = path.join(STORE_ROOT, storageKey);

      if (!DRY) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);
      }

      const title = (row.proposed_title || row.source_filename.replace(ext, '')).slice(0, 300);
      const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 140)}-${row.catalogue_id}`;

      let resourceId = null;
      if (!DRY) {
        const { rows: created } = await client.query(
          `INSERT INTO resources
             (organisation_id, folder_id, title, resource_type, status, visibility,
              source_reference, copyright_status, slug, content_type, authority_level)
           -- 'approved' is the only status the hub lists (resource-hub-r2-routes.js:453),
           -- so it is required for these to be usable at all. approved_by and
           -- approved_at are deliberately left NULL: this was a bulk import on
           -- the owner's instruction, and no person reviewed these individually.
           -- A populated approver would be a fabricated governance record.
           VALUES ($1,$2,$3,$4,'approved','staff',$5,$6,$7,'document','internal')
           RETURNING id`,
          [row.organisation_id, folderId, title, row.resource_type,
            row.source_organisation || row.source_reference,
            // Never upgraded here. Unreviewed in the register stays unreviewed.
            row.rights_status || 'unreviewed', slug]);
        resourceId = created[0].id;

        await client.query(
          `INSERT INTO resource_files
             (resource_id, file_name, file_mime, file_size_bytes, storage_backend,
              storage_key, checksum_sha256, is_primary, format)
           VALUES ($1,$2,$3,$4,'local',$5,$6,TRUE,$7)`,
          [resourceId, row.source_filename, MIME[ext] || 'application/octet-stream',
            buf.length, storageKey, checksum,
            // The column's vocabulary is deliberately narrow. A legacy .doc,
            // .ppt or .zip is stored with format NULL rather than widening a
            // constraint to suit an import — file_mime and file_name still
            // carry the real type, so nothing is lost.
            ALLOWED_FORMATS.has(ext.replace('.', '')) ? ext.replace('.', '') : null]);

        await client.query(
          `UPDATE resource_ingestion_register
              SET linked_resource_id = $2, ingestion_status = 'imported', updated_at = NOW()
            WHERE id = $1`, [row.id, resourceId]);

        // NO .catch() HERE, DELIBERATELY.
        // This previously ended `.catch(() => {})`, and referenced columns that
        // do not exist. In PostgreSQL a failed statement aborts the whole
        // transaction, so every COMMIT after it silently became a ROLLBACK —
        // the script reported 20 imports and wrote nothing at all. Swallowing
        // an error inside a transaction does not skip the statement, it poisons
        // everything that follows.
        await client.query(
          `INSERT INTO resource_ingestion_events
             (organisation_id, register_id, catalogue_id, field, from_value, to_value, reason)
           VALUES ($1,$2,$3,'ingestion_status',$4,'imported',$5)`,
          [row.organisation_id, row.id, row.catalogue_id, row.ingestion_status || null,
            'File hosted in the hub by owner decision; rights_status unchanged.']);
      }

      await client.query('COMMIT');
      stats.imported++;
      stats.bytes += buf.length;
      if (stats.imported % 25 === 0) console.log(`  ${stats.imported} imported…`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      stats.failed++;
      console.warn(`  FAILED ${row.catalogue_id}: ${err.message}`);
    } finally {
      client.release();
    }
  }

  console.log(`\nimported     : ${stats.imported}`);
  console.log(`missing file : ${stats.missingFile}${missing.length ? ` (${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''})` : ''}`);
  console.log(`failed       : ${stats.failed}`);
  console.log(`bytes stored : ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
