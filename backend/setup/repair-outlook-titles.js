/**
 * REPAIR OUTLOOK TITLES / LOCATIONS / CATEGORIES
 *
 * Recovery for the delta partial-payload data-loss bug (fixed 2026-08-10).
 *
 * WHAT WENT WRONG
 *   Microsoft Graph delta responses are partial — a changed event returns its
 *   id plus only the properties that actually changed. The old delta mapping
 *   collapsed every absent property into a value ('' / [] / null) and
 *   upsertOutlookEvent wrote those over the stored row, so a delta touch that
 *   omitted `subject` replaced the real title with the literal '(No title)'.
 *   Recurring occurrences are re-emitted often, so they were hit repeatedly.
 *
 * WHAT THIS DOES
 *   Finds locally-damaged Outlook-sourced rows and re-reads each one from
 *   Graph by id (a full single-resource GET, so its values are authoritative),
 *   then restores title / location / categories. Rows Graph no longer knows
 *   about (404 — genuinely deleted in Outlook) are left untouched and counted.
 *
 * SAFETY
 *   • Read-only unless you drop --dry-run.
 *   • Never touches app-created rows (created_by_source = 'app').
 *   • Never overwrites a manual location override.
 *   • Only ever writes values Graph actually returned; empty Graph values are
 *     skipped rather than written, so the run is fully idempotent.
 *   • Interruptible: re-running simply re-selects whatever is still damaged.
 *   • Subjects are never bulk-logged — at most 10 samples, dry-run only.
 *
 * USAGE
 *   cd "/Users/antonyxavier/Documents/Claude/Projects/Therapy Scheduling Application"
 *   node backend/setup/repair-outlook-titles.js --dry-run
 *   node backend/setup/repair-outlook-titles.js --dry-run --limit 50
 *   node backend/setup/repair-outlook-titles.js                  # apply
 *   node backend/setup/repair-outlook-titles.js --user someone@example.com
 *
 * FLAGS
 *   --dry-run          report only; makes no database writes
 *   --limit N          process at most N damaged rows per user
 *   --user EMAIL       restrict to one connected account
 *   --concurrency N    parallel Graph reads (default 4, max 8)
 *   --page N           rows selected per database page (default 200)
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db         = require('../database');
const outlookApi = require('../outlook-oauth');
const { decrypt } = require('../crypto-utils');

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { dryRun: false, limit: Infinity, user: null, concurrency: 4, page: 200 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '--dryrun') args.dryRun = true;
    else if (a === '--limit')       args.limit       = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (a === '--user')        args.user        = argv[++i];
    else if (a === '--concurrency') args.concurrency = Math.min(8, Math.max(1, parseInt(argv[++i], 10) || 4));
    else if (a === '--page')        args.page        = Math.min(1000, Math.max(10, parseInt(argv[++i], 10) || 200));
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else if (a.startsWith('--')) { console.error(`Unknown flag: ${a}`); printHelp(); process.exit(1); }
  }
  return args;
}

function printHelp() {
  console.log(`
Repair Outlook titles/locations/categories damaged by the delta partial-payload bug.

  --dry-run          report only, no writes
  --limit N          process at most N damaged rows per user
  --user EMAIL       restrict to one connected account
  --concurrency N    parallel Graph reads (default 4, max 8)
  --page N           database page size (default 200)
`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Token handling ───────────────────────────────────────────────────────────
// Mirrors server.js getValidTokenForUser: tokens are encrypted at rest and are
// refreshed when within a minute of expiry. Tokens are never logged.
async function getValidToken(userRow) {
  const expiresAt = userRow.token_expires_at ? new Date(userRow.token_expires_at) : null;
  const isExpired = !expiresAt || (expiresAt - new Date()) < 60 * 1000;

  if (!isExpired) {
    const token = decrypt(userRow.access_token);
    if (!token) throw new Error('stored access token could not be decrypted');
    return token;
  }
  if (!userRow.refresh_token) throw new Error('access token expired and no refresh token stored');
  const refreshToken = decrypt(userRow.refresh_token);
  if (!refreshToken) throw new Error('stored refresh token could not be decrypted');
  const refreshed = await outlookApi.refreshAccessToken(refreshToken);
  await db.updateUserTokens(userRow.id, refreshed.accessToken, refreshed.refreshToken, refreshed.expiresIn);
  return refreshed.accessToken;
}

// ── Candidate selection ──────────────────────────────────────────────────────
// Damaged = an Outlook-sourced, live row whose title looks like one of the
// placeholder wipes, or whose categories were flattened to empty.
// Keyset pagination on id keeps the run resumable and memory-flat.
const CANDIDATE_SQL = `
  SELECT id, outlook_id, title, location, categories, is_manual_location_override
  FROM events
  WHERE user_id = $1
    AND source = 'outlook'
    AND outlook_id IS NOT NULL
    AND (is_deleted IS NULL OR is_deleted = FALSE)
    AND created_by_source IS DISTINCT FROM 'app'
    AND (
          title IN ('(No title)', '(No subject)', '')
          OR title IS NULL
          OR categories IS NULL
          OR cardinality(categories) = 0
        )
    AND id > $2
  ORDER BY id
  LIMIT $3
`;

// Restores only what Graph actually supplied. NULL parameters fall through
// COALESCE and leave the stored value alone, and the app/override guards are
// enforced in SQL as well as in JS so a bad caller cannot bypass them.
const REPAIR_SQL = `
  UPDATE events
  SET title      = COALESCE($1, title),
      location   = CASE WHEN is_manual_location_override = TRUE THEN location ELSE COALESCE($2, location) END,
      categories = COALESCE($3, categories),
      updated_at = CURRENT_TIMESTAMP
  WHERE id = $4
    AND created_by_source IS DISTINCT FROM 'app'
  RETURNING id
`;

/** Fetch one event from Graph, retrying only on throttling. */
async function fetchWithBackoff(token, outlookId, maxAttempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await outlookApi.getOutlookEventById(token, outlookId);
    } catch (err) {
      if (err.throttled && attempt < maxAttempts) {
        await sleep(err.retryAfterMs || 10000);
        continue;
      }
      throw err;
    }
  }
}

const sameCategories = (a, b) => {
  const x = Array.isArray(a) ? a : [];
  const y = Array.isArray(b) ? b : [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

// ── Per-user repair ──────────────────────────────────────────────────────────
async function repairUser(userRow, args) {
  const counts = {
    scanned: 0, repaired: 0, unchanged: 0, missingInOutlook: 0, errors: 0,
    titlesRestored: 0, locationsRestored: 0, categoriesRestored: 0,
    skippedManualLocation: 0,
  };
  const samples = [];

  let token;
  try {
    token = await getValidToken(userRow);
  } catch (err) {
    console.log(`   ⚠️  ${userRow.email}: no usable Outlook token (${err.message}) — skipped`);
    return { counts, samples, skipped: true };
  }

  let cursor = '00000000-0000-0000-0000-000000000000';
  let processed = 0;

  while (processed < args.limit) {
    const pageSize = Math.min(args.page, args.limit - processed);
    const { rows } = await db.pool.query(CANDIDATE_SQL, [userRow.id, cursor, pageSize]);
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (let i = 0; i < rows.length; i += args.concurrency) {
      const slice = rows.slice(i, i + args.concurrency);
      await Promise.all(slice.map(async (row) => {
        counts.scanned++;
        let graphEvent;
        try {
          graphEvent = await fetchWithBackoff(token, row.outlook_id);
        } catch (err) {
          counts.errors++;
          console.log(`   ⚠️  Graph read failed for row ${row.id}: ${err.message}`);
          return;
        }
        if (!graphEvent) { counts.missingInOutlook++; return; } // 404 — left untouched

        // Only accept values Graph genuinely carries. An empty Graph subject
        // tells us nothing worth writing, so the local placeholder stays.
        const graphTitle    = typeof graphEvent.subject === 'string' && graphEvent.subject.trim() !== ''
          ? graphEvent.subject : null;
        const graphLocation = typeof graphEvent.location?.displayName === 'string'
          && graphEvent.location.displayName.trim() !== ''
          ? graphEvent.location.displayName : null;
        const graphCats     = Array.isArray(graphEvent.categories) && graphEvent.categories.length > 0
          ? graphEvent.categories : null;

        const titleChanges = graphTitle    !== null && graphTitle !== row.title;
        const locChanges   = graphLocation !== null && graphLocation !== row.location
                             && row.is_manual_location_override !== true;
        const catChanges   = graphCats     !== null && !sameCategories(graphCats, row.categories);

        if (graphLocation !== null && row.is_manual_location_override === true) {
          counts.skippedManualLocation++;
        }
        if (!titleChanges && !locChanges && !catChanges) { counts.unchanged++; return; }

        if (samples.length < 10) {
          samples.push({
            outlookId: `${String(row.outlook_id).slice(0, 12)}…`,
            before: { title: row.title, categories: row.categories || [] },
            after:  {
              title: titleChanges ? graphTitle : row.title,
              categories: catChanges ? graphCats : (row.categories || []),
            },
          });
        }

        if (titleChanges) counts.titlesRestored++;
        if (locChanges)   counts.locationsRestored++;
        if (catChanges)   counts.categoriesRestored++;
        counts.repaired++;

        if (!args.dryRun) {
          await db.pool.query(REPAIR_SQL, [
            titleChanges ? graphTitle    : null,
            locChanges   ? graphLocation : null,
            catChanges   ? graphCats     : null,
            row.id,
          ]);
        }
      }));
      await sleep(150); // gentle on Graph's per-app throttle budget
    }

    processed += rows.length;
    if (rows.length < pageSize) break;
  }

  return { counts, samples, skipped: false };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  OUTLOOK TITLE / CATEGORY REPAIR');
  console.log(`  Mode: ${args.dryRun ? 'DRY RUN (no writes)' : 'APPLY (rows will be updated)'}`);
  if (args.limit !== Infinity) console.log(`  Limit: ${args.limit} rows per user`);
  console.log('═══════════════════════════════════════════════════════════════');

  const userSql = `
    SELECT id, email, organisation_id, access_token, refresh_token, token_expires_at
    FROM users
    WHERE access_token IS NOT NULL AND access_token != ''
      ${args.user ? 'AND LOWER(email) = LOWER($1)' : ''}
    ORDER BY created_at
  `;
  const { rows: users } = await db.pool.query(userSql, args.user ? [args.user] : []);

  if (users.length === 0) {
    console.log('');
    console.log('❌ No connected Outlook account found in this database.');
    console.log('   The repair needs a live Graph token to read authoritative values.');
    console.log('   Run this in an environment where an account has linked Outlook.');
    return { ran: false };
  }

  const totals = {
    scanned: 0, repaired: 0, unchanged: 0, missingInOutlook: 0, errors: 0,
    titlesRestored: 0, locationsRestored: 0, categoriesRestored: 0,
    skippedManualLocation: 0,
  };
  let allSamples = [];
  let usersProcessed = 0;

  for (const user of users) {
    console.log(`\n👤 ${user.email}`);
    const { counts, samples, skipped } = await repairUser(user, args);
    if (!skipped) usersProcessed++;
    for (const k of Object.keys(totals)) totals[k] += counts[k];
    allSamples = allSamples.concat(samples).slice(0, 10);

    console.log(`   scanned=${counts.scanned} ${args.dryRun ? 'would repair' : 'repaired'}=${counts.repaired} ` +
                `already-correct=${counts.unchanged} gone-from-outlook=${counts.missingInOutlook} errors=${counts.errors}`);

    if (!args.dryRun && counts.repaired > 0) {
      // Counts only — never event content.
      await db.logAuditEvent({
        actorUserId:    user.id,
        organisationId: user.organisation_id || null,
        action:         'calendar.title_repair',
        targetType:     'events',
        targetId:       null,
        metadata: {
          scanned:               counts.scanned,
          repaired:              counts.repaired,
          titlesRestored:        counts.titlesRestored,
          locationsRestored:     counts.locationsRestored,
          categoriesRestored:    counts.categoriesRestored,
          missingInOutlook:      counts.missingInOutlook,
          skippedManualLocation: counts.skippedManualLocation,
          errors:                counts.errors,
        },
      });
    }
  }

  if (args.dryRun && allSamples.length > 0) {
    console.log('\n──────── sample before → after (max 10) ────────');
    allSamples.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.outlookId}`);
      console.log(`     title:      ${JSON.stringify(s.before.title)}  →  ${JSON.stringify(s.after.title)}`);
      console.log(`     categories: ${JSON.stringify(s.before.categories)}  →  ${JSON.stringify(s.after.categories)}`);
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Accounts processed:     ${usersProcessed}/${users.length}`);
  console.log(`  Rows scanned:           ${totals.scanned}`);
  console.log(`  ${args.dryRun ? 'Rows that WOULD change:' : 'Rows repaired:        '}  ${totals.repaired}`);
  console.log(`    ↳ titles restored:    ${totals.titlesRestored}`);
  console.log(`    ↳ locations restored: ${totals.locationsRestored}`);
  console.log(`    ↳ categories restored:${totals.categoriesRestored}`);
  console.log(`  Already correct:        ${totals.unchanged}`);
  console.log(`  Gone from Outlook (404):${totals.missingInOutlook}   (left untouched)`);
  console.log(`  Manual location kept:   ${totals.skippedManualLocation}`);
  console.log(`  Errors:                 ${totals.errors}`);
  console.log('═══════════════════════════════════════════════════════════════');
  if (args.dryRun) console.log('  DRY RUN — nothing was written. Re-run without --dry-run to apply.');
  console.log('');

  return { ran: true, totals };
}

if (require.main === module) {
  main()
    .then(() => db.pool.end())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error('\n❌ Repair failed:', err.message);
      try { await db.pool.end(); } catch (_) { /* pool already closed */ }
      process.exit(1);
    });
}

module.exports = { parseArgs, sameCategories, CANDIDATE_SQL, REPAIR_SQL };
