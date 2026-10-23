# Nightly tracker audit — 2026-10-23

## 1. Status line

**RAN** · 2026-10-23 18:13 UTC · commit audited `d64389c014e300dff17e342b1c4c7b4658600231` (branch `develop`)

Counts: **tab-unproven: 4 · needs-refinement: 6 · broken: 1 · untouched: 2 · proven: 0 · built-untested: 0** (13 features total)

Tonight is a quiet night: `origin/develop`'s HEAD is byte-for-byte the same
commit audited last night (`d64389c0`) — **zero commits** in the window.
Every feature below was re-verified end to end against that same, unchanged
code (locations re-confirmed, guards re-checked, every targeted unit and
integration test re-run), not carried over unexamined from last night's
brief. No classification changed. Every step — fetching the tracker,
re-verifying code and tests, writing the feature folders and this brief, the
tracker write-back, and the git push — was carried out directly in this one
session, with no sub-task delegation. Nothing under `backend/`, `frontend/`,
`deploy/`, `e2e/` or `.github/` was touched by this audit itself.

## 2. Do this first

1. **`broken` — the same bug, 7th consecutive night.** `GET /api/outlook/categories`
   (`backend/routes.js:1466`) still returns a raw `500` instead of a clean
   response when the calling user isn't connected to Outlook
   (`getValidAccessToken`, `routes.js:151`, throws `Error('Outlook not
   connected')` with nothing to catch it cleanly). Re-read both functions
   tonight — byte-for-byte unchanged since first reported 2026-10-17. Still
   no regression test anywhere. This bug has also sat in
   `docs/qa/BROWSER_QA_RESULTS.md` as a known "Medium" console error since
   the original browser QA pass on 2026-08-01 — now nearly three months old.
2. **`tab-unproven` since 2026-10-22, still unactioned.** Clinical Resources'
   Library view was rebuilt from scratch two nights ago (any-depth folders,
   recycle bin, version history) and has still not been opened by a human —
   the code and tests remain solid. Five minutes with an Owner/Admin account
   and a therapist account would very likely move this back to `proven`.
3. **`needs-refinement`, unchanged — worth keeping visible.** Portal
   Onboarding Workflow's Stage 2/3 moved a long way forward on 2026-10-22
   (release, invitation, induction, an Owner-only Activate gate; an
   account-takeover bug fixed along the way). The one gap still *exactly* as
   described in the tracker: nothing stores finished Stage 2 documents in
   SharePoint. "SharePoint" names two unrelated things in this codebase now
   — this genuine gap, and Clinical Resources' unrelated "SharePoint-*style*"
   UI — still worth a one-line clarification in the tracker.
4. **Tracker hygiene reminder (no code), carried forward.** The "Multi
   Calendar Rules" checklist item "Confirm the Portal and Splose end up
   matching in both directions" has had a real, tested implementation since
   2026-10-22 (`backend/splose-match.js`, `splose-sync-routes.js`,
   `tests/integration/splose-link-ignore.itest.js`) but still reads as
   entirely unstarted in the tracker.
5. **`tab-unproven`, unchanged tonight** — Xero's Financial Dashboard, Report
   Templates (FCA/Letter/Client Agreement) and Interactive Assessments all
   remain solidly built and tested with no browser/E2E proof of the screen
   itself. No new information tonight; still the next-most-valuable
   low-effort browser-proof wins after items 1–4 above.

## 3. Every feature

| Feature | Tracker stage | Evidence | Reason | Tests run |
|---|---|---|---|---|
| Xero Integration Works | idea | tab-unproven | Financial Dashboard built+guarded+tested, never browser-checked connected; Payroll Automation built+tested (tracker checklist stale) — unchanged, re-verified tonight | unit: pass · integration: pass |
| Update Opal Docs Register | idea | untouched | Off-platform Excel register, no code | none |
| Report Templates | idea | tab-unproven | FCA/Letter/Client-Agreement engines built+tested; generation screens unproven in a browser — unchanged, re-verified tonight | unit: pass (1 isolated-run flake, see §7) · integration: pass |
| Professional Development | idea | needs-refinement | Two unrelated CPD systems exist; Resource Hub's is tested, My Profile's has no dedicated test — unchanged tonight | unit: n/a (route code) · integration: pass (Resource Hub CPD) |
| Portal - Splose - Outlook \| Integration Works | idea | **broken** | Same confirmed `/api/outlook/categories` 500 bug, now 7th night running; 2026-10-22's two-way match/link/ignore reconciliation unchanged and still passing | unit: pass · integration: pass |
| Portal Onboarding Workflow | idea | needs-refinement | 2026-10-22's Stage 2/3 portal flow and account-takeover fix hold; SharePoint storage for Stage 2 documents remains the one gap exactly as described — unchanged tonight | unit: pass · integration: pass |
| Password Master Document | idea | untouched | Off-platform OneDrive document, no code | none |
| Opa Mobile Companion | idea | needs-refinement | Case noting and Calendar View both built+guarded+tested; no mobile client in this repo to confirm real integration — unchanged tonight | unit: pass · integration: pass |
| Interactive Assessments | idea | tab-unproven | Catalogue/review engine built+tested; wizard unproven in a browser — unchanged tonight | unit: pass · integration: pass |
| Inductions | idea | needs-refinement | Everyday walkthroughs fully proven (E2E); AI co-author built+tested but unproven in a browser; "Splose Inductions" scope unclear — unchanged tonight | unit: pass · integration: pass · e2e: proven (walkthroughs) |
| Employee Personal Page (My Profile Tab) | idea | needs-refinement | Credentials/documents/work-locations proven; leave and CPD approve-reject round trip has no dedicated test — unchanged tonight | unit: pass · integration: pass (1 env-only artifact, see §7) |
| Clinical resources | idea | tab-unproven | 2026-10-22's Library rebuild (folders, recycle bin, version history) unchanged — code+tests solid, still no browser proof of the new screen | unit: pass · integration: pass |
| Automated Reminders | idea | needs-refinement | Client appointment reminders not started at all; Therapist Snapshot built+tested, panel itself never browser-checked — unchanged tonight | unit: pass · integration: pass |

## 4. Prompts for the morning

**1. `/opal-fast-change`** — fix the Outlook-categories 500 (7th night running).
> Files: `backend/routes.js` (route at line ~1466, `getValidAccessToken` at line ~151). Make `GET /api/outlook/categories` answer cleanly (e.g. `200 { categories: [] }` or a specific 4xx) when `getValidAccessToken` throws `Error('Outlook not connected')`, instead of falling through to the generic 500 handler. Add a regression test near `tests/outlook-mirror.test.js` or `tests/travel-sync-routes.test.js`. Done when: a new test asserts a clean (non-500) response for a disconnected user.

**2. `/opal-feature`** — prove the rebuilt Resource Library screen in a browser.
> Files: `backend/resource-library-routes.js`, `frontend/current/resourcelibrary.js`. Open the Resources tab as Owner/Admin, browse the Library, and walk: open a folder, upload, rename, move, delete-to-bin, restore, view version history. Repeat read-only paths as a therapist and a read_only user. Add a `docs/qa/BROWSER_QA_RESULTS.md` row or an E2E spec. Done when: the new screen has the same kind of browser proof the old one had before the 2026-10-22 rebuild.

**3. `/opal-critical`** — decide where Stage 2 onboarding documents should actually live.
> Files: `backend/onboarding-record-documents.js` (today's DB-backed store), `backend/resource-library-routes.js` (Clinical Resources' unrelated "SharePoint-style" library), `backend/outlook-oauth.js`/`graph-identity.js` (the existing Microsoft Graph auth pattern, if real SharePoint is still wanted). This is employee-sensitive, so CRITICAL level. Done when: a decision is recorded, and if SharePoint is still wanted, an integration test proves a finished document reaches it and links back in the portal.

**4. Tracker hygiene (no code)** — tick the "Multi Calendar Rules" checklist item that 2026-10-22's work answered.
> The task's own checklist item "Confirm the Portal and Splose end up matching in both directions" has a real, tested implementation (`backend/splose-match.js`, `splose-sync-routes.js`, `tests/integration/splose-link-ignore.itest.js`). The other five items on that checklist are still open and still largely manual/QA in nature.

**5. `/opal-feature`** — prove the Xero Finance Dashboard, FCA/Letter/Client-Agreement and assessment-wizard screens render.
> Files: `backend/finance-routes.js`, `backend/fca-routes.js`, `backend/letter-routes.js`, `backend/templates-routes.js`, `backend/whodas-routes.js`/`assessments-routes.js`; frontend `finance.js`, `fca.js`, `letter.js`, `templates.js`, `assessment.js`. Add one browser/E2E check per screen. Done when: each screen has a passing browser/E2E check. (Unchanged from prior nights — still queued behind items 1–4 above.)

## 5. Ideas without a start

All 13 feature folders already existed on `claude/nightly-audit` from prior
nights; none were created fresh tonight, and no `START.md` needed a
substantive rewrite — only the Portal/Splose/Outlook card's "night count"
line was bumped (6th → 7th). Every `STATUS.md` was rewritten tonight to
record a pure re-verification against unchanged code: locations, guard
checks and test results were all re-confirmed, not carried over unexamined.

## 6. What changed since last audit

Nothing. `origin/develop`'s HEAD is unchanged at `d64389c0` — the same
commit audited on 2026-10-22. Zero commits in `backend/` or
`frontend/current/` since then. This is the first fully quiet night (no new
commits at all) since the long freeze that ended on 2026-10-22.

## 7. Technical detail

### No process incident tonight

No sub-task delegation was used. Every step — fetching the tracker,
re-verifying code and tests, writing the feature folders and this brief, the
tracker write-back, and the git push — was carried out directly in this one
session. Nothing under `backend/`, `frontend/`, `deploy/`, `e2e/` or
`.github/` was touched by the audit itself.

### Could not locate / open questions for the team

- "Multi Calendar Rules" (Portal - Splose - Outlook) still has five of its
  six checklist items open. "Splose Inductions" (Inductions) still has no
  located data-sync code, only a same-named training-content module.
- "Update Opal Docs Register" and "Password Master Document" remain
  off-platform items with nothing to locate in this codebase.
- `backend/profile-routes.js`'s CPD and `backend/resource-hub-r2-routes.js`'s
  CPD remain two separate, unrelated systems sharing the word "CPD".
- "SharePoint" still names two unrelated things in this codebase — Portal
  Onboarding Workflow's genuinely-missing Microsoft SharePoint integration,
  and Clinical Resources' "SharePoint-*style*" (but not actually SharePoint)
  document library.

### Commands run tonight

```
NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json
  → fetch-tracker: 13 features, 19 tasks -> /tmp/tracker.json

node --check <every backend/*.js module>
  → all clean, no syntax errors

node scripts/check-asset-pins.js
  → every pin matches the shell this commit would ship

Unit tests (61 files covering every located feature), run as one batch:
  2,462 total — 2,449 passed, 1 failed on the first run, 12 skipped.
  The one failure, fca-wizard-behaviour.test.js's debounce-timing assertion
  ("several rapid changes compose once"), did not reproduce when the file
  was re-run alone (58/58 passed) — a CPU-contention flake from running 64
  suites in parallel, not a code regression (code is unchanged since last
  night). See Report Templates' folder.

Integration tests (DB_NAME=therapy_scheduler_auditnight1023*, DB_PASSWORD=audit,
--runInBand), 36 files covering every located feature:
  First attempt (all 36 files in one batch) was killed by this sandbox's own
  background-command time limit partway through the slow
  `onboarding.itest.js` file (which seeds dozens of synthetic organisations
  and runs long). The kill severed live Postgres connections mid-query,
  which cascaded into "Connection terminated unexpectedly" and "deadlock
  detected" errors on every test running at that moment — a sandbox-tooling
  artifact, not a product or test defect, and not reported against any
  feature. Re-run in two batches instead: 35 files together (693 tests,
  692 passed, 1 known-environmental failure — see below), and
  `onboarding.itest.js` alone with a longer allowance (49/49 passed).
  Final result: 36 suites, 741 passed, 1 known-environmental failure
  (readonly-and-hardening.itest.js, see below), 0 real failures.
```

**The one integration-test failure**: `tests/integration/readonly-and-hardening.itest.js`,
"D-6/D-7: storage failure behaviour" — expects a `chmod 0o000`'d directory to
make a document write fail with ≥500; got 201. This sandbox runs the test
process as root (`uid=0`), and Linux root bypasses file-permission bits, so
the simulated failure never actually happens here. **Not a new finding** —
independently documented by every audit since 2026-10-16. Not a product
defect, and not the basis for any feature's classification.

Guard checks (`requireAuth`/`requireRole`/`requirePermission` on every
located route) and a `TODO`/`FIXME` sweep of every located file were both
run tonight — no unguarded endpoint, no new TODO/FIXME anywhere.

Today (2026-10-23, Friday UTC) is not a Sunday, so the weekly deep run
(`npm test` / `npm run test:integration` in full) was correctly not
executed — only targeted, per-feature tests as the testing policy requires.

### Tracker write-back

```
NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json
  → post-tracker: 13 features posted, 0 already posted tonight, brief posted
```
