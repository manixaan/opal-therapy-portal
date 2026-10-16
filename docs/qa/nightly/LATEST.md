# Nightly tracker audit — 2026-10-16

## 1. Status line

**RAN** · 2026-10-16 18:08–18:30 UTC · commit audited: `aacf8e6`
(`feat(maps): address suggestions use Place Autocomplete, limited to WA`,
2026-09-27) · first run, so no prior brief and no "addressed this window"
commits exist yet.

**Counts across 13 tracker features:** proven 1 · tab-unproven 3 ·
needs-refinement 6 · broken 1 · untouched 2 · built-untested 0.

## 2. Do this first

1. **Fix the Outlook categories 500** (*Portal - Splose - Outlook |
   Integration Works* — `broken`). `GET /api/outlook/categories` returns a
   generic 500 instead of a clean "not connected" response when a user
   has no Outlook link — confirmed from the code and matching a defect
   already seen live in `docs/qa/BROWSER_QA_RESULTS.md`. Zero tests cover
   it. Small, isolated fix.
2. **My Profile's leave and CPD approvals have zero tests**
   (*Employee Personal Page* — `needs-refinement`). This is employment
   data with no automated coverage of the submit → approve/reject round
   trip at all, while the neighbouring credentials/documents code is well
   tested. Worth closing before it's trusted as "done".
3. **Clarify which CPD system the "Professional Development" card means**
   (*Professional Development* — `needs-refinement`). Two separate CPD
   systems exist (My Profile's and the Resource Hub's); the card doesn't
   say which, and only one of the two is tested.
4. **Decide if client appointment reminders are still wanted**
   (*Automated Reminders* — part `needs-refinement`, part `untouched`).
   The Therapist Snapshot half is built and tested (missing only the
   utilisation-index metric Anthony asked for); the client-facing 24-hour
   reminder has not been started at all.
5. **SharePoint storage for onboarding documents was never built, and the
   Stage 1/2 tracker checklists are stale** (*Portal Onboarding Workflow*
   — `needs-refinement`). The checklists mark several already-built
   items (editable preview, identical PDF/doc rendering, the dynamic
   employee contract) as not done, which could mislead planning; the one
   real gap is SharePoint storage itself.

No item met the "tracker claims more than the evidence shows" bar for a
disagreement tonight — every tracker stage in this snapshot is still
`idea`, which structurally can't overclaim. Two features actually
*underclaim* relative to the evidence (Portal Onboarding Workflow's
checklists, and Opa Mobile Companion's "Calendar View hasn't started" —
see section 3), which is the opposite direction but still worth a
person's attention.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Xero Integration Works | idea | tab-unproven | Accounting/payroll code solid and tested; Finance dashboard never opened in a browser, never run against a real Xero | 109 pass |
| Update Opal Docs Register | idea | untouched | Administrative Excel/SharePoint task, no code exists or should | none |
| Report Templates | idea | tab-unproven | FCA, Progress Letter, Client Agreement Form all built and tested; none proven in a browser | 689 pass |
| Professional Development | idea | needs-refinement | Two separate CPD systems; Resource Hub's is tested, My Profile's has zero tests; tracker doesn't say which it means | 79 pass |
| Portal - Splose - Outlook \| Integration Works | idea | broken | One confirmed bug: `/api/outlook/categories` 500s instead of a clean not-connected response; everything else proven | 549 pass |
| Portal Onboarding Workflow | idea | needs-refinement | Stage 1/2 built further than tracker checklists show; SharePoint document storage genuinely missing | 799 pass / 1 fail (env) |
| Password Master Document | idea | untouched | OneDrive document to create directly, no code exists or should | none |
| Opa Mobile Companion | idea | needs-refinement | Case Noting backend solid, AI-governed, awaiting Ann's device sign-off; Calendar View backend already exists (tracker says it doesn't) | 166 pass |
| Interactive Assessments | idea | tab-unproven | WHODAS engine thoroughly tested; nothing proves the assessment page opens in a browser | 562 pass |
| Inductions | idea | needs-refinement | Everyday induction/learning system proven end-to-end via Playwright; AI co-author tool built+tested but unproven in a browser | 386 pass |
| Employee Personal Page (My Profile Tab) | idea | needs-refinement | Credentials/documents proven incl. hardening edge cases; leave and CPD approvals have zero tests | 96 pass / 1 fail (env) |
| Clinical resources | idea | proven | Guarded and heavily tested incl. the clinical approval workflow; only a dedicated browser walkthrough of that workflow is missing | 508 pass / 12 skipped |
| Automated Reminders | idea | needs-refinement | Therapist Snapshot built and tested, missing the utilisation-index metric; client appointment reminders not started | 6 pass |

## 4. Prompts for the morning

**1 — `/opal-fast-change`** (Portal - Splose - Outlook | Integration Works)
> Fix `GET /api/outlook/categories` in `backend/routes.js` (around line
> 1463): when the user has no Outlook connection, `getValidAccessToken`
> throws and the handler's catch block returns a generic 500. Return a
> clean "not connected" response instead (e.g. `200 {"data": []}` or a
> `409`), matching the pattern other Outlook-aware routes already use.
> Add a regression test. Done when a new test proves the not-connected
> case no longer 500s.

**2 — `/opal-critical`** (Employee Personal Page)
> Add an integration test in `backend/tests/integration/` exercising
> `/api/profile/leave`: a therapist submits a leave request, the owner
> approves/rejects it, and an unrelated user is blocked. Do the same for
> `/api/profile/cpd`'s submit → approve/reject round trip, following the
> pattern in `readonly-and-hardening.itest.js` for `/api/profile/credentials`.
> Done when both round trips have passing tests.

**3 — `/opal-critical`** (Professional Development)
> Clarify with Anthony in the tracker which CPD system the "Professional
> Development" card means — My Profile's `/api/profile/cpd`
> (`backend/profile-routes.js`), the Resource Hub's `/api/rh2/cpd`
> (`backend/resource-hub-r2-routes.js`), or both. Once known, if it's My
> Profile's, add an integration test for its submit → approve/reject
> round trip following `resource-hub-r2.itest.js`'s pattern for the
> Resource Hub's CPD tracker.

**4 — `/opal-feature`** (Automated Reminders)
> Review `backend/snapshot-routes.js` (the Therapist Snapshot) and agree
> the utilisation-index formula with Anthony (likely weekly hours booked
> vs. available); add it alongside the existing daily-sessions data and
> extend `tests/integration/snapshot.itest.js` to cover it. Separately,
> confirm with Anthony whether the 24-hour client appointment reminder is
> still wanted and, if so, what channel (SMS/email) and what to reuse
> from `backend/calendar-routes.js`.

**5 — `/opal-critical`** (Portal Onboarding Workflow)
> Update the tracker's Stage 1/Stage 2 checklists — several items marked
> undone (editable preview, identical PDF/doc rendering, the dynamic
> employee contract) are already built and passing their tests in
> `backend/tests/onboarding-*.test.js`. Then build SharePoint storage for
> Stage 2's finished onboarding documents: see how `backend/onboarding-pack.js`
> already publishes documents and add an upload step, following the
> Microsoft Graph pattern in `backend/outlook-oauth.js`.

## 5. Ideas without a start

Every feature's folder was created tonight (first run, so none existed
before). None reached `proven` tonight except Clinical resources, whose
`START.md` was replaced with the two-line "proven" note per the rules
instead of a starter prompt.

## 6. What changed since last audit

**No commits** touched `backend/` or `frontend/current/` in the audit
window (2026-10-02 to 2026-10-16 — the first-run 14-day default, since no
prior brief exists). The repository's most recent commit on `develop` is
`aacf8e6` (2026-09-27, `feat(maps): address suggestions use Place
Autocomplete, limited to WA`). No subsystem changed, so there is nothing
to group by subsystem and no "subsystem changed but has no tracker
feature" case to report tonight.

## 7. Technical detail

**Setup.** `backend/node_modules` was pre-installed; PostgreSQL was found
stopped (`service postgresql status` → down) and was started with
`service postgresql start` before any integration run. Tracker snapshot
pulled with `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node
../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json` → 13
features, 19 tasks.

**Commands run** (all from `backend/`, `DB_PASSWORD=audit`,
`DB_NAME=therapy_scheduler_audit` for every integration run):
- `npx jest tests/<file>.test.js` — run in topic batches per feature;
  ~3,080 unit tests total across all batches, all passing except the one
  environment-caused failure below.
- `npx jest --config jest.integration.config.js tests/integration/<file>.itest.js --runInBand`
  — run in four batches; ~846 integration tests total, all passing
  except the one environment-caused failure below.
- No complete suite was run (`npm test` / `npm run test:integration` /
  `npm run test:all` / E2E) — tonight is not Sunday UTC (it's Friday), so
  the weekly deep run does not apply.

**Two test failures, both environment artifacts, not code regressions:**
1. `backend/tests/onboarding-document-reader.test.js` → "the OCR language
   data is shipped with the portal, not fetched when a document arrives"
   fails with `Cannot find module '@tesseract.js-data/eng/package.json'`.
   `package.json` declares this as a dependency but it is physically
   missing from `backend/node_modules` in this sandbox. Per this audit's
   hard limits, `npm install` was not run to fix it — flagging it here
   for whoever maintains the environment's setup script.
2. `backend/tests/integration/readonly-and-hardening.itest.js` → the D-7
   half of "storage failure behaviour" expects a write to a `chmod
   0o000` directory to fail with ≥500, but gets 201. This sandbox's test
   process runs as `root` (confirmed via `ps aux`), and root bypasses
   Linux directory permission bits, so the simulated failure never
   happens. The D-6 half of the same test (missing object → 404) passed.

**Could not locate:** a client-facing appointment-reminder feature (none
exists), SharePoint integration code (none exists beyond a CSP allowlist
entry), and any mobile-app frontend for Opa Mobile Companion (it lives
outside this repository).

**Open questions for the team:**
- Should the environment's setup script install `@tesseract.js-data/eng`
  so this test stops failing for reasons unrelated to the code?
- Is there a way to run the hardening suite as a non-root user, so D-7's
  simulated storage failure actually tests what it means to?
- Which CPD system does the "Professional Development" tracker card
  refer to?
- Is the 24-hour client appointment reminder still wanted, and if so, on
  what channel?

**Tracker write-back:** `post-tracker.mjs` was run against
`/tmp/writeback.json` (one entry per feature, built from the evidence
above) before this branch was pushed, so a GitHub failure would never
cost the tracker its update. Its output line:
`post-tracker: 13 features posted, 0 already posted tonight, brief posted`.
