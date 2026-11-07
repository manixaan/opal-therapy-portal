# Nightly tracker audit — 2026-11-05

## 1. Status line

**RAN.** 2026-11-05 ~18:10–18:30 UTC. Commit audited: `8853376a8c36f95868f65f44a3aab8c60fc8cd87`
(`develop`) — **identical** to the commit the 2026-11-04 audit covered. **Zero commits touched
`backend/` or `frontend/current/` since that audit's cutoff** — a quiet night on the code itself.
Not a Sunday, so no weekly deep run (full suites) was run.

**Counts across the 13 tracker features:** proven 1 · tab-unproven 4 · needs-refinement 3 ·
broken 3 · untouched 2 · built-untested 0 — unchanged from 2026-11-04 (expected, since no code
changed).

Even with no code changes, this pass re-ran every targeted test batch from scratch (not copied
from last night) and found two things worth a person's attention anyway:

1. The block-review audit-log defect reported for three nights running is **not quite what it was
   described as**. It does not lack an audit write — it has one that races the response, so the
   failing test is flaky, not deterministic. See "Do this first" #1.
2. The 2026-11-04 brief itself disagreed with its own table: the Xero unit-test count it quoted
   (120) doesn't match the five files it named (70, recounted individually tonight), and its
   Inductions row said `tab-unproven` in the summary table while that feature's own `STATUS.md`
   said `needs-refinement` — the brief's own headline counts were computed from the second, not
   the first. Both are corrected tonight; neither reflects a code change.

## 2. Do this first

1. **[broken, root cause refined — 3rd night unfixed]** The block-review confirm endpoint's audit
   write races its own response. `backend/block-review-routes.js:146` calls
   `audit(req, 'block_review.confirm', ...)` but never `await`s it before `res.json({ ok: true })`
   on the next line — so the `INSERT INTO audit_logs` and the caller's next read aren't ordered.
   Confirmed by running `tests/integration/block-review.itest.js` in isolation four times tonight:
   2 failed, 2 passed, same code, same test, same database schema. Billing-risk code (it gates
   invoicing) with an unreliable, not absent, audit trail.
2. **[broken, carried over — 4th night unfixed]** `/api/outlook/categories` still returns a raw
   server error instead of a clean "not connected" response. Documented since the August browser
   QA pass, flagged again on 2026-11-02 and 2026-11-04, still not fixed, still has zero test
   coverage.
3. **[broken, carried over — 2nd night unfixed]** Admin users still see Approve/Reject buttons for
   staff leave and professional-development requests that always fail when clicked — only the
   Owner role can actually approve them (`profile-routes.js:35-42` vs
   `frontend/current/profile.js:93,284,1344`). Not a security hole — the backend correctly blocks
   it — but broken UX on two tracker cards at once.
4. **[tracker says more than the evidence shows, carried over]** The "Therapist Snapshot" card's
   checklist still marks a "minimise" feature as done, but no such code exists anywhere in the
   snapshot/report screens. Nobody has corrected the checklist or built the feature since this was
   first raised on 2026-11-04.
5. **[unresolved for a 3rd straight audit]** "Opal Assist" — a substantial AI chat feature
   (de-identification, two migrations, its own installable app) — still has no tracker card at
   all. Re-confirmed tonight (6 unit suites/98 tests, 1 integration suite/5 tests, all pass,
   gateway-compliant and guarded) — still purely a tracker-visibility gap, not a code concern.

## 3. Every feature

| Feature | Tracker stage | Evidence | Reason | Tests run |
|---|---|---|---|---|
| Portal - Splose - Outlook \| Integration Works | idea | broken | outlook/categories 500 (carried over) + block-review audit race (root cause refined tonight) | 19 unit pass; 1 integration flaky (block-review), 1 pass |
| Portal Onboarding Workflow | idea | needs-refinement | SharePoint-vs-DB decision still open; one env-dependency unit failure (OCR package) | 26/27 unit pass; 3/3 integration pass |
| Clinical resources | idea | tab-unproven | mature, tested backend; Library upload flow has no browser proof | 12 unit suites pass; 4/4 integration pass (includes `resource-library-sharepoint.itest.js`, not named in prior briefs) |
| Inductions | idea | needs-refinement | "hold point" step type genuinely unbuilt (a real gap, not just missing browser proof — corrects a table/STATUS.md mismatch in the 2026-11-04 brief) | 7 unit pass; 3/3 integration pass |
| Professional Development | idea | broken | Admin approval-button mismatch (shared bug, see My Profile) | none exists for the round trip |
| Automated Reminders | idea | needs-refinement | client reminders unbuilt; Snapshot checklist disagrees with code | 1 integration pass (Snapshot); none for reminders |
| Employee Personal Page (My Profile Tab) | idea | broken | confirmed Admin approval-button mismatch | none exists for the round trip; 4/5 integration pass (1 unrelated sandbox artifact) |
| Interactive Assessments | idea | tab-unproven | only WHODAS built; strong tests; no browser/E2E proof; flag defaults off | 15 unit pass; 2/2 integration pass |
| Opa Mobile Companion | idea | **proven** | backend guarded, gateway-compliant, fully tested; figures match 2026-11-04 exactly; mobile client itself not in this repo | 123/123 unit pass; 10/10 integration pass |
| Password Master Document | idea | untouched | by design — external OneDrive document | n/a |
| Report Templates | idea | tab-unproven | all three wizards built and tested; zero browser/E2E proof | many unit pass; 3/3 integration pass |
| Update Opal Docs Register | idea | untouched | by design — external Excel register | n/a |
| Xero Integration Works | idea | tab-unproven | dashboard + payroll push built, guarded, tested; tracker underclaims this; unit-test count corrected (70, not 120) | 70 unit pass; 3/3 integration pass |

## 4. Prompts for the morning

**1.**
```
/opal-critical
Fix the block-review "confirm" audit write race (backend/block-review-routes.js). Line 146 calls
audit(req, 'block_review.confirm', { kind, group, withClient, withLocation }, eventId) but the
handler never awaits it before res.json({ ok: true }) on the next line, so the INSERT races the
caller's next read. Change `audit(...)` to `await audit(...)` there. While in the file, do the
same for the unawaited audit() calls on the sweep handler (line 82) and confirm-guessed handler
(line 112) — same pattern, not yet caught by a test. Make
`npx jest --config jest.integration.config.js tests/integration/block-review.itest.js --runInBand`
pass on four consecutive isolated runs (not just once — this bug is a race, so a single green run
proves nothing). See docs/qa/nightly/features/portal-splose-outlook-integration-works/START.md.
```

**2.**
```
/opal-fast-change
In backend/routes.js around line 1487-1499, GET /api/outlook/categories currently falls through to
a generic 500 when the user has no Outlook connection. Catch that specific "Outlook not connected"
error from getValidAccessToken (backend/outlook-oauth.js) and return
res.status(409).json({ error: 'outlook_not_connected' }) instead. Add a unit test asserting the
409 — this has been flagged four nights running with zero test coverage. See
docs/qa/nightly/features/portal-splose-outlook-integration-works/START.md.
```

**3.**
```
/opal-critical
Admin users can see Approve/Reject/Verify buttons for staff leave and CPD requests in
frontend/current/profile.js (isManager includes 'admin'), but backend/profile-routes.js's
canApprove/canViewAll are owner-only by design (see the 2026-08-06 RBAC comment at
profile-routes.js:35). Confirm with the team whether Admin should be able to approve these, then
either narrow the frontend's isManager check for this section, or widen the backend gate to
match — pick one, don't leave them disagreeing. Add an integration test covering submit ->
approve/reject -> employee sees result. See
docs/qa/nightly/features/employee-personal-page-my-profile-tab/START.md and
docs/qa/nightly/features/professional-development/START.md.
```

**4.**
```
/opal-fast-change
The "Therapist Snapshot" tracker card has a checklist item "Create minimise function on snapshot"
marked done, but no minimise logic exists anywhere in frontend/current/reports.js or
mockup_v3.html. This has now been flagged twice without action. Either implement it, or correct
the tracker checklist to reflect what's actually built. See
docs/qa/nightly/features/automated-reminders/START.md.
```

**5.**
```
/opal-critical
Open a new tracker card for "Opal Assist" (backend/assist-routes.js, backend/assist/*,
frontend/current/assist*.js/html, migrations 084/085) — this is the third audit in a row asking
for one. It's CRITICAL-risk (an AI feature with its own de-identification layer) and currently
invisible to this nightly audit entirely. A card needs only a title; the audit will locate and
verify the code once one exists.
```

## 5. Ideas without a start

No folder's evidence label changed tonight except a correction to `inductions` (the evidence was
and remains `needs-refinement` — only an inconsistency between that STATUS.md's own header and
the prior night's summary table was resolved; nothing about the code's state changed). All 13
folders already existed from the prior three runs on `origin/claude/nightly-audit`.

## 6. What changed since last audit

**Nothing.** Zero commits touched `backend/` or `frontend/current/` between the 2026-11-04 audit's
cutoff and tonight's HEAD — both sit at `8853376a8c36f95868f65f44a3aab8c60fc8cd87`. Every finding
in this brief is a re-verification of existing code, not a reaction to new work. See the
2026-11-01/02/04 briefs on `origin/claude/nightly-audit` for the change history up to that commit.

## 7. Technical detail

**Setup**: PostgreSQL was down at the start of this run (`service postgresql status` → `down`);
started it (`service postgresql start`) before anything else. `backend/node_modules/.bin/jest`
was present; no `npm install`/`npm ci` was run. `node --check` on every top-level `backend/*.js`
file passed with no syntax errors (69 files). `node scripts/check-asset-pins.js` reports every
cache-bust pin matches the shell — expected, since nothing in `frontend/current/` changed.

**History note**: like 2026-11-04, this checkout started from `origin/develop`, which has never
had `claude/nightly-audit` merged into it, so `docs/qa/nightly/` was effectively empty on
`develop` (only the static `README.md`). The prior nights' briefs and feature folders were
recovered by `git checkout origin/claude/nightly-audit -- docs/qa/nightly` before editing, so this
run's STATUS.md/START.md updates build on the actual prior content rather than starting blank.

**Tracker fetch**: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json`
→ `fetch-tracker: 13 features, 19 tasks -> /tmp/tracker.json`. All 19 tasks are still `todo`
(unchanged since 2026-11-04); no decisions recorded on any feature; no tracker field changed by a
human since the last audit.

**Commands run** (from `backend/`, all read-only against the repo):
- Unit, by feature batch (8 batches, 2,711 tests, 1 failure):
  1. Splose/Outlook/travel/block-review (19 files) — 326/326 pass.
  2. Onboarding (27 files) — 653/654 pass; `tests/onboarding-document-reader.test.js` fails with
     `Cannot find module '@tesseract.js-data/eng/package.json'` — same known environment gap as
     2026-11-02/04 (missing OCR language-data sub-package, not a code regression); not fixed here
     per the "no npm install" limit.
  3. Resource Hub (12 files) — 398 pass + 12 skipped = 410/410.
  4. Induction/learning/walkthrough (6 files) — 133/133 pass.
  5. Assessments/FCA/letters (15 files) — 897/897 pass.
  6. Mobile/case-note (2 files) — 123/123 pass.
  7. Finance/Xero payroll (5 files) — 70/70 pass; re-counted file-by-file to correct the 2026-11-04
     brief's "120" figure (14+6+11+24+15=70).
  8. Opal Assist (6 files, not a tracker feature — re-confirmed per "Do this first" #5) —
     98/98 pass.
- Integration, by feature batch (8 batches across 9 throwaway databases, 472 tests, 2 failures):
  1. `block-review.itest.js` + `travel-outlook-sync.itest.js` together — 21/21 pass. Re-ran
     `block-review.itest.js` alone four more times to check for order-dependency: 2 failed
     (12/13), 2 passed (13/13) — confirmed flaky, see "Do this first" #1.
  2. Onboarding (`onboarding-journey`, `onboarding-pack`, `onboarding-payroll-xero`) — 40/40 pass.
  3. Resource Hub (`resources`, `resource-hub-r2`, `resource-library`,
     `resource-library-sharepoint`) — 124/124 pass. The fourth file exists in the repo but wasn't
     named in any prior brief's STATUS.md; included tonight for completeness.
  4. Induction/learning/walkthrough — 57/57 pass.
  5. Assessments/templates (`whodas`, `fca-reports`, `progress-note-letters`, `templates`) —
     173/173 pass.
  6. Case-note + Snapshot (`case-note-approval-edit`, `case-note-client-link`,
     `case-note-deidentification`, `snapshot`) — 16/16 pass.
  7. Accounting/Finance (`accounting-phase2`, `accounting-routes`, `finance-routes`) — 31/31 pass.
  8. `readonly-and-hardening` + `assist` — 9/10 pass. `readonly-and-hardening`'s "D-6/D-7: storage
     failure behaviour" expects a `chmod`'d read-only directory to make a file write fail (≥500);
     this sandbox runs as `root` (`id` → `uid=0`), so the permission check never applies and the
     write succeeds (201). Same sandbox artifact as 2026-11-04, not a product defect.

**Not run** (RELEASE-only, prohibited at this level per `.claude/rules/tests.md`): `npm test`,
`npm run test:integration`, `npm run test:all`, `npm run test:e2e:local`.

**Could not locate**: the Opa Mobile Companion native/PWA client itself (not in this repository —
only its backend API surface). No e2e spec exists anywhere for calendar, splose, outlook, travel,
resources, induction, assessments, fca, letters, templates, accounting, or xero — `e2e/tests/`
contains only `portal.spec.js` and `tutorials.spec.js`. `docs/qa/BROWSER_QA_RESULTS.md` is still
dated 2026-08-01 — now just over three months stale against the amount of backend work since.

**Open questions for the team** (unchanged from 2026-11-04 — none has been answered):
1. Should Admin be able to approve staff leave/CPD, or is owner-only correct by design? (affects
   "Do this first" #3)
2. Is the SharePoint-vs-database-storage question for onboarding documents settled, or still open?
3. Should `ENABLE_WHODAS_ASSESSMENT` be turned on anywhere right now?
4. Opal Assist and the Case Notes editing/approval flow have no tracker cards at all — this is the
   third audit running asking for one, specifically for Opal Assist.

**Tracker write-back**: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json`
→ `post-tracker: 13 features posted, 0 already posted tonight, brief posted`. Run before the git
push, as required.
