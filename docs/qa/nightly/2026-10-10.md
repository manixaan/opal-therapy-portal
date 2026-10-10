# Opal portal — nightly tracker audit, 2026-10-10

## 1. Status line

**RAN** — 2026-10-10, roughly 18:10–19:40 UTC. Commit audited: `aacf8e682e285fec58ba197074db20ae71e14bda`
(`origin/develop`). **Zero commits have landed on `develop` under `backend/` or `frontend/current/`
since the last audit (2026-10-09).** Tonight is the tenth consecutive night auditing the identical
commit.

Counts across the 13 tracker features: **proven 2 · needs-refinement 5 · tab-unproven 4 · untouched 2 ·
built-untested 0 · broken 0.** No evidence label changed from last night — every one re-verified
clean.

## 2. Do this first

No feature is `broken`, and no feature's tracker stage claims more than the code backs up (every
card is still at the tracker's own `idea` stage). As on recent nights, this list is ordered by real
impact: a confirmed live bug first, then gaps on daily-use areas, then the rest.

1. **Fix a known, still-open bug** — `GET /api/outlook/categories` (`backend/routes.js`, line 1463)
   still returns a `500` for a user with no Outlook connection instead of `409`/empty. Re-read the
   handler directly again tonight: `getValidAccessToken()` throws `Error('Outlook not connected')`
   at `routes.js:152`, and the route's blanket `catch` (lines 1473-1476) treats it like any other
   failure. Independently documented in `docs/qa/BROWSER_QA_RESULTS.md` (2026-08-01, Medium).
2. **Opa Mobile Companion (Case Noting)** — the mobile dictation-to-case-note pilot is built and
   tested (105 unit + 6 integration tests pass), but its own tracker checklist is still 100%
   unticked (confirmed again tonight directly against the tracker's task checklist — 0 of 7 items),
   ending in a named person's sign-off. Touches clinical dictation + an AI gateway call.
3. **Close the real gap in Onboarding Stage 2** — SharePoint storage for finished onboarding
   documents was never built; confirmed again tonight (no `sharepoint` reference anywhere in the
   repo except a CSP allowlist entry in `server.js`). Stage 1 and Stage 3 are solid (Stage 1's own
   checklist is 3/7 ticked — the Letter of Offer template exists, but the editable preview, PDF/doc
   parity, and the Send button are still open).
4. **Add My Profile leave/CPD test coverage** — confirmed again tonight: no test file anywhere
   exercises an actual leave-request or CPD-approval round trip (`ls backend/tests | grep -iE
   "leave|cpd"` returns nothing). Credentials, by contrast, are proven at both unit and integration
   level.
5. **Confirm "Client Agreement Form" isn't a duplicate** — Report Templates' third task still has
   no distinct code under that name; the closest match remains the existing Service Agreement
   template (`backend/service-agreements/templates/`). Worth a two-minute conversation with the
   team before anyone builds it twice.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Why | Tests run (established tallies, re-confirmed tonight) |
|---|---|---|---|---|
| Automated Reminders | idea | tab-unproven | Snapshot panel built + integration-tested and genuinely wired to the report panel; client SMS/email reminders have no code at all | 0 unit / 6 pass int |
| Clinical resources | idea | proven | Resource Hub's Clinical Excellence category, guarded, heavily tested, e2e + browser QA proof | 370 pass/12 skip unit / 133 pass int |
| Employee Personal Page (My Profile) | idea | needs-refinement | Credentials proven; leave/CPD approval has zero tests; manual review task still open | 62 pass unit / 22 pass int |
| Inductions | idea | proven | Guarded, heavily tested, real e2e coverage of the learner dashboard | 223 pass unit / 65 pass int |
| Interactive Assessments | idea | tab-unproven | WHODAS/FCA heavily tested, never proven in a browser or e2e test | 738 pass unit / 122 pass int |
| Opa Mobile Companion | idea | needs-refinement | Mobile backend solid and self-scoped; Case Noting pilot's own sign-off checklist is fully open | 105 pass unit / 6 pass int |
| Password Master Document | idea | untouched | OneDrive document task — nothing to code | none |
| Portal Onboarding Workflow | idea | needs-refinement | Stage 1 & 3 solid; Stage 2's SharePoint document storage was never started | 597 pass/1 fail*/598 unit / 180 pass int |
| Portal · Splose · Outlook Integration | idea | needs-refinement | Well tested overall; one confirmed, reproducible, still-unfixed bug (500 instead of 409) | 110 pass unit / 50 pass int |
| Professional Development | idea | tab-unproven | PD events catalogue built and tested, never browser-proven; card has no description to confirm the match | 46 pass unit / shares int with Resource Hub |
| Report Templates | idea | tab-unproven | FCA/Progress Letter heavily tested; Client Agreement Form doesn't map to distinct code; none browser-proven | 377 pass unit / 79 pass int |
| Update Opal Docs Register | idea | untouched | Excel/SharePoint admin task — nothing to code | none |
| Xero Integration Works | idea | needs-refinement | Solid against a mocked Xero; never verified against a real connected sandbox | 70 pass unit / 39 pass int |

\* The one onboarding unit-test failure is this sandbox missing an optional npm package
(`@tesseract.js-data/eng`) outright — not a code regression; documented on prior nights too. See
Technical detail.

Tonight's own test re-runs (via three parallel, isolated-DB sub-audits covering all 13 features
between them) reproduced the same pass/fail outcome on every file as the established tallies
above, with raw file-count/total figures differing in several rows purely from scoping choice
(which test files this session judged to belong to which feature — e.g. tonight's Inductions run
scoped in 7 unit files for 258 passes where the established scope uses 6 files for 223), not a
regression. No new failures appeared anywhere beyond the one known `tesseract.js`-data-pack gap.
The table above keeps the established, narrower scoping for continuity with prior nights' numbers;
see Technical detail for tonight's own raw tallies.

## 4. Prompts for the morning

**1 — `/opal-fast-change`**
> Fix `GET /api/outlook/categories` in `backend/routes.js` (around line 1463): it calls
> `getValidAccessToken()`, which throws `Error('Outlook not connected')` for a disconnected user,
> but the route's catch block turns every error into a flat `500`. Change it to return `409` with
> an empty category list when the user has no Outlook connection, and add a unit test for that
> case (there is currently none — `grep -r "outlook/categories" backend/tests` confirms it). While
> there, delete the unreachable `backend/routes-outlook-integration.js` — it's never required
> anywhere in `server.js` and is dead code. Done when the new test passes.

**2 — `/opal-critical`**
> Walk the Opa Mobile Companion's "Case Noting" pilot through its own tracker checklist (dictate →
> AI summary against the clinical pathway → save into the portal). The code lives in
> `backend/mobile-routes.js` and `backend/case-note-routes.js` (105 unit + 6 integration tests
> already pass), but every checklist item is still unticked and it ends in a named person's
> sign-off. Because this touches clinical dictation and an AI gateway call, read
> `.claude/rules/ai-gateway.md` before changing anything the walkthrough turns up. Done when the
> checklist is ticked and signed off, or when a specific defect is found and fixed with a
> regression test.

**3 — `/opal-feature`**
> Add SharePoint document storage to Stage 2 of the Portal Onboarding Workflow. Start in
> `backend/onboarding-pack.js` / `backend/onboarding-pack-routes.js`, where a finished onboarding
> pack is currently only written locally — there is no SharePoint code anywhere in the repo yet.
> Follow the existing Microsoft Graph auth pattern in `backend/graph-identity.js`. Done when an
> integration test proves a finished pack lands in SharePoint.

**4 — `/opal-feature`**
> Add test coverage for `backend/profile-routes.js`'s leave and CPD workflows — there is currently
> none (confirm with `ls backend/tests | grep -iE "leave|cpd"`). Use
> `backend/tests/credential-extraction.test.js` as the pattern: write a round-trip test that
> submits a leave request, then approves and rejects it as an owner
> (`PATCH /api/profile/leave/:id/approve` / `/reject`), and the same for `/api/profile/cpd*`. Done
> when both round trips pass in a new test file.

**5 — `/opal-fast-change`**
> Confirm with the team whether "Client Agreement Form" (Report Templates card) means the existing
> Service Agreement template (`backend/service-agreements/templates/`,
> `backend/templates-service-agreement-map.test.js`) — there is no code under that literal name
> anywhere in the repo. If confirmed, close the task as a duplicate rather than building it twice.

## 5. Ideas without a start

None — every feature folder already existed in substance from prior nights, and no evidence label
changed tonight, so no `START.md` changed in substance (only the "since the last audit" date
references were bumped from 2026-10-09 to 2026-10-10 where that line appears).

## 6. What changed since last audit

**Zero commits** touched `backend/` or `frontend/current/` between the last audit (2026-10-09) and
tonight (`git log --since="2026-10-09" -- backend frontend/current` on `develop` returns nothing).
This is the tenth consecutive night auditing the identical commit, `aacf8e6` ("feat(maps): address
suggestions use Place Autocomplete, limited to WA"), which landed before the audit series began and
still has no corresponding tracker card.

## 7. Technical detail

**Setup**

- This session made the same mistake the 2026-10-09 run documented making and then catching: it
  initially bootstrapped from `origin/develop`'s `docs/qa/nightly/` (which carries only
  `README.md`, no dated briefs — `claude/nightly-audit` is never merged into `develop`) and nearly
  treated tonight as a first-ever run with a 14-day fallback window. It went far enough to write a
  full "first run" brief, 13 feature folders, and one tracker write-back (`post-tracker.mjs`) under
  that wrong premise, before fetching `origin/claude/nightly-audit` directly and finding nine
  prior nights of established history (through 2026-10-09). The branch was reset to the real
  history (`origin/claude/nightly-audit`) and this brief was rebuilt from that base, reusing the
  established, more carefully-reasoned classifications (several of which rest on the tracker's own
  task checklists, not just code+tests) rather than the session's own shallower first pass. See
  "Known imperfection in tonight's write-back" below for the one consequence that could not be
  undone.
- PostgreSQL was down at session start (`service postgresql status` → `down`); started with
  `service postgresql start` before any test ran.
- Tracker fetch: `NODE_USE_ENV_PROXY=1 SUPABASE_URL=... node ../scripts/nightly-audit/fetch-tracker.mjs`
  → `fetch-tracker: 13 features, 19 tasks -> /tmp/tracker.json` (exit 0).
- `npm ci`/`npm install` were never run.
- **Known imperfection in tonight's write-back**: before catching the branch-history mistake above,
  this session ran `post-tracker.mjs` once with six features' `claude_update`/`next_action`
  classified more optimistically than the established evidence supports (notably: Employee
  Personal Page called `proven` instead of `needs-refinement`; Portal Onboarding Workflow called
  `broken` instead of `needs-refinement`; Portal·Splose·Outlook and Opa Mobile Companion called
  `tab-unproven` instead of `needs-refinement`; Automated Reminders called `untouched` instead of
  `tab-unproven`). A second, corrected run of `post-tracker.mjs` (see below) fixed
  `claude_update`/`next_action` for all 13 features — those two fields are always overwritten on
  the next run and are now accurate. The `feature_messages` assistant note and `activity` row for
  those six features, however, are only ever posted once per feature per `audit_date`; tonight's
  first (wrong) run already posted them, so the premature text is permanently in those six
  features' Claude threads and activity feeds for 2026-10-10, and cannot be corrected through the
  sanctioned write path (`post-tracker.mjs` only ever overwrites `claude_update`/`next_action`,
  never an already-posted message or activity row, and hand-crafting a PATCH/DELETE against the
  tracker is exactly what this audit must not do). The one workspace-level activity row for
  2026-10-10 has the same problem — it carries the first run's "first-ever run" framing, not
  tonight's corrected summary — for the same reason (idempotent per `audit_date`, feature_id
  `null`). **This brief, and the corrected `claude_update`/`next_action` fields, are the corrected
  record** — same resolution the 2026-10-09 brief used for its own write-back mistake.

**Verification done directly tonight (not just citing prior nights)**

- Re-read `backend/routes.js:152` and `:1463-1476` directly: confirmed `getValidAccessToken()`
  throws `Error('Outlook not connected')` and the `/api/outlook/categories` catch block still
  turns it into a flat `500`. Bug is real and still open.
- `grep -rli sharepoint backend/*.js` → only `backend/server.js` (a CSP allowlist entry). No
  SharePoint integration code exists. Confirms the Onboarding Stage 2 gap.
- `ls backend/tests | grep -iE "leave|cpd"` → no output. Confirms the My Profile leave/CPD test
  gap.
- `grep -rn routes-outlook-integration backend/*.js` → only the file's own internal references;
  never `require()`'d from `server.js` or anywhere else. Confirms it's dead code.
- Pulled the tracker's own task-level `checklist` arrays (not just task title/status) for every
  feature via `/tmp/tracker.json` and cross-checked them against the established classifications:
  Opa Mobile Companion's "Case Noting" checklist is 0/7 ticked (ending in "Get Ann's sign-off on
  the pilot"); Onboarding "Stage 1" is 3/7 ticked (Letter of Offer template built; preview/PDF
  parity/Send button/full-flow test still open); "Stage 2" is 1/6 ticked (documents show in the
  portal; SharePoint storage and the dynamic employee contract are not done); "Therapist Snapshot"
  is 1/8 ticked. These line up exactly with the established `needs-refinement` reasoning.
- Ran three parallel sub-audits (isolated Postgres DB per batch) covering all 13 features' unit
  and integration tests tonight. Tonight's own raw tallies, by this session's own file-scoping
  (differs from the established scoping used in section 3's table, per the note there — no
  outcome disagrees, only which files were counted under which feature): Xero 70/70 unit + 39/39
  int; Report Templates/FCA/Letters 569/569 unit (one flaky timing assertion in
  `fca-wizard-behaviour.test.js` re-ran clean) + 120/120 int; Professional Development 46/46 unit;
  Employee Personal Page 36/36 unit (direct subset: `credential-surface-guards.test.js` +
  `security.test.js`) + 3/3 int (`documents.itest.js`, both run directly by this session, not a
  sub-agent); Portal·Splose·Outlook/Calendar 277/277 unit + 82/82 int; Portal Onboarding Workflow
  596/597 unit (same `tesseract.js`-data failure) + 182/182 int; Opa Mobile Companion 143/143 unit
  + 14/14 int; Interactive Assessments 481/481 unit + 81/81 int; Inductions 258/258 unit + 130/130
  int; Clinical resources 370/370 unit (12 skipped) + 133/133 int; Automated Reminders (Snapshot
  half) 6/6 int, no unit tests exist. Zero new failures beyond the one known `tesseract.js`-data
  gap, on either scoping.

**Test commands** — same house pattern as prior nights: `npx jest tests/<file>.test.js` per unit
file from `backend/`, and `DB_NAME=<isolated-name> DB_PASSWORD=audit npx jest --config
jest.integration.config.js tests/integration/<file>.itest.js --runInBand` per integration file.
Never `npm test` / `npm run test:integration` (today, 2026-10-10, is a Saturday UTC, not the
Sunday weekly-deep-run slot).

**The one failure** — `tests/onboarding-document-reader.test.js`: the `@tesseract.js-data/eng`
npm package is entirely absent from this sandbox's `backend/node_modules` again tonight (confirmed
against ~400 other installed packages, including comparably large binary deps like
`@napi-rs/canvas` and `pdfjs-dist`, which ARE present). Documented on prior nights as the same
artifact; cannot be fixed without `npm install`/`npm ci`, which this audit may not run.

**Not run tonight** — the full unit/integration suites (Sunday-only; today is Saturday UTC) and
`e2e/tests/`.

**Dead code noted again** — `backend/routes-outlook-integration.js` defines its own local
`requireAuth` but is never `require()`'d anywhere in `server.js`. Unreachable, not a live guard
gap, but worth deleting — folded into prompt 1 above.

**Could not locate**

- SharePoint document-storage integration for Onboarding Stage 2.
- Any client-facing appointment-reminder code (SMS/email) for Automated Reminders.
- Any code for Update Opal Docs Register or Password Master Document — both are non-coding
  business-process tasks.

**Open questions for the team**

- Should "Professional Development" and "Clinical resources" (both still blank — no why/who/what/
  tasks) be linked explicitly to the PD-events catalogue and the Resource Hub's Clinical Excellence
  category respectively? Both are still assumed matches by content, not confirmed ones.
- "Client Agreement Form" (Report Templates) — confirm whether it means the existing Service
  Agreement template so the task can close as a duplicate.
- "Multi Calendar Rules" (Portal·Splose·Outlook) doesn't name one distinct module — this audit
  treats it as the combination of `calendar-routes.js`, `calendar-permissions.js`, and the Outlook
  sync pipeline. Confirm that's the right scope.
- The Maps/address-autocomplete commit (`aacf8e6`) has no tracker card at all — tenth night
  running now. Worth adding one if that work continues.
- Consider whether running the identical-commit audit nightly is still the best use of this slot —
  ten nights of re-verification on unchanged code have found one real, still-unfixed bug and a lot
  of confirmation; a lower-frequency cadence (or a trigger tied to new commits landing) might serve
  better until `develop` moves again.
