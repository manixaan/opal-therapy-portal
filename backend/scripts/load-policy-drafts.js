'use strict';

/**
 * Load the generated policy drafts into the onboarding document library.
 *
 *   node backend/scripts/load-policy-drafts.js                 # dry run
 *   node backend/scripts/load-policy-drafts.js --apply
 *   node backend/scripts/load-policy-drafts.js --apply --only POL_WHS
 *   node backend/scripts/load-policy-drafts.js --apply --force  # draft anyway
 *
 * WHAT IT CAN AND CANNOT DO
 * ─────────────────────────
 * It creates DRAFT versions. That is the whole of its power. It has no publish
 * path, it never sets content_status, it never touches an existing version, and
 * it never edits a document row. A slot that held nothing before this runs
 * still holds nothing an employee can see afterwards — publishing is a human
 * pressing publish in the library, per document, having read it.
 *
 * That boundary is why generating this text does not contradict the seeder's
 * refusal to invent policy content (onboarding-seed.js). The seeder declines to
 * put invented words in front of a workforce; nothing here puts words in front
 * of anybody.
 *
 * IDEMPOTENT BY BODY, NOT BY RUN COUNT
 * ────────────────────────────────────
 * A policy is skipped when ANY existing version of that document already holds
 * exactly the body this run would write. So re-running after editing three
 * files drafts three versions, not twenty-nine — and re-running after editing
 * nothing drafts none. --force overrides, for the case where you want a fresh
 * version number against an unchanged body.
 *
 * ORG VALUES
 * ──────────
 * {{OPAL_ORG_*}} tags are resolved from organisation settings, the same source
 * a service agreement uses. Anything unresolved is written as a visible
 * [TO CONFIRM: …] rather than a raw token, and is reported in the summary.
 */

const path = require('path');
const { pool } = require('../database');
const odb = require('../onboarding-db');
const policies = require('../onboarding-policies');
const orgSettings = require('../service-agreements/organisation');

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? (process.argv[i + 1] || '').toUpperCase() : null;
})();

function pad(s, n) { return String(s).padEnd(n).slice(0, n); }

async function main() {
  const { rows: orgs } = await pool.query('SELECT id, name FROM organisations ORDER BY created_at LIMIT 1');
  const org = orgs[0];
  if (!org) {
    console.error('No organisation found. Run the server once so the seeder installs the catalogue.');
    process.exitCode = 1;
    return;
  }

  const { values: orgValues, missing } = await orgSettings.snapshotFor(org.id);

  let all = policies.loadAll();
  if (ONLY) all = all.filter((p) => p.code === ONLY);
  if (!all.length) {
    console.error(ONLY ? `No policy file for ${ONLY}` : 'No policy files found');
    process.exitCode = 1;
    return;
  }

  console.log(`Organisation: ${org.name || org.id}`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN — nothing will be written'}${FORCE ? ' (forced)' : ''}`);
  console.log('');
  console.log(`${pad('CODE', 26)} ${pad('ACTION', 16)} ${pad('TIER', 5)} ${pad('TO CONFIRM', 11)} TITLE`);
  console.log('-'.repeat(110));

  const counts = { drafted: 0, unchanged: 0, noSlot: 0 };
  const unresolvedTags = new Set();

  for (const policy of all) {
    const doc = await odb.getDocumentByCode(org.id, policy.code);
    if (!doc) {
      counts.noSlot += 1;
      console.log(`${pad(policy.code, 26)} ${pad('NO SLOT', 16)} ${pad(policy.tier, 5)} ${pad('-', 11)} ${policy.title}`);
      continue;
    }

    const { payload, unresolved, confirmations } = policies.versionPayload(policy, { orgValues });
    unresolved.forEach((t) => unresolvedTags.add(t));

    let action;
    if (!FORCE) {
      const { rows: same } = await pool.query(
        'SELECT version FROM onboarding_document_versions WHERE document_id = $1 AND body = $2 LIMIT 1',
        [doc.id, payload.body]
      );
      if (same[0]) {
        counts.unchanged += 1;
        console.log(`${pad(policy.code, 26)} ${pad(`unchanged (v${same[0].version})`, 16)} ${pad(policy.tier, 5)} ${pad(confirmations, 11)} ${policy.title}`);
        continue;
      }
    }

    if (APPLY) {
      const version = await odb.createDocumentVersion(doc.id, payload, null);
      action = `drafted v${version.version}`;
    } else {
      action = 'would draft';
    }
    counts.drafted += 1;
    console.log(`${pad(policy.code, 26)} ${pad(action, 16)} ${pad(policy.tier, 5)} ${pad(confirmations, 11)} ${policy.title}`);
  }

  console.log('-'.repeat(110));
  console.log(`${counts.drafted} ${APPLY ? 'drafted' : 'to draft'} · ${counts.unchanged} unchanged · ${counts.noSlot} with no library slot`);

  if (unresolvedTags.size) {
    console.log('');
    console.log('Organisation settings not yet recorded, written into the drafts as [TO CONFIRM: …]:');
    for (const tag of [...unresolvedTags].sort()) {
      console.log(`  ${pad(tag, 36)} ${policies.ORG_TAGS[tag]}`);
    }
    console.log('  Set these in Settings, then re-run to refresh the drafts.');
  } else if (missing.length) {
    console.log('');
    console.log(`Note: ${missing.length} organisation field(s) unset, none of them referenced by a policy.`);
  }

  if (!APPLY) {
    console.log('');
    console.log('Dry run. Re-run with --apply to create the drafts.');
  } else if (counts.drafted) {
    console.log('');
    console.log('Drafts created. Nothing is visible to an employee until an Owner publishes each');
    console.log('version in the document library, one document at a time.');
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
