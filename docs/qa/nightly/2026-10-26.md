# Nightly tracker audit — 2026-10-26

## 1. Status line

**RAN** · 2026-10-26 18:47 UTC · commit audited `896ace17132239657f069fc6a7f3b3fb5cd619fc` (branch `develop`)

Counts: **tab-unproven: 4 · needs-refinement: 6 · broken: 1 · untouched: 2 · proven: 0 · built-untested: 0** (13 features total)

Tonight's window (since the last **pushed** brief, 2026-10-24, commit
`d64389c0`) held **8 real commits** on `backend`/`frontend/current`: a
two-commit resource-privacy upload checklist + "Upload anyway" override
(Clinical Resources' Library screen), a one-commit dependency security
patch (lockfile only), and a five-commit "Make room" booking-panel feature
that has no tracker card of its own (see §6). No classification changed —
the one feature actually touched tonight (Clinical Resources) stayed
`tab-unproven`, because the new code landed on the same screen nobody has
opened in a browser yet.

**A gap in this branch's own history, found tonight, not by this audit's
design:** the newest dated brief this branch had going into tonight was
`2026-10-24.md`. But the tracker's own `claude_update`/`next_action` fields
carry a later write-back (timestamps ~2026-10-25T19:00–19:01 UTC) whose
wording — "9th night running" on the Outlook bug, and an explicit mention of
tonight's-then-tonight's "Make room" booking feature — can only have come
from a real audit that ran, re-verified the code, and completed its tracker
write-back on the night of 2026-10-25. No `docs/qa/nightly/2026-10-25.md`,
no branch commit, and no PR #1 comment for that night exist anywhere on
`origin/claude/nightly-audit` or the open PR. This matches exactly the
failure mode the "write tracker before push" ordering in this audit's own
instructions exists to survive: the tracker update landed, but that night's
git commit/push/PR-comment step never completed (or the whole run was cut
off after the write-back). Nothing to fix in code — flagged here so the
team knows one night's dated brief is genuinely missing from this branch,
not merely unremarkable. This audit used the 2026-10-24 brief as its
baseline (the newest one actually on this branch), so the commit window
above correctly also covers everything that landed on 2026-10-25.

Every step tonight — fetching the tracker, locating and re-verifying every
feature, running tests, writing the feature folders and this brief, the
tracker write-back, and the git push — was carried out directly in this one
session, with no sub-task delegation. Nothing under `backend/`, `frontend/`,
`deploy/`, `e2e/` or `.github/` was changed by this audit itself.

## 2. Do this first

1. **`broken` — the same bug, 10th consecutive night.** `GET /api/outlook/categories`
   (`backend/routes.js:1466`) still returns a raw `500` instead of a clean
   response when the calling user isn't connected to Outlook
   (`getValidAccessToken`, `routes.js:151`, throws `Error('Outlook not
   connected')` with nothing to catch it cleanly). Re-read both functions
   tonight — byte-for-byte unchanged since first reported 2026-10-17. Still
   no regression test anywhere.
2. **`tab-unproven`, the gap grew tonight.** Clinical Resources' Library
   view still hasn't been opened by a human since its 2026-10-22 rebuild,
   and tonight it gained a second, tested feature on the same unproven
   screen: a privacy-refusal checklist with an audited "Upload anyway"
   override for refusals that are only emails/dates/phone numbers (never for
   a client identifier). Five minutes with an Owner/Admin account and a
   therapist account would move this back to `proven` and prove the new
   checklist at the same time.
3. **`needs-refinement`, unchanged — worth keeping visible.** Portal
   Onboarding Workflow's one genuine remaining gap is unchanged: nothing
   stores finished Stage 2 documents in SharePoint, exactly as the
   tracker's own checklist says.
4. **Tracker hygiene reminder (no code), carried forward again.** The
   "Multi Calendar Rules" checklist item "Confirm the Portal and Splose end
   up matching in both directions" has had a real, tested implementation
   since 2026-10-22 (`backend/splose-match.js`, `splose-sync-routes.js`,
   `tests/integration/splose-link-ignore.itest.js`) but still reads as
   entirely unstarted in the tracker.
5. **`tab-unproven`, unchanged tonight** — Xero's Financial Dashboard,
   Report Templates (FCA/Letter/Client Agreement) and Interactive
   Assessments all remain solidly built and tested with no browser/E2E
   proof of the screen itself.

**Worth a look, not urgent:** a "Make room" booking-panel feature (shorten
or split an existing calendar block to fit a new session) shipped across
five commits tonight in the Book/Calendar area, with no tracker card of its
own — see §6.

## 3. Every feature

| Feature | Tracker stage | Evidence | Reason | Tests run |
|---|---|---|---|---|
| Xero Integration Works | idea | tab-unproven | Financial Dashboard built+guarded+tested, never browser-checked connected; Payroll Automation built+tested (tracker checklist stale) — unchanged, re-verified tonight | unit: pass · integration: pass |
| Update Opal Docs Register | idea | untouched | Off-platform Excel register, no code | none |
| Report Templates | idea | tab-unproven | FCA/Letter/Client-Agreement engines built+tested; generation screens unproven in a browser — unchanged, re-verified tonight | unit: pass · integration: pass |
| Professional Development | idea | needs-refinement | Two unrelated CPD systems exist; Resource Hub's is tested, My Profile's has no dedicated test — touched tonight by a 1-line `reasons` passthrough on the unrelated rh2 file route, not the CPD logic | unit: n/a (route code) · integration: pass (Resource Hub CPD) |
| Portal - Splose - Outlook \| Integration Works | idea | **broken** | Same confirmed `/api/outlook/categories` 500 bug, now 10th night running; 2026-10-22's two-way match/link/ignore reconciliation unchanged and still passing; an unrelated "Make room" booking feature landed under the same Book/Calendar area tonight (see §6) | unit: pass · integration: pass |
| Portal Onboarding Workflow | idea | needs-refinement | 2026-10-22's Stage 2/3 portal flow and account-takeover fix hold; SharePoint storage for Stage 2 documents remains the one gap exactly as described — unchanged tonight | unit: pass · integration: pass |
| Password Master Document | idea | untouched | Off-platform OneDrive document, no code | none |
| Opa Mobile Companion | idea | needs-refinement | Case noting and Calendar View both built+guarded+tested; no mobile client in this repo to confirm real integration — unchanged tonight | unit: pass · integration: pass |
| Interactive Assessments | idea | tab-unproven | Catalogue/review engine built+tested; wizard unproven in a browser — unchanged tonight | unit: pass · integration: pass |
| Inductions | idea | needs-refinement | Everyday walkthroughs fully proven (E2E); AI co-author built+tested but unproven in a browser; "Splose Inductions" scope unclear — unchanged tonight | unit: pass · integration: pass · e2e: proven (walkthroughs) |
| Employee Personal Page (My Profile Tab) | idea | needs-refinement | Credentials/documents/work-locations proven; leave and CPD approve-reject round trip has no dedicated test — unchanged tonight | unit: pass · integration: pass (1 env-only artifact, see §7) |
| Clinical resources | idea | tab-unproven | Gained a tested privacy-refusal checklist + audited "Upload anyway" override tonight, on the same Library screen nobody has opened in a browser since its 2026-10-22 rebuild — gap grew, label unchanged | unit: pass · integration: pass (1 transient deadlock flake, cleared on isolated re-run — see §7) |
| Automated Reminders | idea | needs-refinement | Client appointment reminders not started at all (re-confirmed: still no cron/SMS infra); Therapist Snapshot built+tested, panel itself never browser-checked — unchanged tonight | unit: pass · integration: pass |

## 4. Prompts for the morning

**1. `/opal-fast-change`** — fix the Outlook-categories 500 (10th night running).
> Files: `backend/routes.js` (route at line ~1466, `getValidAccessToken` at line ~151). Make `GET /api/outlook/categories` answer cleanly (e.g. `200 { categories: [] }` or a specific 4xx) when `getValidAccessToken` throws `Error('Outlook not connected')`, instead of falling through to the generic 500 handler. Add a regression test near `tests/outlook-mirror.test.js` or `tests/travel-sync-routes.test.js`. Done when: a new test asserts a clean (non-500) response for a disconnected user.

**2. `/opal-feature`** — prove the rebuilt Resource Library screen (now including tonight's privacy checklist) in a browser.
> Files: `backend/resource-library-routes.js`, `backend/resource-privacy-reasons.js`, `frontend/current/resourcelibrary.js`. Open the Resources tab as Owner/Admin, browse the Library, and walk: open a folder, upload, rename, move, delete-to-bin, restore, view version history. Then deliberately trigger a privacy refusal that's only an email/date/phone number, tick the checklist, and confirm "Upload anyway" succeeds and is audited. Repeat read-only paths as a therapist and a read_only user. Add a `docs/qa/BROWSER_QA_RESULTS.md` row or an E2E spec. Done when: the new screen (including the override flow) has the same kind of browser proof the old one had before the 2026-10-22 rebuild.

**3. `/opal-critical`** — decide where Stage 2 onboarding documents should actually live.
> Files: `backend/onboarding-record-documents.js` (today's DB-backed store), `backend/resource-library-routes.js` (Clinical Resources' unrelated "SharePoint-style" library), `backend/outlook-oauth.js`/`graph-identity.js` (the existing Microsoft Graph auth pattern, if real SharePoint is still wanted). This is employee-sensitive, so CRITICAL level. Done when: a decision is recorded, and if SharePoint is still wanted, an integration test proves a finished document reaches it and links back in the portal.

**4. Tracker hygiene (no code)** — tick the "Multi Calendar Rules" checklist item that 2026-10-22's work answered.
> The task's own checklist item "Confirm the Portal and Splose end up matching in both directions" has a real, tested implementation (`backend/splose-match.js`, `splose-sync-routes.js`, `tests/integration/splose-link-ignore.itest.js`). The other five items on that checklist are still open and still largely manual/QA in nature.

**5. `/opal-feature`** — prove the Xero Finance Dashboard, FCA/Letter/Client-Agreement and assessment-wizard screens render.
> Files: `backend/finance-routes.js`, `backend/fca-routes.js`, `backend/letter-routes.js`, `backend/templates-routes.js`, `backend/whodas-routes.js`/`assessments-routes.js`; frontend `finance.js`, `fca.js`, `letter.js`, `templates.js`, `assessment.js`. Add one browser/E2E check per screen. Done when: each screen has a passing browser/E2E check. (Unchanged from prior nights — still queued behind items 1–4 above.)

## 5. Ideas without a start

All 13 feature folders already existed on `claude/nightly-audit` from prior
nights; none were created fresh tonight. `clinical-resources/START.md` was
substantively rewritten tonight to add the privacy-override checklist to
"Where it lives today" and "Start here" (the browser-proof gap it still
needs is the same one, now slightly bigger).
`portal-splose-outlook-integration-works/START.md` had only its night-count
and date bumped. Every other `START.md` was left as-is — no feature's
evidence label changed tonight, so no other starter prompt needed
rewriting. Every `STATUS.md` was rewritten tonight to record either a
re-verification against unchanged code (11 features) or the real changes
above (Clinical Resources, and Professional Development's incidental
one-line touch).

## 6. What changed since last audit

Commit window: 2026-10-24 (after `d64389c0`) through tonight's `896ace1`, 8
commits on `backend`/`frontend/current`:

- **Resource Library (Clinical Resources)** — `31d5008`, `896ace1`: a
  privacy-refusal checklist (`resource-privacy-reasons.js`, per-page
  `locateFindings()` in `resource-file-quality.js`) and an audited "Upload
  anyway" override for refusals that are only bare patterns, never for a
  client identifier. Guards unchanged (`requireManager` on both affected
  routes). See Clinical Resources' folder.
- **Dependency security patch** — `0628bda`: `body-parser` 1.20.9 and
  `nodemailer` 10.2.1, lockfile only, no application code touched.
- **"Make room" booking-panel feature, no tracker card** — `94dad51`,
  `58f3fec`, `c86355b`, `ac4912e`, `74d9d91`: shorten or split existing
  calendar blocks to make room for a new session, in
  `frontend/current/travel.js`/`booking-route.css`/`mockup_v3.html`. Pure
  frontend, no new backend route or guard surface; covered by the new
  `tests/smart-booking-route.test.js` (passes). This subsystem doesn't map
  to any of the 13 tracker features by title — closest by area is Portal -
  Splose - Outlook's "Calendar", but that card's own scope is the
  Portal/Splose/Outlook sync, not the booking panel's block-editing UI.
  Worth the team's attention only to decide whether it needs its own card.

One commit outside this audit's scoped paths also landed in the window —
`629d17a` (`deploy:` go-live script change, 2026-10-22, under `deploy/`) —
noted for completeness only; this audit does not read or act on `deploy/`.

## 7. Technical detail

### No process incident in this session

No sub-task delegation was used. Every step was carried out directly in
this one session. Nothing under `backend/`, `frontend/`, `deploy/`, `e2e/`
or `.github/` was touched by the audit itself. See §1 for the real
incident this audit *found* (not caused): the apparent missing
2026-10-25 brief/push.

### Commands run tonight

```
NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json
  → fetch-tracker: 13 features, 19 tasks -> /tmp/tracker.json

service postgresql start   (was down at session start)
  → 16/main (port 5432): online

node --check <every backend/*.js module, recursive>
  → all clean, no syntax errors

node scripts/check-asset-pins.js
  → every pin matches the shell this commit would ship
    (resourcelibrary.js / resourcelibrary.css correctly bumped 2 → 3)

grep -rn "TODO|FIXME" backend --include=*.js (excluding tests/)
  → no hits anywhere

Unit tests (66 files covering every located feature + tonight's new/changed
test files), run as one batch:
  2,606 total — 2,594 passed, 12 skipped, 0 failed. Time: 38.5s. Clean on
  the first run, no flake.

Integration tests (DB_NAME=therapy_scheduler_auditnight1026, DB_PASSWORD=audit,
--runInBand), 36 files covering every located feature, run in two batches
(the slow onboarding.itest.js separately, as on prior nights):
  Batch 1 — 35 files, 699 tests: 33 suites passed, 2 failed — 697 passed,
  2 failed. Time: 1101.4s.
  Batch 2 — onboarding.itest.js alone: 49/49 passed. Time: 123.7s.
```

**Two integration failures tonight, one known and one chased down as a flake:**

1. `tests/integration/readonly-and-hardening.itest.js`, "D-6/D-7: storage
   failure behaviour" — expects a `chmod 0o000`'d directory to make a
   document write fail with ≥500; got 201. This sandbox runs the test
   process as root (`uid=0`), and Linux root bypasses file-permission bits,
   so the simulated failure never actually happens here. **Not a new
   finding** — independently documented by every audit since 2026-10-16.
   Not a product defect, and not the basis for any feature's classification.
2. `tests/integration/resource-library.itest.js`, "uploading into a folder
   › records the upload in the audit trail" — failed with a genuine
   Postgres `deadlock detected` inside `truncateAll()`'s
   `TRUNCATE ... RESTART IDENTITY CASCADE`, while running as part of the
   35-file batch under `--runInBand`. Re-ran this file alone immediately
   after: **53/53 passed, clean**, confirming a batch-concurrency flake
   (most likely contention with the recycle bin's daily purge job or
   another file's connection in the same batch run), not a defect in the
   privacy-override code it was exercising. One re-run only, per the
   testing policy's flake rule; it did not recur.

Combined, discounting the confirmed flake: 36 suites, 747 of 748 tests
passed, with exactly the one known-environmental failure above — consistent
with every audit since 2026-10-16.

Guard checks (`requireAuth`/`requireRole`/`requirePermission` on every
located route, including tonight's two touched routes) and a `TODO`/`FIXME`
sweep of every located file — and, tonight, a repo-wide sweep of all of
`backend/` outside `tests/` — were both run tonight: no unguarded endpoint,
no TODO/FIXME anywhere.

Today (2026-10-26, Monday UTC) is not a Sunday, so the weekly deep run
(`npm test` / `npm run test:integration` in full) was correctly not
executed — only targeted, per-feature tests as the testing policy requires.

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
- Tonight's "Make room" booking-panel feature (§6) has no tracker card —
  worth a decision on whether it needs one.
- The apparent missing 2026-10-25 brief/push (§1) — worth checking why that
  night's git/PR step didn't complete, since its tracker write-back clearly
  did.

### Tracker write-back

```
NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json
  → post-tracker: 13 features posted, 0 already posted tonight, brief posted
```
