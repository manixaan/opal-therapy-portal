'use strict';

/**
 * Attach a SPECIMEN scan to every credential that has none.
 *
 *   node backend/scripts/backfill-credential-scans.js                # dry run
 *   node backend/scripts/backfill-credential-scans.js --apply
 *   node backend/scripts/backfill-credential-scans.js --apply --user someone@example.test
 *   node backend/scripts/backfill-credential-scans.js --apply --org <uuid>
 *
 * WHY THIS EXISTS
 * ───────────────
 * The Credentials surface now expects the document behind the claim. Records
 * created before that rule have nothing attached, so a demonstration or
 * training environment shows a wall of "scan missing" and the feature cannot
 * be seen working at all: no preview, no reader, and a Verify button that
 * still means what it used to mean, which is nothing much.
 *
 * This fills that gap with a page that is unmistakably not a certificate —
 * see credential-sample-scan.js for why every specimen is watermarked,
 * red-ruled and stripped of any issuer mark.
 *
 * WHAT IT WILL NOT DO
 * ───────────────────
 * It never replaces an existing attachment, never edits a credential's fields,
 * and never touches verification status. A credential that already carries a
 * real scan is skipped, every time, including on re-runs — which is what makes
 * this safe to run against an environment where some people have already
 * uploaded the real thing.
 *
 * PRODUCTION
 * ──────────
 * Refuses to run against a database whose name does not look like a
 * development, test or staging one unless --i-know-this-is-production is
 * passed. Putting specimen pages into a live compliance register is not a
 * thing to do by accident: staff would see a document against their name that
 * they never uploaded.
 */

const db = require('../database');
const { buildSampleScan, sampleFileName } = require('../credential-sample-scan');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};

const APPLY = has('--apply');
const FORCE_PROD = has('--i-know-this-is-production');
const ONLY_USER = valueOf('--user');
const ONLY_ORG = valueOf('--org');

/**
 * What counts as safe to write specimens into.
 *
 * The name is the weaker signal — the local development database is called
 * plain `therapy_scheduler`, exactly like the one a deployment would use. The
 * HOST is the signal that holds: a database on this machine is a developer's,
 * and the register that must never receive specimen pages is the one behind
 * the Azure deployment.
 */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', ''];
const SAFE_DB_NAME = /(_test|_dev|test|staging|capture|synthetic|demo)/i;

async function main() {
  const dbName = db.pool.options.database || '';
  const dbHost = String(db.pool.options.host || '').toLowerCase();
  const isLocal = LOCAL_HOSTS.includes(dbHost);

  if (!isLocal && !SAFE_DB_NAME.test(dbName) && !FORCE_PROD) {
    console.error(
      `Refusing to run against "${dbName}" on ${dbHost || 'an unnamed host'} — it is\n` +
      'neither local nor obviously a test or staging database. Specimen pages in a\n' +
      'live compliance register are documents staff never uploaded, standing\n' +
      'against their names.\n' +
      'Pass --i-know-this-is-production if that is genuinely what you want.'
    );
    process.exitCode = 1;
    return;
  }

  const filters = [];
  const params = [];
  if (ONLY_USER) { params.push(ONLY_USER); filters.push(`u.email = $${params.length}`); }
  if (ONLY_ORG)  { params.push(ONLY_ORG);  filters.push(`c.organisation_id = $${params.length}`); }

  const { rows } = await db.pool.query(
    `SELECT c.*, u.email AS user_email,
            COALESCE(NULLIF(u.display_name, ''), NULLIF(u.name, ''), u.email) AS user_display_name
       FROM credentials c
       JOIN users u ON u.id = c.user_id
      WHERE c.document_id IS NULL
        ${filters.length ? `AND ${filters.join(' AND ')}` : ''}
      ORDER BY u.email, c.created_at`,
    params
  );

  console.log(`Database : ${dbName} on ${dbHost || 'local socket'}`);
  console.log(`Mode     : ${APPLY ? 'APPLY' : 'dry run (pass --apply to write)'}`);
  console.log(`Found    : ${rows.length} credential(s) with no scan attached\n`);

  if (!rows.length) return;

  const { getBackend, getBackendName } = require('../storage');
  const backendName = getBackendName();
  const backend = getBackend();

  let done = 0;
  let failed = 0;

  for (const cred of rows) {
    const label = `${cred.user_email} · ${cred.credential_name}`;
    if (!APPLY) {
      console.log(`  would attach  ${label}`);
      continue;
    }

    try {
      const pdf = await buildSampleScan(cred, cred.user_display_name || cred.user_email);
      const base64 = pdf.toString('base64');
      const fileName = sampleFileName(cred);

      const doc = await db.createPDDocument({
        userId: cred.user_id,
        organisationId: cred.organisation_id,
        title: `SPECIMEN — ${cred.credential_name}`,
        documentType: 'credential_scan',
        fileName,
        fileMime: 'application/pdf',
        fileSizeBytes: pdf.length,
        fileData: backendName === 'db' ? base64 : null,
        storageBackend: backendName === 'db' ? 'db' : backendName,
      });

      if (backendName !== 'db') {
        const { backend: b, storageKey } = await backend.put({
          userId: cred.user_id, docId: doc.id, fileName, mime: 'application/pdf', base64,
        });
        await db.setPDDocumentStorage(doc.id, { storageBackend: b, storageKey, clearInline: true });
      }

      // Guarded on document_id still being NULL: two copies of this script, or
      // a person uploading their real certificate while it runs, must not end
      // with a specimen overwriting the real thing.
      const linked = await db.pool.query(
        `UPDATE credentials SET document_id = $1, updated_at = NOW()
          WHERE id = $2 AND document_id IS NULL
          RETURNING id`,
        [doc.id, cred.id]
      );
      if (!linked.rows.length) {
        await db.deletePDDocument(doc.id, cred.user_id).catch(() => {});
        console.log(`  skipped       ${label} (a scan appeared while this ran)`);
        continue;
      }

      done += 1;
      console.log(`  attached      ${label}  →  ${fileName} (${pdf.length} bytes)`);
    } catch (err) {
      failed += 1;
      console.error(`  FAILED        ${label}: ${err.message}`);
    }
  }

  if (APPLY) console.log(`\nAttached ${done}, failed ${failed}.`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => db.pool.end());
