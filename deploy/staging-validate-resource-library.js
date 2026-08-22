'use strict';
/**
 * STAGING VALIDATION — Resource Library folders (migration 039).
 *
 * Runs against the DEPLOYED staging app over HTTPS, using the synthetic
 * accounts only, in the same shape as deploy/staging-validate.js.
 *
 *   BASE=https://opal-portal-staging.azurewebsites.net \
 *   SYN_PASS="$(sed 's/.*: //' deploy/staging-synthetic.local.txt)" \
 *   node deploy/staging-validate-resource-library.js
 *
 * What this proves that the local suites cannot:
 *   - migration 039 actually applied on the staging database
 *   - the Owner can run an organisation end to end against a real corpus
 *   - the AI refinement path reaches Bedrock for the first time, or reports
 *     honestly why it could not — and either way the library still organises
 *   - a therapist sees folders but cannot restructure them
 *   - search still spans the whole library
 *
 * Writes only through the product's own Owner-authorised routes. Creates no
 * users, sends nothing outbound, and deletes nothing.
 */

const BASE = process.env.BASE;
const SYN_PASS = process.env.SYN_PASS;
if (!BASE || !SYN_PASS) { console.error('BASE and SYN_PASS are required'); process.exit(2); }

const results = [];
function record(id, desc, got, want) {
  const ok = String(got) === String(want);
  results.push({ id, desc, got: String(got), want: String(want), ok });
  console.log(`${ok ? '✓' : '✗ FINDING'} [${id}] ${desc} → ${got} (want ${want})`);
}
function note(id, desc, value) {
  results.push({ id, desc, got: String(value), want: '(informational)', ok: true });
  console.log(`· [${id}] ${desc} → ${value}`);
}

function makeClient() {
  let cookie = '';
  return async function client(path, { method = 'GET', body, raw = false } = {}) {
    const res = await fetch(BASE + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        Origin: BASE,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setC = res.headers.getSetCookie?.() || [];
    if (setC.length) cookie = setC.map((c) => c.split(';')[0]).join('; ');
    if (raw) return res;
    let json = null;
    try { json = await res.json(); } catch (_) { /* not json */ }
    return { status: res.status, json };
  };
}

async function login(email) {
  const c = makeClient();
  const r = await c('/api/auth/login', { method: 'POST', body: { email, password: SYN_PASS } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
  return c;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Flatten the folder tree so a name lookup does not care about depth. */
function flatten(folders) {
  const out = [];
  for (const f of folders || []) {
    out.push(f);
    for (const c of f.children || []) out.push(c);
  }
  return out;
}

(async () => {
  console.log(`── Resource Library validation against ${BASE}\n`);

  // ── 1. the deployment is actually serving the new build ────────────────
  const ready = await (await fetch(`${BASE}/ready`)).json();
  record('L1.1', 'staging reports ready', ready.ready, true);
  record('L1.2', 'migrations applied (039 included)', ready.checks.migrations, 'ok');

  const owner = await login('synthetic.owner@example.test');
  const therapist = await login('synthetic.therapist@example.test');

  // ── 2. the folder surface exists at all (proves 039's tables) ──────────
  const before = await owner('/api/rh2/library/folders');
  record('L2.1', 'owner can read the folder tree', before.status, 200);
  note('L2.2', 'folders before organising', (before.json.folders || []).length);
  note('L2.3', 'resources visible to owner', before.json.totalResources);

  const status0 = await owner('/api/rh2/library/status');
  record('L2.4', 'owner is told they may organise', status0.json.canOrganise, true);

  // ── 3. a therapist may browse but not restructure ──────────────────────
  const tFolders = await therapist('/api/rh2/library/folders');
  record('L3.1', 'therapist can browse folders', tFolders.status, 200);
  const tStatus = await therapist('/api/rh2/library/status');
  record('L3.2', 'therapist is not offered organising', tStatus.json.canOrganise, false);
  const tOrganise = await therapist('/api/rh2/library/organise', { method: 'POST', body: {} });
  record('L3.3', 'therapist organise is refused', tOrganise.status, 403);
  record('L3.4', 'refusal carries the machine code', tOrganise.json.code, 'library_structure_forbidden');
  const tFolderCreate = await therapist('/api/rh2/library/folders', { method: 'POST', body: { name: 'Sneaky' } });
  record('L3.5', 'therapist folder creation is refused', tFolderCreate.status, 403);

  // ── 4. run an organisation, for real ──────────────────────────────────
  const started = await owner('/api/rh2/library/organise', { method: 'POST', body: { mode: 'organise' } });
  record('L4.1', 'owner can start an organisation', started.status, 202);

  // A full staging run with the model in the path took ~17 minutes on the B1
  // instance. This waits well past that: a harness that times out early
  // reports a working deployment as broken, which is the more expensive
  // mistake.
  let run = null;
  for (let i = 0; i < 450; i++) {
    await sleep(4000);
    const s = await owner('/api/rh2/library/status');
    run = s.json.run;
    if (run && run.status !== 'running') break;
    if (i % 15 === 0) console.log(`   … ${run ? run.phase : 'starting'}`);
  }
  record('L4.2', 'the run finished', run && run.status, 'complete');
  record('L4.3', 'the run did not error', run && run.failed, false);
  note('L4.4', 'resources scanned', run && run.scanned);
  note('L4.5', 'resources assigned', run && run.assigned);
  note('L4.6', 'left in Needs Review', run && run.needsReview);
  note('L4.7', 'folders created', run && run.foldersCreated);
  note('L4.8', 'possible duplicates flagged', run && (run.duplicates || []).length);

  // ── 5. THE FIRST REAL BEDROCK INVOCATION ──────────────────────────────
  // Informational on purpose. The deterministic classifier is the product;
  // the model only refines it. A staging run that reports reviewed=false has
  // degraded exactly as designed and must NOT fail this harness (§61).
  note('L5.1', 'AI refinement ran', run && run.reviewed);
  if (run && !run.reviewed) {
    console.log('   ⚠ AI refinement did not run — the library organised deterministically.');
    console.log('     This is the designed fallback, not a deployment failure.');
  }

  // ── 6. the resulting library is navigable ─────────────────────────────
  const after = await owner('/api/rh2/library/folders');
  const flat = flatten(after.json.folders);
  record('L6.1', 'folders exist after organising', flat.length > 0, true);
  record('L6.2', 'library reports itself organised', after.json.organised, true);
  console.log('\n   Taxonomy on staging:');
  for (const f of after.json.folders || []) {
    console.log(`     ${f.name} — ${f.count}`);
    for (const c of f.children || []) console.log(`       └─ ${c.name} — ${c.count}`);
  }
  console.log('');

  const named = flat.find((f) => !f.isReviewBucket && f.count > 0);
  record('L6.3', 'at least one folder holds resources', !!named, true);

  const inFolder = await owner(`/api/rh2/resources?folderId=${named.id}&folderScope=tree&limit=5`);
  record('L6.4', 'a folder lists its resources', inFolder.status, 200);
  record('L6.5', 'the folder is not empty', (inFolder.json.resources || []).length > 0, true);

  const crumbs = await owner(`/api/rh2/library/folders/${named.slug}`);
  record('L6.6', 'a folder is addressable by slug', crumbs.status, 200);

  // ── 7. search still spans everything ──────────────────────────────────
  const globalSearch = await owner('/api/rh2/resources?q=policy&limit=50');
  record('L7.1', 'global search works', globalSearch.status, 200);
  const scoped = await owner(`/api/rh2/resources?q=policy&folderId=${named.id}&limit=50`);
  record('L7.2', 'folder-scoped search works', scoped.status, 200);
  record('L7.3', 'a folder never widens a search',
    (scoped.json.resources || []).length <= (globalSearch.json.resources || []).length, true);
  const badFolder = await owner('/api/rh2/resources?folderId=not-a-uuid');
  record('L7.4', 'a malformed folder filter is rejected, not ignored', badFolder.status, 400);

  // ── 8. manual placement, and that it survives a second run ────────────
  const target = flat.find((f) => f.id !== named.id && !f.isReviewBucket) || named;
  const victim = inFolder.json.resources[0];
  const moved = await owner('/api/rh2/library/move',
    { method: 'POST', body: { folderId: target.id, resourceIds: [victim.id] } });
  record('L8.1', 'owner can move a resource by hand', moved.status, 200);

  const second = await owner('/api/rh2/library/organise', { method: 'POST', body: { mode: 'reorganise' } });
  record('L8.2', 'a second run starts', second.status, 202);
  let run2 = null;
  for (let i = 0; i < 450; i++) {
    await sleep(4000);
    const s = await owner('/api/rh2/library/status');
    run2 = s.json.run;
    if (run2 && run2.status !== 'running') break;
  }
  record('L8.3', 'the second run finished', run2 && run2.status, 'complete');
  record('L8.4', 'manual placement was respected', (run2 && run2.keptManual) >= 1, true);
  record('L8.5', 'the taxonomy stayed stable', run2 && run2.foldersCreated, 0);

  const check = await owner(`/api/rh2/resources?folderId=${target.id}&folderScope=tree&limit=200`);
  record('L8.6', 'the moved resource is still where the owner put it',
    (check.json.resources || []).some((r) => r.id === victim.id), true);

  // ── 9. nothing was destroyed ──────────────────────────────────────────
  const stillThere = await owner(`/api/rh2/resources/${encodeURIComponent(victim.slug || victim.id)}`);
  record('L9.1', 'the resource is still reachable by its original URL', stillThere.status, 200);
  const totals = await owner('/api/rh2/library/folders');
  record('L9.2', 'the visible resource count did not shrink',
    totals.json.totalResources >= before.json.totalResources, true);

  // ── report ────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  console.log(`\n── ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFINDINGS:');
    for (const f of failed) console.log(`  ✗ [${f.id}] ${f.desc}: got ${f.got}, wanted ${f.want}`);
  }
  process.exit(failed.length ? 1 : 0);
})().catch((err) => { console.error('HARNESS ERROR:', err); process.exit(3); });
