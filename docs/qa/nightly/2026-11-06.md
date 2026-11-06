# Nightly tracker audit — 2026-11-06

## 1. Status line

**RAN.** 2026-11-06 ~18:10–19:45 UTC. Commit audited: `704a51f55ffc08f3e159fc0ae3a204dd132f554d`
(`develop`). Four commits landed since the 2026-11-05 audit's cutoff (`8853376`): `704a51f`
(night-mode calendar theme), `0a365c4` (Splose change-alert dialog fix), `cd8c4a8` (Opal Assist
composer), `e3c0b90` (block-review audit-write fix). Not a Sunday, so no weekly deep run (full
suites) was run.

**Counts across the 13 tracker features:** proven 0 · tab-unproven 5 · needs-refinement 3 ·
broken 3 · untouched 2 · built-untested 0.

**A process note first, because it affects how to read everything below.** This run's checkout
started from `origin/develop`, which has never had `claude/nightly-audit` merged into it, so
`docs/qa/nightly/` initially looked empty (only `README.md`) — exactly the same trap the
2026-11-04 and 2026-11-05 briefs each hit and recorded. Early in tonight's run, every worker was
(wrongly) told no prior audit existed and to disregard the tracker's "re-confirmed tonight"
wording as unverifiable. That was incorrect: real prior audits exist for 2026-11-01/02/04/05 on
`origin/claude/nightly-audit`, confirmed genuine (`git merge-base origin/claude/nightly-audit HEAD`
lands exactly on `8853376`, the commit the 2026-11-05 brief says it audited, and independent
re-derivations tonight landed on the *exact same file:line evidence* the real prior briefs already
recorded). That history was recovered mid-run (`git checkout origin/claude/nightly-audit --
docs/qa/nightly`) and every feature folder below was corrected to build on it rather than
pretending to be a first-ever audit. One side-effect: the recovery step raced two still-running
workers and clobbered their just-written files before they were committed; those workers were
resumed and told to rewrite them — the end result is intact, but it cost real time, and it's worth
fixing `scripts/nightly-audit/PROMPT.md`'s Setup section to say explicitly "recover
`docs/qa/nightly/` from `origin/claude/nightly-audit` via `git checkout <ref> -- docs/qa/nightly`
*before* starting any worker," the way the 2026-11-05 run itself did, so this doesn't recur.

Even so, tonight re-ran every targeted test batch from scratch (not copied from last night) and
found real things:

1. The block-review audit-log race flagged for 3 nights running (2026-11-02/04/05) is **fixed**.
   Commit `e3c0b90` now `await`s every `audit()` call in `block-review-routes.js`. Verified by
   running `tests/integration/block-review.itest.js` in isolation four separate times tonight:
   **13/13 passed every time**, no flake.
2. The Outlook-categories 500 (documented since an August browser QA pass, flagged again on
   2026-11-02/04/05) is **still broken** — confirmed by direct code read tonight, zero test
   coverage either way.
3. **Opa Mobile Companion moves from `proven` (every prior audit) to `tab-unproven` tonight** —
   see "Do this first" #3. This is a genuine disagreement with three straight nights of history,
   not a new code problem.
4. Report Templates' "Client Agreement Form" was briefly misclassified `untouched` partway through
   tonight's run (an initial check only looked for a dedicated route file and didn't find one) —
   corrected before this brief: it's served through the generic Templates engine
   (`backend/templates-routes.js` → `backend/templates/catalogue.js`, `id: 'service_agreement'`)
   and is fully built, guarded and tested (153 unit + 24 integration). `CLAUDE.md`'s own repository
   map is stale here — it names a `backend/service-agreement-routes.js` that doesn't exist.
5. Xero's unit/integration test count, recounted tonight, is **116** (77 unit + 39 integration),
   wider than the 2026-11-05 brief's "70" because tonight's batch also included
   `tests/xero-payroll-sync.test.js` and `tests/integration/onboarding-payroll-xero.itest.js` —
   both genuinely part of this subsystem. No code changed, so this is a scope correction to the
   count, not a contradiction.

## 2. Do this first

1. **[broken, 5th night unfixed]** `GET /api/outlook/categories` (`backend/routes.js:1487-1498`)
   still falls through to a raw 500 instead of a clean "not connected" response when a user has no
   Outlook connection. Zero test coverage. See
   `docs/qa/nightly/features/portal-splose-outlook-integration-works/START.md`.
2. **[broken, 3rd night confirmed, two tracker cards]** Admin users see Approve/Reject/Verify
   buttons for staff leave, credentials and CPD requests that always fail when clicked — only the
   Owner role can actually approve (`backend/profile-routes.js:35-37` vs
   `frontend/current/profile.js:93,284,1344`). Not a security hole — the backend correctly blocks
   it — but broken UX on two cards at once (Professional Development, My Profile).
3. **[reverses 3 straight nights of "proven"]** Opa Mobile Companion's backend API (case noting,
   calendar view) is guarded, AI-gateway-compliant and fully tested (50 tests) — that part is
   unchanged and solid. But its native/PWA client isn't in this repository at all, and nothing here
   — no e2e spec, no browser-QA entry — proves what a user actually sees on a phone. Every prior
   audit called the whole feature `proven`; tonight's label is `tab-unproven`. Worth the team
   deciding whether "proven" should ever apply to the whole card, or only to its backend half.
4. **[tab-unproven, daily-use tab]** The Resource Hub Library's upload → privacy-refusal →
   "Upload anyway" → folder flow (`frontend/current/resourcelibrary.js`) is fully built and tested
   (390 + 168 tests) but has never been proven in a browser or an E2E spec.
5. **[stale checklist, 3rd time flagged]** The "Therapist Snapshot" tracker card's checklist item
   "Create minimise function on snapshot" is still marked done, but no minimise logic exists
   anywhere in `frontend/current/reports.js` or `mockup_v3.html` (only an unrelated
   collapse/expand toggle). Flagged on 2026-11-04, 05, and again tonight without action.

## 3. Every feature

| Feature | Tracker stage | Evidence | Reason | Tests run |
|---|---|---|---|---|
| Portal - Splose - Outlook \| Integration Works | idea | broken | block-review race fixed tonight; outlook/categories 500 still open | 394/394 unit; 108/108 integration (incl. 4 clean re-runs of block-review) |
| Portal Onboarding Workflow | idea | needs-refinement | database-backed confirmed; dynamic-contract checklist item already done in code; SharePoint-vs-DB decision still open | 239/239 unit; 26/26 integration; 1 known env failure (OCR package, unrelated file) |
| Clinical resources | idea | tab-unproven | mature, tested backend; Library upload flow has no browser proof | 390/390 unit; 168/168 integration |
| Inductions | idea | needs-refinement | built, tested, genuinely e2e-covered (`tutorials.spec.js`); tracker tasks still `todo`; "hold point" step type not built by that name (a similar checkpoint/blocking step exists) | 258/258 unit; 130/130 integration |
| Professional Development | idea | broken | Admin approval-button mismatch, confirmed 3rd night, file:line evidence | 404/404 unit (shared security/guard suites); 22/22 integration (owner-side only) |
| Automated Reminders | idea | needs-refinement | client reminders unbuilt (no scheduler/provider); Snapshot built but checklist disagrees with code | 6/6 integration (Snapshot); none for reminders (nothing to test) |
| Employee Personal Page (My Profile Tab) | idea | broken | confirmed Admin approval-button mismatch, 3rd night | 404/404 unit; 22/22 integration (owner-side only) |
| Interactive Assessments | idea | tab-unproven | only WHODAS built; well tested; flag off by default; no browser proof | 656/656 unit (across 11 suites); integration passing |
| Opa Mobile Companion | idea | **tab-unproven** (was `proven`) | backend solid and tested; mobile client not in this repo | 50/50 unit; no matching integration file |
| Password Master Document | idea | untouched | by design — external OneDrive document | n/a |
| Report Templates | idea | tab-unproven | all three wizards (FCA, Progress Letter, Client Agreement via Templates engine) built, guarded, tested; zero browser/E2E proof | 569/569 unit across the three (257+159+153); 120/120 integration (41+55+24) |
| Update Opal Docs Register | idea | untouched | by design — external Excel register | n/a |
| Xero Integration Works | idea | tab-unproven | dashboard + payroll push built, guarded, tested; recounted at 116 (not 70); no live Xero sandbox run | 77/77 unit; 39/39 integration |

## 4. Prompts for the morning

**1.**
```
/opal-fast-change
In backend/routes.js around line 1487-1499, GET /api/outlook/categories currently falls through to
a generic 500 when the user has no Outlook connection. Catch that specific "Outlook not connected"
error from getValidAccessToken (backend/outlook-oauth.js) and return
res.status(409).json({ error: 'outlook_not_connected' }) instead. Add a unit test asserting the
409 — this has been flagged five nights running with zero test coverage. See
docs/qa/nightly/features/portal-splose-outlook-integration-works/START.md.
```

**2.**
```
/opal-critical
Admin users can see Approve/Reject/Verify buttons for staff leave, credentials and CPD requests in
frontend/current/profile.js (isManager includes 'admin', lines 93/284/1344), but
backend/profile-routes.js's canApprove/canViewAll are owner-only by design (see the 2026-08-06
RBAC comment at profile-routes.js:35-37). Confirm with the team whether Admin should be able to
approve these, then either narrow the frontend's isManager check for this section, or widen the
backend gate to match — pick one, don't leave them disagreeing. Add an integration test covering
submit -> approve/reject -> employee sees result. This is the 3rd consecutive night this defect
has been confirmed. See docs/qa/nightly/features/employee-personal-page-my-profile-tab/START.md
and docs/qa/nightly/features/professional-development/START.md.
```

**3.**
```
/opal-feature
"Opa Mobile Companion" has been marked proven on every nightly audit through 2026-11-05, but
tonight's audit downgraded it to tab-unproven: the backend API (backend/mobile-routes.js,
50/50 tests passing, AI-gateway-compliant) is solid, but the native/PWA mobile client itself is
not in this repository, so nothing here can verify what a user actually sees or taps on a phone.
Please do one of: (a) record a browser/device walkthrough of the Case Noting + Calendar View
checklist (see the tracker's own task list) so there's real evidence for the client half, or
(b) split this tracker card into a backend-API card (which can stay proven) and a separate
mobile-client card (whose evidence lives wherever that client's source actually is). See
docs/qa/nightly/features/opa-mobile-companion/START.md.
```

**4.**
```
/opal-feature
The Resource Hub Library's upload -> privacy-refusal -> "Upload anyway" -> folder flow
(frontend/current/resourcelibrary.js, backend/resource-library-routes.js) is fully built and
tested (390 unit + 168 integration passing) but has never been proven in a browser. Open the
Resources tab as owner or admin, go to the Library, upload a file that trips the privacy scan
(e.g. a document containing a bare email or date), work through the refusal checklist, click
"Upload anyway", and confirm it lands in the right folder. Record it as a new row in
docs/qa/BROWSER_QA_RESULTS.md, or add a Playwright spec under e2e/tests/. See
docs/qa/nightly/features/clinical-resources/START.md.
```

**5.**
```
/opal-fast-change
The "Therapist Snapshot" tracker card's checklist item "Create minimise function on snapshot" is
marked done, but no minimise logic exists anywhere in frontend/current/reports.js or
mockup_v3.html — only an unrelated collapse/expand toggle for the completed-items list
(swToggleCompleted). This has now been flagged three nights running (2026-11-04, 05, 06) without
action. Either implement the minimise feature, or correct the tracker checklist to reflect what's
actually built. See docs/qa/nightly/features/automated-reminders/START.md.
```

## 5. Ideas without a start

Only one feature's evidence label genuinely changed tonight: **Opa Mobile Companion**, `proven` →
`tab-unproven` (see "Do this first" #3 — a re-scoping of what this repo can actually verify, not a
code regression). Every other folder's label is unchanged from 2026-11-05; where a folder's text
was rewritten tonight, it's to correct the "no prior audit" framing error described in §1, not
because the underlying evidence changed. All 13 folders already existed from the prior four runs
on `origin/claude/nightly-audit`.

## 6. What changed since last audit

Four commits landed since the 2026-11-05 audit's cutoff (`8853376`):

- **Splose/Outlook/Calendar** — `0a365c4` fixes a stuck change-alert dialog in Splose sync;
  `e3c0b90` fixes the block-review audit-write race (see §1). Both verified tonight.
- **Theme** — `704a51f` improves night-mode calendar/travel contrast. No feature-level test
  regression found (`theme-night-contrast.test.js` passes).
- **Opal Assist** — `cd8c4a8` adds a new composer (grows as you type, attach, on-device dictation,
  model/context ring). **This is a subsystem that changed and has no tracker feature at all** —
  the 4th consecutive audit to flag this (first raised 2026-11-02/04/05). Re-confirmed tonight:
  111/111 tests pass (106 unit across 6 files + 5 integration), guarded, AI-gateway-compliant. Open
  a tracker card for it; a title is enough for the audit to pick up and verify the rest.

## 7. Technical detail

**Setup**: PostgreSQL was down at the start of this run; started it before anything else.
`backend/node_modules/.bin/jest` was present; no `npm install`/`npm ci` was run. `node --check` on
every top-level `backend/*.js` file passed with no syntax errors (197 files). `node
scripts/check-asset-pins.js` reports every cache-bust pin matches the shell.

**History recovery**: this checkout started from `origin/develop`, which has never had
`claude/nightly-audit` merged into it, so `docs/qa/nightly/` was empty on `develop` (only
`README.md`) exactly as the 2026-11-04/05 briefs each recorded. The real history (2026-11-01/02/
04/05 briefs, all 13 feature folders) was recovered mid-run via `git checkout
origin/claude/nightly-audit -- docs/qa/nightly`, confirmed genuine via `git merge-base
origin/claude/nightly-audit HEAD` landing exactly on `8853376`. See §1 for the process note and
the recommended `PROMPT.md` fix (do this recovery step first, before dispatching any worker, next
time).

**Tracker fetch**: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node
../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json` →
`fetch-tracker: 13 features, 19 tasks -> /tmp/tracker.json`. All 19 tasks still `todo`; no
decisions recorded on any feature; no tracker field changed by a human since the last audit.

**Commands run** (from `backend/`, all read-only against the repo), by feature batch:
1. Splose/Outlook/travel/block-review (24 files) — 394/394 unit pass; integration (11 files,
   `DB_NAME=therapy_scheduler_audit_a`) 108/108 pass, including 4 isolated clean re-runs of
   `block-review.itest.js`.
2. Onboarding (8 files run + 1 separately) — 239/239 unit pass; integration
   (`DB_NAME=therapy_scheduler_audit_b`) `onboarding-journey.itest.js` 26/26 pass;
   `onboarding-document-reader.test.js` run separately — 14/15 pass, 1 known environment gap
   (missing `@tesseract.js-data/eng` OCR language-data sub-package, unchanged since 2026-11-02).
3. Resource Hub (12 files) — 390/390 unit pass; integration
   (`DB_NAME=therapy_scheduler_audit_c`, 7 files) 168/168 pass.
4. Induction/learning/walkthrough — 258/258 unit pass; integration
   (`DB_NAME=therapy_scheduler_audit_d`) 130/130 pass.
5. Professional Development / My Profile (shared security/permission/guard suites) — 404/404 unit
   pass; integration (`DB_NAME=therapy_scheduler_audit_d`, `credential-scans.itest.js`) 22/22 pass
   (owner-side only — no test exercises the Admin 403 path either way).
6. Assessments/FCA/letters/templates (combined report-templates + interactive-assessments
   batches) — 657/657 + 569/569 unit pass across both features; integration
   (`DB_NAME=therapy_scheduler_audit_c`/`_e`) covering `fca-reports`, `progress-note-letters`,
   `templates`, `whodas`-related suites — all pass.
7. Mobile/case-note — 50/50 unit pass (`mobile-routes.test.js`); no matching integration file.
8. Finance/Xero payroll (6 files, recounted — see §1) — 77/77 unit pass; integration
   (`DB_NAME=therapy_scheduler_audit_e`, 4 files) 39/39 pass.
9. Opal Assist (6 files, not a tracker feature — see §6) — 106/106 unit pass; integration
   (`DB_NAME=therapy_scheduler_audit_f`) 5/5 pass.

**Not run** (RELEASE-only, prohibited at this level per `.claude/rules/tests.md`): `npm test`,
`npm run test:integration`, `npm run test:all`, `npm run test:e2e:local`.

**Could not locate**: the Opa Mobile Companion native/PWA client itself (not in this repository —
only its backend API surface). No e2e spec exists anywhere for calendar, splose, outlook, travel,
resources, induction, assessments, fca, letters, templates, accounting, or xero — `e2e/tests/`
contains only `portal.spec.js` and `tutorials.spec.js`. `docs/qa/BROWSER_QA_RESULTS.md` is still
dated 2026-08-01, now over three months stale against the backend work since.

**Open questions for the team** (carried from 2026-11-05, none answered yet, plus one new):
1. Should Admin be able to approve staff leave/CPD, or is owner-only correct by design? (affects
   "Do this first" #2)
2. Is the SharePoint-vs-database-storage question for onboarding documents settled, or still open?
3. Should `ENABLE_WHODAS_ASSESSMENT` be turned on anywhere right now?
4. Opal Assist still has no tracker card at all — 4th audit running asking for one.
5. **New tonight**: should "Opa Mobile Companion" stay one card covering both the backend API and
   the mobile client, given only the former can ever be verified from this repository? (see "Do
   this first" #3)

**Tracker write-back**: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node
../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json` →
`post-tracker: 13 features posted, 0 already posted tonight, brief posted`. Run before the git
push, as required.
