# Nightly tracker audit — 2026-10-03

## 1. Status line

**RAN** — 2026-10-03 18:03–18:29 UTC. Commit audited:
`aacf8e682e285fec58ba197074db20ae71e14bda` (`origin/develop`). **No commits
have landed on `develop` under `backend/` or `frontend/current/` since the
last audit (2026-10-02)** — tonight audits the exact same code as the last
three nights, as a fourth reconfirmation run, not a first run.

Counts across the 13 tracker features: **proven 2 · built-untested 0 ·
needs-refinement 5 · broken 0 · untouched 3 · tab-unproven 3.** Unchanged
from the last three nights, because the code hasn't changed.

Targeted tests run tonight: **77 unit test files / 2,864 individual tests
(2,863 passed, 1 failed) and 38 integration test files / 723 individual
tests (722 passed, 1 failed).** Today is Saturday UTC, so this was not a
weekly deep run — `npm test` / `npm run test:integration` were not run in
full, per the audit's own rules.

**The same two environment artifacts as the last three nights, neither a
code defect:**
- `onboarding-document-reader.test.js` — 1 of 15 tests failed with "Cannot
  find module `@tesseract.js-data/eng/package.json`". Confirmed again
  tonight: this sandbox's `node_modules` has no `@tesseract.js-data`
  directory at all. This audit is barred from running `npm install` to fix
  it.
- `tests/integration/readonly-and-hardening.itest.js` ("D-6/D-7: storage
  failure behaviour") — expected a 5xx when a directory is made unwritable
  via `chmod 0o000`/`0o755`, got 201. Confirmed again tonight via `whoami`
  that this sandbox runs as **root**; root bypasses Unix file permissions,
  so the fault-injection this test relies on cannot occur here. Still
  worth the team confirming whether the real CI runner is also root.

No flaky or load-sensitive failures were observed tonight — every batch,
including `fca-wizard-behaviour.test.js`, ran clean on the first pass in
its own isolated batch (this audit runs one feature's test files per
invocation, never the whole suite at once, so the parallel-load flake seen
on 2026-09-30 has no opportunity to recur here).

## 2. Do this first

Unchanged from the last three nights — re-confirmed, not re-discovered:

1. **Fix a known, still-open bug** — `GET /api/outlook/categories`
   (`backend/routes.js:1463`) still returns a 500 for a user with no
   Outlook connection instead of a 409/empty result. Confirmed again
   tonight by reading the handler and `getValidAccessToken`
   (`backend/routes.js:150`) directly: a disconnected user throws
   `Error('Outlook not connected')`, which the route's blanket `catch`
   turns into a 500 like any other failure. Affects the Calendar/Book tabs
   staff use daily. See `features/portal-splose-outlook-integration-works/`.
2. **Close the real gap in Onboarding Stage 2** — SharePoint storage for
   onboarding documents was never built; confirmed again tonight (no
   "sharepoint" reference anywhere in the repo except a CSP allowlist entry
   for `*.sharepoint.com` in `server.js`, and `backend/onboarding-policies/`
   still does not exist). Documents still live only in Postgres/on-disk.
   Stage 1 and Stage 3 are solid. See `features/portal-onboarding-workflow/`.
3. **Prove the Assessment page actually works in a browser** — FCA, WHODAS
   and the assessment catalogue have ~935 passing automated tests between
   them (938 re-run and re-confirmed passing tonight, clean on the first
   pass), but zero browser QA or E2E coverage exists for the page itself —
   still `docs/qa/BROWSER_QA_RESULTS.md`'s newest entry is dated
   2026-08-01. See `features/interactive-assessments/`.
4. **Add real test coverage for My Profile's leave and CPD workflows** —
   confirmed again tonight: the passing tests in this area are static
   markup-presence checks, not one test exercises an actual leave-request
   or CPD-approval round trip. See
   `features/employee-personal-page-my-profile-tab/`.
5. **Resolve what "Client Agreement Form" actually means** — still doesn't
   map to any distinct code; may just be the existing Service Agreement
   template. See `features/report-templates/`.

**Nothing new to correct tonight.** The two `START.md` hygiene corrections
made on 2026-10-02 (`password-master-document/` and
`update-opal-docs-register/`) still read correctly — both re-checked
tonight and remain `untouched`, not `proven`.

**Still worth a look, as the last three nights noted:** most of this
tracker's cards are stage `idea` while the underlying code is already
built and tested (Professional Development has a complete, tested tab the
tracker doesn't even have a task for). Nothing changed on this front
tonight since no commits landed.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run tonight |
|---|---|---|---|---|
| Automated Reminders | idea | untouched | Client-facing 24hr reminder unbuilt; bundled "Therapist Snapshot" separately built+tested | 0 unit / re-confirmed in integration batch (snapshot + scheduler-availability) |
| Clinical resources | idea | proven | Matches the guarded, tested Resource Hub R2; browser QA (2026-08-01) confirms the tab renders | 382 unit (12 skipped) / re-confirmed in integration batch |
| Employee Personal Page (My Profile Tab) | idea | needs-refinement | Built+guarded, but leave/CPD workflows have zero functional test coverage (only static markup checks) | guard/markup unit tests pass / integration batch passes except the 1 root-bypass artifact |
| Inductions | idea | proven | Playground + Portal Inductions + Splose Inductions all built, guarded, tested | unit + integration re-confirmed passing |
| Interactive Assessments | idea | tab-unproven | Extensive passing tests; no browser/E2E proof the page renders; "Assessment Review" task has no code | 938 unit (assessments/FCA/WHODAS batch, clean first pass) / integration batch passes |
| Opa Mobile Companion | idea | needs-refinement | API built, guarded, self-scoped (verified); pilot's own human sign-off checklist still fully open | 105 unit / integration batch passes |
| Password Master Document | idea | untouched | Describes an external OneDrive document, not a portal feature | none apply |
| Portal Onboarding Workflow | idea | needs-refinement | Stage 1 + Stage 3 built and tested; Stage 2 SharePoint storage confirmed still absent | 598 unit (1 env-caused failure) / integration batch passes |
| Portal - Splose - Outlook \| Integration Works | idea | needs-refinement | Built, guarded, tested; outlook/categories 500 bug confirmed still open (code read directly tonight) | 110 unit / integration batch passes |
| Professional Development | idea | tab-unproven | Full PD/CPD tab built and tested under Resource Hub; tracker has no task for it at all; no browser QA | 46 unit pass |
| Report Templates | idea | tab-unproven | FCA + Progress Letter built and heavily tested; "Client Agreement Form" doesn't map to distinct code; no browser QA for any of the three | 436 unit (shared batches with Interactive Assessments) / integration batch passes |
| Update Opal Docs Register | idea | untouched | Excel/SharePoint organising task, no code applies | none apply |
| Xero Integration Works | idea | needs-refinement | Financial Dashboard + Payroll Automation both built, guarded, well-tested; neither confirmed against a real connected Xero account | 70 unit / integration batch passes |

## 4. Prompts for the morning

1. **Fix the Outlook-categories bug** (`/opal-fast-change`)
> Open `backend/routes.js` around line 1463 (`GET /api/outlook/categories`)
> and make it return a 409 or an empty list instead of a 500 when the
> calling user has no Outlook connection — the current `catch` block
> returns 500 for every error, including "not connected" (thrown by
> `getValidAccessToken` at `backend/routes.js:150`). Follow the "no
> connection" guard pattern used by neighbouring Outlook routes. Add a test
> asserting the new behaviour. Run `npx jest tests/outlook-mirror.test.js`
> plus your new test before committing.

2. **Close the Stage 2 SharePoint gap** (`/opal-critical`)
> Full brief in `docs/qa/nightly/features/portal-onboarding-workflow/START.md`.
> Add SharePoint storage for Stage 2 onboarding documents in
> `backend/onboarding-pack-db.js` / `backend/onboarding-library-routes.js`,
> following the Graph-auth pattern already used in `backend/outlook-oauth.js`.
> Confirm the fixed-vs-dynamic contract field question with the practice
> owner first — `backend/onboarding-contract-docx.js` may already answer it.

3. **Prove the Assessment page in a browser** (`/opal-fast-change`)
> Full brief in `docs/qa/nightly/features/interactive-assessments/START.md`.
> Add an E2E spec (`e2e/tests/assessment.spec.js`, following
> `e2e/tests/portal.spec.js`) that completes one WHODAS 2.0 flow end to end
> and add a row to `docs/qa/BROWSER_QA_RESULTS.md`. E2E only runs under
> `/opal-release` — write the spec, don't run the full E2E suite yourself.

4. **Add My Profile leave/CPD test coverage** (`/opal-feature`)
> Full brief in
> `docs/qa/nightly/features/employee-personal-page-my-profile-tab/START.md`.
> Add `backend/tests/profile-routes.test.js` covering a leave-request round
> trip (submit → owner approves → employee sees updated status) and a CPD
> activity submission requiring owner approval, following
> `backend/tests/credential-surface-guards.test.js`'s pattern.

5. **Clarify "Client Agreement Form"** (`/opal-fast-change`)
> Full brief in `docs/qa/nightly/features/report-templates/START.md`. Before
> any code change, confirm with the tracker card's author whether "Client
> Agreement Form" means the existing Service Agreement template
> (`backend/templates/catalogue.js`, `id: 'service_agreement'`) or something
> new, then record the answer in the tracker's idea/why fields.

## 5. Ideas without a start

All 13 feature folders already existed from the last three nights; none
needed re-creating tonight, and no `START.md` changed status tonight —
every evidence label this run is identical to 2026-10-02's, so every
`START.md` from the last audit still describes the correct next step.

## 6. What changed since last audit

**Nothing.** Zero commits landed on `develop` under `backend/` or
`frontend/current/` between the 2026-10-02 audit and tonight — the most
recent commit on the branch is still `aacf8e6` (2026-09-27, "feat(maps):
address suggestions use Place Autocomplete, limited to WA"), which all
three previous audits already covered. Confirmed with a fresh `git fetch
origin develop` immediately before writing this brief.

The only difference between tonight's brief and the last three nights is
a fourth, independent re-confirmation that every test result, bug, and gap
reported since 2026-09-30 still holds.

## 7. Technical detail

### Commands run

Setup: `service postgresql status` → down; `service postgresql start`
brought it online. `ls backend/node_modules/.bin/jest` → present (no `npm
install` needed or run). `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL"
node ../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json` → 13
features, 19 tasks fetched successfully.

Last-audit lookup: `git fetch origin claude/nightly-audit` and read
`docs/qa/nightly/2026-10-02.md` plus all 13 `features/*/STATUS.md` from
that branch, since `develop` itself carries no `docs/qa/nightly/` history
(the briefs live only on `claude/nightly-audit`).

Locate + guard-check: re-verified by direct reading rather than
re-deriving from scratch, since zero commits changed the code four nights
running — specifically re-read `backend/routes.js:150` and `:1463`
(Outlook categories bug), grepped the whole repo for `sharepoint` (only
the CSP allowlist hit), confirmed `backend/onboarding-policies/` still
does not exist, and confirmed `routes-outlook-integration.js` is still not
required/mounted anywhere in `server.js`.

Unit tests (from `backend/`, 7 batches, each a single `npx jest
tests/<files>.test.js` naming every file for that batch's features): 77
files, 2,864 individual tests, 2,863 passed / 1 failed
(`onboarding-document-reader.test.js`, the tesseract-data environment gap
below).

Integration tests (from `backend/`, 8 batches, `DB_NAME=therapy_scheduler_audit
DB_PASSWORD=audit npx jest --config jest.integration.config.js
tests/integration/<files>.itest.js --runInBand`, run sequentially against
one shared database): 38 files, 723 individual tests, 722 passed / 1
failed (`readonly-and-hardening.itest.js` D-6/D-7, the root-bypass
environment artifact below).

### Could not locate / open questions

- **Client-facing 24hr appointment reminders**: no code anywhere,
  confirmed again tonight.
- **"Client Agreement Form"**: no distinct match; still unconfirmed
  whether it means the existing Service Agreement template.
- **SharePoint storage** (Onboarding Stage 2): still absent; only a CSP
  allowlist entry for Office task-pane framing/`*.sharepoint.com` exists,
  unrelated to storage.
- **`backend/routes-outlook-integration.js`**: still not required/mounted
  anywhere in `server.js` (confirmed again tonight with a direct grep) —
  looks like dead/legacy duplicate Outlook integration code. Worth
  confirming with the team and deleting if unused.
- **"Clinical resources" and "Professional Development" tracker cards**
  still have no idea/why text — evidence matched against the closest
  plausible subsystem, an assumption, not a confirmed scope.
- **Environment gap**: `@tesseract.js-data/eng` is still missing from this
  sandbox's `node_modules` — confirmed again tonight (`ls
  node_modules/@tesseract.js-data` → no such directory).
  `onboarding-document-reader.test.js` cannot give a full signal until
  it's installed (this audit cannot run `npm install` itself).
- **Environment gap**: this sandbox still runs as `root` (confirmed via
  `whoami` tonight), which breaks `readonly-and-hardening.itest.js`'s
  D-6/D-7 fault-injection test. This is now four nights running — worth
  checking whether the real CI/test environment also runs as root; if so,
  this safety net may never fire there either.

### Write-back

`NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node
../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json` →
`post-tracker: 13 features posted, 0 already posted tonight, brief posted`.
All 13 features' `claude_update`/`next_action` were updated and a starter
prompt was appended to each non-proven feature's Claude thread (11 of 13 —
Clinical resources and Inductions are `proven`, so `start_prompt` was sent
as `null` for those two, per the write-back contract).
