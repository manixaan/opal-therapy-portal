# Nightly tracker audit — 2026-11-04

## 1. Status line

**RAN.** 2026-11-04 ~18:10–18:40 UTC. Commit audited: `8853376a8c36f95868f65f44a3aab8c60fc8cd87`
(`develop`). This is the **third** run of this audit (prior runs: 2026-11-01, 2026-11-02, both on
`origin/claude/nightly-audit`, never merged into `develop` — their briefs live only on that
branch, which is why they weren't visible from a fresh `develop` checkout). **Zero commits touched
`backend/` or `frontend/current/` since the last audit's cutoff (2026-11-02 18:39 UTC)** — this
was a quiet two days on the code itself. Not a Sunday, so no weekly deep run (full suites) was
run.

**Counts across the 13 tracker features:** proven 1 · tab-unproven 4 · needs-refinement 3 ·
broken 3 · untouched 2 · built-untested 0.

Three of tonight's findings are **newly surfaced**, not newly introduced — the code hasn't
changed, but tonight's pass ran tests and read code paths the last audit didn't: the block-review
confirm endpoint's missing audit log, and the Admin approval-button mismatch on both My Profile
and Professional Development. These were real on 2026-11-02 too; last night's audit just didn't
catch them.

## 2. Do this first

1. **[broken, newly surfaced]** The block-classifier feature (merged 2026-11-02, ~1 hour after
   the last audit's cutoff — hence missed) doesn't audit its confirm action.
   `tests/integration/block-review.itest.js` fails on this tonight; it was not run on 2026-11-02.
   Billing-risk code (it gates invoicing) with a missing audit trail.
2. **[broken, carried over — 3rd night unfixed]** `/api/outlook/categories` still returns a raw
   server error instead of a clean "not connected" response. Documented since the August browser
   QA pass, flagged again on 2026-11-02, still not fixed, still has zero test coverage.
3. **[broken, newly surfaced — more precise than last night's "untested" framing]** Admin users
   see Approve/Reject buttons for staff leave and professional-development requests that always
   fail when clicked — only the Owner role can actually approve them (confirmed directly in
   `profile-routes.js:35-42` vs `frontend/current/profile.js:93,284,1344`). Last night's audit
   called this merely "untested"; it is a confirmed logic bug, not just a coverage gap. Not a
   security hole — the backend correctly blocks it — but broken UX on two tracker cards at once.
4. **[tracker says more than the evidence shows, newly surfaced]** The "Therapist Snapshot" card's
   checklist marks a "minimise" feature as done, but no such code exists anywhere in the
   snapshot/report screens.
5. **[unresolved for a 2nd straight audit]** "Opal Assist" — a substantial AI chat feature
   (de-identification, two migrations, its own installable app) — still has no tracker card at
   all, so it still isn't covered by this audit's 13 feature folders. Last night's audit asked for
   a card to be opened; nothing has changed. It is guarded and gateway-compliant, and its own test
   suite passes in full (6 unit suites/98 tests, 1 integration suite/5 tests) — re-confirmed
   tonight, not a code concern, purely a tracker-visibility gap.

## 3. Every feature

| Feature | Tracker stage | Evidence | Reason | Tests run |
|---|---|---|---|---|
| Portal - Splose - Outlook \| Integration Works | idea | broken | outlook/categories 500 (carried over) + block-review audit gap (newly surfaced) | 19 unit pass; 1 integration fail (block-review), 1 pass |
| Portal Onboarding Workflow | idea | needs-refinement | SharePoint-vs-DB decision still open; dynamic-contract re-confirmed built (checklist item still stale); one env-dependency test failure | 26/27 unit pass; 3/3 integration pass |
| Clinical resources | idea | tab-unproven | mature, tested backend; newer Library/upload flow has no browser proof | 13 unit pass; 3/3 integration pass |
| Inductions | idea | tab-unproven | all surfaces built and tested; "hold point" step type missing; no browser/E2E proof | 7 unit pass; 3/3 integration pass |
| Professional Development | idea | broken | Admin approval-button mismatch (shared bug, see My Profile) | none exists for the round trip |
| Automated Reminders | idea | needs-refinement | client reminders unbuilt; Snapshot checklist disagrees with code | 1 integration pass (Snapshot); none for reminders |
| Employee Personal Page (My Profile Tab) | idea | broken | confirmed Admin approval-button mismatch | none exists for the round trip; 4/5 integration pass (1 unrelated sandbox artifact) |
| Interactive Assessments | idea | tab-unproven | only WHODAS built; strong tests; no browser/E2E proof; flag defaults off | 15 unit pass; 2/2 integration pass |
| Opa Mobile Companion | idea | **proven** | backend guarded, gateway-compliant, fully tested (re-confirmed, figures match 2026-11-02 exactly); mobile client itself not in this repo | 123/123 unit pass; 10/10 integration pass |
| Password Master Document | idea | untouched | by design — external OneDrive document | n/a |
| Report Templates | idea | tab-unproven | all three wizards built and tested; zero browser/E2E proof | many unit pass; 3/3 integration pass |
| Update Opal Docs Register | idea | untouched | by design — external Excel register | n/a |
| Xero Integration Works | idea | tab-unproven | dashboard + payroll push built, guarded, tested; tracker underclaims this | 6 unit pass; 3/3 integration pass |

## 4. Prompts for the morning

**1.**
```
/opal-critical
Fix the missing audit log entry on the block-review "confirm" endpoint
(backend/block-review-routes.js). Its "sweep" handler already writes an
audit_logs row for block_review.sweep; confirm needs the matching
block_review.confirm row with the same ids-and-counts-only shape (no client
names/titles — see the test's own assertion). Make
`npx jest --config jest.integration.config.js tests/integration/block-review.itest.js --runInBand`
pass in full. See docs/qa/nightly/features/portal-splose-outlook-integration-works/START.md.
```

**2.**
```
/opal-fast-change
In backend/routes.js around line 1487-1499, GET /api/outlook/categories
currently falls through to a generic 500 when the user has no Outlook
connection. Catch that specific "Outlook not connected" error from
getValidAccessToken (backend/outlook-oauth.js) and return
res.status(409).json({ error: 'outlook_not_connected' }) instead. Add a unit
test asserting the 409 — this has been flagged three nights running with zero
test coverage. See
docs/qa/nightly/features/portal-splose-outlook-integration-works/START.md.
```

**3.**
```
/opal-critical
Admin users can see Approve/Reject/Verify buttons for staff leave and CPD
requests in frontend/current/profile.js (isManager includes 'admin'), but
backend/profile-routes.js's canApprove/canViewAll are owner-only by design
(see the 2026-08-06 RBAC comment at profile-routes.js:35). Confirm with the
team whether Admin should be able to approve these, then either narrow the
frontend's isManager check for this section, or widen the backend gate to
match — pick one, don't leave them disagreeing. Add an integration test
covering submit -> approve/reject -> employee sees result. See
docs/qa/nightly/features/employee-personal-page-my-profile-tab/START.md and
docs/qa/nightly/features/professional-development/START.md.
```

**4.**
```
/opal-fast-change
The "Therapist Snapshot" tracker card has a checklist item "Create minimise
function on snapshot" marked done, but no minimise logic exists anywhere in
frontend/current/reports.js or mockup_v3.html. Either implement it, or
correct the tracker checklist to reflect what's actually built. See
docs/qa/nightly/features/automated-reminders/START.md.
```

**5.**
```
/opal-critical
Open a new tracker card for "Opal Assist" (backend/assist-routes.js,
backend/assist/*, frontend/current/assist*.js/html, migrations 084/085) —
this is the second audit in a row asking for one. It's CRITICAL-risk (an AI
feature with its own de-identification layer) and currently invisible to
this nightly audit entirely. A card needs only a title; the audit will
locate and verify the code once one exists.
```

## 5. Ideas without a start

Only `opa-mobile-companion/START.md` changed tonight — it moved from `built-untested` back to
`proven` after re-running its full test set (figures matched 2026-11-02 exactly; a locate-only
fork this session had under-counted its test coverage before the full re-run corrected it). No
other folder's evidence label changed from the 2026-11-02 run. All 13 folders already existed on
`origin/claude/nightly-audit` from the prior two runs.

## 6. What changed since last audit

**Nothing** — zero commits touched `backend/` or `frontend/current/` between the last audit's
cutoff (2026-11-02 18:39 UTC) and tonight's HEAD. The 53 commits in the trailing-14-day window
(used for test selection, per the first-run fallback, since this checkout had no prior
`docs/qa/nightly/*.md` on `develop`) were **all already covered** by the 2026-11-01 and
2026-11-02 audits — see their briefs on `origin/claude/nightly-audit` for that history, including
Opal Assist (6 commits, 2026-11-02) and a Maps autocomplete-positioning fix, both already reported
there with no tracker feature.

Tonight's "newly surfaced" findings (block-review audit gap, Admin approval-button mismatch) are
not new code — they are pre-existing gaps in code from before 2026-11-02 that this pass happened
to test or read more thoroughly than the last one did.

## 7. Technical detail

**Setup**: PostgreSQL was down at the start of this run (`service postgresql status` → `down`);
started it (`service postgresql start`) before anything else. `backend/node_modules/.bin/jest`
was present; no `npm install`/`npm ci` was run. `node --check` on every top-level `backend/*.js`
file passed with no syntax errors.

**History note**: this checkout started from `origin/develop`, which has never had
`claude/nightly-audit` merged into it (by design — that PR is never merged), so
`docs/qa/nightly/` was empty on `develop` and step 5 of the audit procedure ("note the last audit
date") found nothing there. Only after creating the local delivery branch and fetching
`origin/claude/nightly-audit` did the 2026-11-01 and 2026-11-02 briefs become visible. Re-ran the
"what changed" analysis against the correct cutoff once this was discovered (section 6).

**Tracker fetch**: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json`
→ `fetch-tracker: 13 features, 19 tasks -> /tmp/tracker.json`.

**Commands run** (from `backend/`, all read-only against the repo):
- Unit, by feature batch: `npx jest tests/<files...>.test.js` — 10 batches, 1 failure:
  `tests/onboarding-document-reader.test.js` fails with `Cannot find module
  '@tesseract.js-data/eng/package.json'` — same known environment gap as the 2026-11-02 run
  (missing OCR language-data sub-package, not a code regression); not fixed here per the
  "no npm install" limit.
- Integration, by feature batch: `DB_NAME=therapy_scheduler_audit<N> DB_PASSWORD=audit npx jest
  --config jest.integration.config.js tests/integration/<files...>.itest.js --runInBand` — 6
  batches across 6 separate throwaway databases, 2 failures:
  1. `tests/integration/block-review.itest.js` — real defect, see "Do this first" #1. Not run by
     the 2026-11-02 audit (its technical detail lists the 9-file Splose/Outlook/travel batch by
     name and block-review isn't in it) — this is the first time this audit has exercised it.
  2. `tests/integration/readonly-and-hardening.itest.js` — "D-6/D-7: storage failure behaviour"
     expects a `chmod`'d read-only directory to make a file write fail (≥500); this sandbox runs
     as `root` (`id` → `uid=0`), so the permission check never applies and the write succeeds
     (201). Sandbox artifact, not a product defect.
  3. Re-ran `tests/case-note-approval-edit.itest.js`, `case-note-client-link.itest.js`,
     `case-note-deidentification.itest.js` (10/10 pass) plus `case-note-routes.test.js` +
     `mobile-routes.test.js` (123/123 pass) specifically to resolve a discrepancy against the
     2026-11-02 result for Opa Mobile Companion — figures matched exactly, confirmed `proven`.
  4. Re-ran `assist-*.test.js` (6 files, 98 tests) and `tests/integration/assist.itest.js` (5
     tests) to independently verify the Opal Assist subsystem named in "Do this first" #5 — all
     pass, and it is confirmed gateway-compliant (`assist/assist-provider.js:12`) and guarded
     (`assist-routes.js:68`).

**Not run** (RELEASE-only, prohibited at this level per `.claude/rules/tests.md`): `npm test`,
`npm run test:integration`, `npm run test:all`, `npm run test:e2e:local`.

**Could not locate**: the Opa Mobile Companion native/PWA client itself (not in this
repository — only its backend API surface). No e2e spec exists anywhere for calendar, splose,
outlook, travel, resources, induction, assessments, fca, letters, templates, accounting, or xero —
`e2e/tests/` contains only `portal.spec.js` and `tutorials.spec.js`. `docs/qa/BROWSER_QA_RESULTS.md`
is dated 2026-08-01, roughly three months stale against the amount of backend work since.

**Open questions for the team**:
1. Should Admin be able to approve staff leave/CPD, or is owner-only correct by design? (affects
   "Do this first" #3)
2. Is the SharePoint-vs-database-storage question for onboarding documents settled, or still open?
3. Should `ENABLE_WHODAS_ASSESSMENT` be turned on anywhere right now?
4. Opal Assist and the Case Notes editing/approval flow have no tracker cards at all — this is the
   second audit running asking for one, specifically for Opal Assist.

**Tracker write-back**: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json`
→ `post-tracker: 13 features posted, 0 already posted tonight, brief posted`. Run before the git
push, as required.
