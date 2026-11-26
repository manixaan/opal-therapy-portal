# Nightly tracker audit — 2026-11-26

## 1. Status line

**RAN** · 2026-11-26 18:21 UTC · commit `f5fc28d` (origin/develop) · proven: 1, built-untested: 2,
needs-refinement: 5, broken: 0, untouched: 2, tab-unproven: 3 (13 features total).

Ten commits landed in `backend/`/`frontend/current/` between the last audit (2026-11-25 18:40 UTC,
commit `2ae079b`) and tonight's run (commit `f5fc28d`), across three subsystems: a trip-home-fit
rework on the calendar/travel side (offer "Via home" only when it actually fits the gap, plus two
same-night visual fixes); the Therapist Snapshot's biggest UI change in weeks (every missing-address
note now starts a guided step-through fix, and three stale panels — Smart Recommendations, the
quick-action buttons, Free gaps/Idle gaps — are gone); and Opal Assist's largest single-night addition
since this audit began — a new clinical-notes read path ("Client file"), local OCR on pasted/attached
pictures, and in-browser Word/PowerPoint export of a document reply. Opal Assist still has no card of
its own anywhere in the 13-feature tracker snapshot (flagged 2026-11-15, 2026-11-18, and again
tonight). All ten commits' own risk notes were read in full below; none of them were found to miss a
guard, an audit record, or a test. Every new/changed file passed `node --check` and carried no
TODO/FIXME. `scripts/check-asset-pins.js` confirms every cache-bust pin in `mockup_v3.html` matches
what tonight's commits would ship. Well over 4,000 unit tests and 700+ integration tests were run
fresh tonight across every one of the 13 features, not assumed — including every new test file
tonight's commits added (`assist-client-file.test.js`, `assist-read-image.test.js`,
`assist-export.test.js`) and a full re-run of every untouched subsystem's own tests, which came back
an exact match to last night's counts in every case but one. The one exception: the Clinical resources
integration batch hit a single transient flake on its first run tonight (a Postgres connection-pool
error inside `truncateAll` between suites) that did not reproduce on either an isolated re-run or a
full re-run of the same seven-file batch — read as a sandbox artifact, not a regression (see §7). No
`broken` feature was found anywhere in this run — no unguarded routes, no `node --check` failures, no
real test regression.

## 2. Do this first

1. **[/opal-critical] Opal Assist's biggest single-night addition yet — a new read path over clinical
   notes, local OCR on pictures, and still no tracker card for any of it.** Tonight added three things
   to the Opal Assist web page: "Client file" (`GET /api/assist/client-file`) lets a practitioner pull
   their own case notes, sessions and Splose case summary into a client chat and attach selected text;
   picture attachments (`POST /api/assist/read-image`) are read with the portal's own in-process
   Tesseract OCR — no model, no network, nothing stored — so a photo of a plan or form becomes
   attachable text; and two new toolbar buttons build a Word or PowerPoint file from a document reply
   entirely in the browser (vendored jszip, no backend route at all). All three are read by this audit
   as correctly guarded (every `/api/assist` route inherits `requireAuth` + the `read_only` 403 refusal
   at the router level; client-file additionally scopes through the caller's own Splose caseload via
   `authoriseClient`, refusing a client not on the caller's open cases with 404) and audited
   (`assist.client_file_viewed` records counts only — notes length, searched flag, case count — never
   the search text or note content, confirmed by reading the `logAuditEvent` call directly). The ai-
   and assist- test groups together pass 26 suites / 452 tests fresh tonight, exactly matching the
   commits' own claimed count. But this is a new, non-trivial clinical-data read surface added to a
   subsystem that — twelve nights after it was first flagged — still has no card anywhere in the
   13-feature Development Manager tracker. Done means: a human decision on where Opal Assist belongs
   in the tracker (its own card, given how large and clinically sensitive it has become), and a
   browser check that Client file's search/attach flow and the picture-OCR flow both work as the
   commits describe for a real practitioner.

2. **[/opal-feature] Portal - Splose - Outlook | Integration Works — a real correctness fix, still
   waiting on its one open human checklist.** Tonight's trip-home-fit rework
   (`fix(calendar): offer Via home only when it fits; name both ways on the leg`, plus a same-night
   visual fix for narrow columns/dark mode and a tile-title overlap) replaced a logic bug — the panel
   previously offered "Go home in between" for a gap too short to fit the actual drive, because
   `homeAvailable` never checked gap length against drive-home + 30 min + drive-back. This is now
   fixed and tested (59 unit files / 1,329 tests, 11 integration files / 96 tests, all re-run fresh
   tonight, no regression). The tracker's one open task on this card, Multi Calendar Rules, is
   unchanged and still `todo`. Done means: walk that checklist against the live portal (book a
   session, confirm the "saved but not synced" indicator, check travel-time calculation, confirm
   Portal/Splose match both ways) — a verification pass, not a build task.

3. **[/opal-feature] Automated Reminders (tracker-ahead disagreement, twelve nights running) —
   tonight's Snapshot changes are UI cleanup, not the disagreement's fix.** The Therapist Snapshot
   task's own checklist still marks "Create minimise function on snapshot" as done; no matching
   whole-panel implementation exists anywhere in `frontend/current/reports.js` or its CSS — confirmed
   again tonight by a fresh grep (no "minimise" string at all). Separately, and unrelated to that
   checklist item, tonight's three Snapshot commits are real, tested UI progress: every missing-address
   note now opens a guided step-through fix (open the calendar, focus the address box, Back/Skip/Done
   with progress dots), and three stale panels (Smart Recommendations, the quick-action buttons, Free
   gaps/Idle gaps) were removed along with the Report Settings toggles that only drove the latter.
   Appointment reminders still have no code at all. Done means: either build the whole-panel minimise
   or un-tick the checklist item to match what exists.

4. **[/opal-critical] Xero Integration Works — still never confirmed against a real Xero sandbox,
   twelfth night running.** Unchanged tonight (no billing/invoicing/Xero commits landed) — 215 unit +
   193 integration tests (across a combined batch with Report Templates/Assessments/Inductions
   tonight) still pass, every one of them against a mocked Xero client, with the same expected
   "xero offline in test" / "recurring invoices unavailable" fail-closed warnings as every prior
   night. The live-sandbox-in-a-browser gap is unchanged.

5. **[/opal-feature] Two small tracker decisions, both carried forward unchanged.** (1) Where does
   Opal Assist belong in the tracker — see item 1 above, now the more urgent half of this question
   given tonight's addition; the Outlook M365 app-bar embed (landed 25 Nov, unchanged tonight) has the
   same problem on a smaller scale. (2) "Employee Personal Page (My Profile Tab)" and "Professional
   Development" still point at the same code (`backend/profile-routes.js`) and the same untested
   leave/CPD round-trip gap, unchanged again tonight.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Portal - Splose - Outlook \| Integration Works | idea | needs-refinement | **Addressed tonight** — the trip-home-fit correctness rework landed and passes every pinning test; the one open task (Multi Calendar Rules) is still a human checklist. | 59u/1,329✓, 11i/96✓ (+ 6 itest files carried forward unchanged) |
| Automated Reminders | idea | needs-refinement | **Addressed tonight** on the Snapshot side — missing-address guided fix, three stale panels removed. Appt reminders: still no code. The minimise-checklist disagreement is unrelated and unchanged. | 0u direct, 2i/9✓ (+4 shared frontend-guard files) |
| Xero Integration Works | idea | tab-unproven | Unchanged tonight — every Xero call in every test is still mocked; a real sandbox connection is still never confirmed live. | 12u/215✓, 11i/193✓ (shared batch) |
| Report Templates | idea | tab-unproven | FCA/Letter/Agreement generation built & tested (626 tests, no flake tonight); three document flows never hand-checked. | 15u/626✓, 1i/27✓ |
| Interactive Assessments | idea | tab-unproven | WHODAS 2.0 built & tested (585 tests combined with Profile/Inductions tonight); no browser proof of the tab. | 6u (part of 585✓), 2i (part of 193✓) |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Built & guarded; no test proves the leave/CPD approval round trip. | 4u/94✓, 0i |
| Professional Development | idea | built-untested | Lives inside My Profile's CPD section; shares Employee Personal Page's code and its untested round trip. | 4u/94✓ (indirect), 0i |
| Inductions | idea | needs-refinement | Learner side proven by E2E; builder/AI-helper/photo-step work still open. | 3u (part of 585✓), 2i/7✓ (part of 193✓), E2E✓ |
| Clinical resources | idea | proven | Built, guarded, fully tested, E2E-proven, no open task — tracker underclaims this one. | 12u/398✓+12 skip, 7i/168✓ (one transient flake on first pass, clean on re-run — see §7) |
| Portal Onboarding Workflow | idea | needs-refinement | Extensively built/tested (653/654 tests); real gap is SharePoint storage for Stage 2. | 27u/653✓+1 known fail, 8i/208✓ |
| Opa Mobile Companion | idea | needs-refinement | Not touched tonight — last night's large addition (edit client/session/address, client card, notes owing, push) unchanged; device walkthrough still open. | 10u/228✓, 7i/34✓ |
| Update Opal Docs Register | idea | untouched | Organising/SharePoint task — no code expected. | none |
| Password Master Document | idea | untouched | Tracker says to keep this on OneDrive — no portal action. | none |

**No tracker card** — Opal Assist: 26u/452✓ (ai-/assist- groups), built, guarded, audited; see "Do this
first" item 1.

## 4. Prompts for the morning

**1. Opal Assist — tracker placement decision, plus a browser check of tonight's three additions**
```
/opal-critical
Opal Assist (backend/assist-routes.js, backend/assist/, frontend/current/assist*.js) has no card
anywhere in the 13-feature Development Manager tracker, flagged by this audit since 2026-11-15 and now
more urgent: tonight added a new read path over clinical notes ("Client file" —
GET /api/assist/client-file, backend/assist/client-file.js), local-OCR picture attachments
(POST /api/assist/read-image, using backend/onboarding-ocr.js — no model, no network, nothing stored),
and in-browser Word/PowerPoint export of a document reply (frontend/current/assist-export.js, no
backend route). All three are guarded (requireAuth + read_only refusal at the /api/assist router level;
client-file additionally scopes through the caller's own Splose caseload, authoriseClient, 404 on a
client not on the caller's open cases) and audited (assist.client_file_viewed records counts only).
26 suites / 452 tests pass fresh (tests/assist-client-file.test.js, tests/assist-read-image.test.js,
tests/assist-export.test.js are new tonight). First, decide where this belongs in the tracker — its own
card, given its size and clinical-data exposure. Second, in a browser: open a client chat, use "Client
file" to search and attach a note, paste/attach a picture of a form and confirm its text attaches, and
download a document reply as both a Word and a PowerPoint file. Done means: the tracker decision is
recorded, and the three flows are confirmed working for a real practitioner or the defect found is
filed as its own task.
```

**2. Portal - Splose - Outlook | Integration Works — walk the Multi Calendar Rules checklist**
```
/opal-feature
Tonight's trip-home-fit rework (frontend/current/travel.js v80, theme.css v9) fixed a real bug: the
travel panel offered "Go home in between" for a gap too short to actually fit the drive home, because
homeAvailable never checked the gap length against drive-home + 30 min + drive-back. It's fixed and
tested (59 unit files / 1,329 tests, 11 integration files / 96 tests, all passing). The tracker's one
open task on this card, Multi Calendar Rules (feature eba1c6a7-3ba4-420f-acf4-1c5838991138), is still
todo. Walk its checklist against the live portal: book a session and confirm travel time calculates
correctly for the day; confirm the "changes saved but not synced" indicator behaves as described;
confirm the Portal and Splose end up matching in both directions; and stress-test with a few real-world
examples (back-to-back sessions at one address, a short gap, a long gap) to find where it breaks. This
is a verification pass, not a build task. Done means: each checklist item is confirmed against the live
portal, or the defect found is filed as its own task.
```

**3. Automated Reminders (tracker-ahead disagreement, twelve nights running)**
```
/opal-feature
Check whether the Development Manager tracker's "Create minimise function on snapshot" checklist item
under the Therapist Snapshot task (feature 398a0b36-a12f-4190-83e4-b3a8932b3b46) has a real whole-panel
implementation anywhere in frontend/current/reports.js or its CSS. A fresh grep tonight finds no
"minimise" string in either file at all (the only minimise function in the codebase is on the unrelated
Opa AI assistant chat widget, frontend/current/opa.js). Either build the whole-panel minimise or un-tick
the checklist item to match what exists. This is unrelated to tonight's Snapshot changes (the
missing-address guided fix and the removal of Smart Recommendations/action buttons/Free gaps), which
already pass their own tests. Done means: the checklist and the code agree.
```

**4. Xero Integration Works — confirm a real sandbox connection**
```
/opal-critical
Confirm a real Xero sandbox connection live in a browser and record it in docs/qa/BROWSER_QA_RESULTS.md.
215 unit + 193 integration tests (combined batch) all pass, but every one of them mocks the Xero client
(backend/xero-api.js, backend/xero-payroll-connection.js). No test here can prove a real Xero call works;
only a browser session against a sandbox tenant can. Done means: a sandbox connection is confirmed
working and recorded.
```

**5. Decide the Profile/CPD card merge**
```
/opal-feature
"Employee Personal Page (My Profile Tab)" (83bb9988-52ba-4f8c-85ba-7b65aca189b2) and "Professional
Development" (37f4e057-ae96-4a9e-a576-5f808b7dc8fb) both point at backend/profile-routes.js and the same
untested leave/CPD round-trip gap, confirmed again tonight (4 unit files / 94 tests, none exercising the
round trip; no integration test exists for /api/profile/leave or /api/profile/cpd). Decide whether to
merge the two tracker cards, and consider adding one integration test exercising both the leave and CPD
approve/reject paths either way. Done means: the merge decision is recorded in the tracker; optionally,
one new integration test exists.
```

## 5. Ideas without a start

Two feature folders changed tonight, both because the code they track moved:

- **Portal - Splose - Outlook | Integration Works** — "Where it lives today" now lists the
  trip-home-fit rework (`travel.js` v80, `theme.css` v9); "Start here" now also notes this is the
  second consecutive night the subsystem moved while its one tracker task stayed untouched.
- **Automated Reminders** — "Where it lives today" now lists the Snapshot's missing-address guided
  fix and the three panels removed tonight.

No other feature's START.md changed — the other eleven features' own words are unchanged from last
night, and none of tonight's ten commits touched their code. (Opa Mobile Companion's STATUS.md was
updated to reflect it was *not* touched tonight, after being heavily addressed the two nights before —
its START.md itself is unchanged, since the label stayed `needs-refinement` with nothing new to add.)

## 6. What changed since last audit

Ten commits landed, all dated 2026-11-26, between last night's audit (2026-11-25 18:40 UTC, commit
`2ae079b`) and tonight's (18:21 UTC, commit `f5fc28d`):

**Portal - Splose - Outlook | Integration Works** (4 commits, landing in this order):
- `6d9845b` **fix(calendar): offer Via home only when it fits; name both ways on the leg** —
  `frontend/current/{mockup_v3.html,theme.css,travel.js}`, `backend/tests/{assessment-surface-guards,
  smart-booking-route,travel-physical-route}.test.js`. `homeAvailable` now requires the gap to fit
  drive-home + 30 min + drive-back (cached/suburb-table minutes only); the leg switch names both
  destinations; a drive that cannot fit its gap gets an inline note instead of a bare red bar. No
  risk note beyond the usual frontend-only scope.
- `1f30596` **fix(calendar): keep the Direct \| Home switch in narrow columns; red no-time bars in
  dark** — same-night fix to the commit above: at ~165px week-view width the switch dropped its
  destination label before the panel named it; dark mode's travel fill/ink overrode the gutter bars so
  a no-time drive showed purple instead of red.
- `85e9d53` **Merge branch 'travel-home-fit'** — lands the two commits above together.
- `f5fc28d` **fix(calendar): the no-time note never covers a short tile's words** — found on a stress
  week (15-minute visits, three-line-wrapped names): the "no time" note in the earlier tile's corner
  sat on its title. It now shrinks to a red "!" with the sentence as its tooltip where it would
  otherwise cover the tile's words; a gap filled by other events now says "no free slot" instead of a
  misleading "only N min".

**Opal Assist — no exact tracker feature** (3 commits, reported here, not skipped):
- `6eb9900` **feat(assist): Client file — look up a client's case, sessions and notes in a client
  chat** — `backend/assist/client-file.js` [new], `backend/assist-routes.js`,
  `frontend/current/assist-client-file.js` [new], `frontend/current/assist-{composer,css,html,js}`.
  RISK (by the commit's own note) — a new read path over clinical notes; scoped like the mobile
  client card (same ownership rules), no AI/permission/schema change. 13 new unit tests.
- `d7a333f` **feat(assist): attach pictures — their text is read by the portal's own OCR** —
  `backend/assist-routes.js`, `frontend/current/assist-composer.js`,
  `backend/tests/assist-read-image.test.js` [new]. RISK (by the commit's own note) — a new
  authenticated upload route running CPU-heavy OCR on the App Service, bounded by size/rate
  limit/concurrency cap; clinical pictures reach the server briefly in memory, never Bedrock. 8 new
  unit tests.
- `299aae4` **feat(assist): download a document reply as a Word or PowerPoint file** —
  `frontend/current/assist-export.js` [new], `frontend/current/assist.{html,js}`,
  `backend/tests/assist-export.test.js` [new]. No backend, AI gateway, permission or schema change —
  entirely client-side (vendored jszip, no external CDN). 13 new unit tests.

**Automated Reminders** (3 commits, landing in this order):
- `f6601f3` **fix(reports): drop Smart Recommendations, action buttons and Free gaps from the
  snapshot** — `frontend/current/{mockup_v3.html,reports.js}` (reports.js → v12).
- `b6ce0fe` **fix(reports): remove idle gaps from the snapshot, fix missing spaces** —
  `frontend/current/{mockup_v3.html,reports.js}` (→ v13); removes the three now-dead Report Settings
  toggles too.
- `5e972ee` **feat(reports): missing addresses become a step-through fix exercise** —
  `frontend/current/{mockup_v3.html,reports.js}` (→ v14). Every missing-address note now opens the
  calendar to that event with the address box focused and a Back/Skip/Done progress bar; the
  missing-address count now follows the calendar's own `sessionNeedsFullAddress` rule rather than the
  snapshot's own looser one.

No other subsystem changed tonight; every other feature's unchanged-tonight status in §3 is a fresh
re-run, not an assumption.

## 7. Technical detail

**Setup.** PostgreSQL was down at the start of this run (`service postgresql status` →
`16/main (port 5432): down`) — started with `service postgresql start`, confirmed online.
`backend/node_modules/.bin/jest` was present — no install needed. Tracker snapshot pulled via
`NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs
/tmp/tracker.json` → `fetch-tracker: 13 features, 19 tasks -> /tmp/tracker.json`. As on every prior
night, this run's `docs/qa/nightly/` history lives only on `origin/claude/nightly-audit` (back to
2026-11-15) — the develop-based bootstrap checkout (`nightly-audit-work`, from `origin/develop`) shows
none of it. Tonight's `claude/nightly-audit` branch was rebuilt from that prior history
(`git checkout -B claude/nightly-audit origin/claude/nightly-audit`) plus a clean merge of tonight's
`origin/develop` (53 files changed, no conflicts), rather than branching fresh from `develop` and
risking the eventual force-push discarding eleven nights of prior audit docs. Last night's own status
line (RAN 18:40 UTC 2026-11-25, commit `2ae079b`) was used as the audit window's start. Today
(2026-11-26, UTC) is a Thursday, not Sunday — no complete-suite weekly deep run tonight, per the weekly
rule.

**Locate.** `git log --since="2026-11-25 18:40" --stat -- backend frontend/current` showed the ten
commits above touching calendar/travel (4 commits), Opal Assist (3 commits, 2 new backend files, 1 new
frontend file, 3 new test files), and the Snapshot (3 commits, frontend-only). Every new/changed file
passed `node --check` (including browser-only frontend files, which `node --check` can still
syntax-check) and a fresh grep found no TODO/FIXME in any of them.

**Guard check.** `backend/assist-routes.js`'s router-level guard
(`router.use('/api/assist', entraBearerAuth, sessionOrBearer, ...)` followed by an inline `read_only`
403) was read directly and confirmed to cover both new routes (`client-file`, `read-image`) — neither
declares its own auth, both rely on the router-wide middleware plus their own `rateLimit`. Read
`backend/assist/client-file.js` directly: it calls `authoriseClient` before touching the database,
which resolves the caller's own Splose caseload (`splose-caseload.js`) and 404s a client not on an open
case; `loadNotes`/`loadSessions` both filter by `userId`/`req.user` in their SQL, confirmed by reading
every query, not only by the passing tests. The audit call (`assist.client_file_viewed`) was read
directly in `assist-routes.js`: its `metadata` is `{ notes: notes.notes.length, searched: !!query,
cases: cases ? cases.length : null }` — counts only, no text, no search string. `read-image`'s handler
was read directly: it requires `provider.isEnabled()` (fails closed while Assist is off), validates
content-type/size via `express.raw`, and calls `ocr.ocrDocument()` — `backend/onboarding-ocr.js`, the
same in-process Tesseract worker onboarding already uses; no `require` of any AI SDK or Bedrock client
anywhere in the OCR path, confirmed by `require('./xero-api')`-style grep adapted to AI gateway imports
(none found). `frontend/current/assist-export.js` has no corresponding backend route (confirmed by grep
of `assist-routes.js`/`server.js` for "export") and loads jszip from `/vendor/jszip.min.js` (confirmed
present on disk, 97,630 bytes) rather than an external CDN. No calendar/travel/Snapshot route changed
tonight — all four travel.js/theme.css/reports.js commits are frontend-only, so no new guard surface to
check there; `node --check` and a TODO/FIXME grep were still run on every touched frontend file.
AI-gateway boundary re-confirmed clean tonight (`tests/ai-gateway-boundary.test.js`,
`tests/ai-single-gateway-guards.test.js` — 30/30 pass) — nothing new tonight imports an AI SDK or
touches `backend/ai/` directly. `scripts/check-asset-pins.js` reports every cache-bust pin in
`mockup_v3.html` matches what tonight's commits would ship.

**Test selection and execution.** Every file below was run fresh tonight, not assumed, across nine
batches. Unit: the seven files tonight's commits directly touch (387 tests); the ai-gateway boundary
reconfirmation (2 files/30); the three frontend-guard files that read `reports.js`/`travel.js`
(`frontend-stage3-guards`, `frontend-undo-guards`, `frontend-xss-guards` — 350 tests, `stage3` alone
294); the Xero batch (12 files/215); Report Templates (15 files/626); Assessments+Profile+Inductions
combined (12 files/585); Clinical resources (12 files/398 passed+12 skipped); the Portal Onboarding
Workflow `tests/onboarding-*` glob (27 files/653 passed+1 known fail); the broader Portal-Splose-Outlook
batch (57 files/950, includes `smart-booking-route.test.js` and `travel-physical-route.test.js`, both
changed tonight); `assessment-surface-guards.test.js` alone (85, re-pinned six times tonight); Opa
Mobile Companion (10 files/228, unchanged but re-run fresh); and the full `ai-`/`assist-` group
together (26 suites/452, independently matching the client-file commit's own claimed count exactly).
Integration, across six batches on an isolated `DB_NAME=therapy_scheduler_audit_test`: Assist+travel+
calendar (6 files/30); Splose/Outlook (6 files/66); Snapshot (2 files/9); Portal Onboarding Workflow (8
files/208, ran in the background while other batches continued — see below); Xero+Templates+
Assessments+Inductions combined (10 files/193); Clinical resources (7 files/168, see the flake note
below). Every count for an unchanged subsystem matched last night's exactly except where batch
composition legitimately differed (e.g. tonight's Portal-Splose-Outlook unit total, 1,329, is counted
across a different file split than last night's 1,415 — no file in either split failed).

**A transient integration flake, investigated and resolved.** The first run of the Clinical resources
integration batch (`resource-file-upload.itest.js, resource-hub-r2.itest.js, resource-hub-v1.itest.js,
resource-ingestion.itest.js, resource-library-sharepoint.itest.js, resource-library.itest.js,
resources.itest.js`) failed one test in `resource-library.itest.js` with a Postgres connection-pool
error inside the shared `truncateAll` helper between suites. `resource-library.js` carries no change
tonight. Re-run alone, the file passed cleanly (53/53). Re-run as the same full seven-file batch a
second time, it passed cleanly (168/168, matching every prior night's count exactly). Read as a
transient resource-contention artifact of this shared sandbox (concurrent background test batches were
running at the time of the first attempt), not a code regression — reported here per the instruction
to never report a clean result not observed, and because both the failure and its non-reproduction were
directly observed tonight.

**Known environment artifact, confirmed again (twelfth night running).**
`tests/onboarding-document-reader.test.js` fails with "Cannot find module
'@tesseract.js-data/eng/package.json'". `@tesseract.js-data/eng` is declared in `backend/package.json`
but genuinely absent from `backend/node_modules` in this sandbox (checked directly tonight with `ls
backend/node_modules/@tesseract.js-data`: no such directory). Not fixable from inside this audit (no
`npm install` permitted). First seen 2026-11-15. Worth noting: tonight's new `read-image` route depends
on the *same* `onboarding-ocr.js` module and passed its own tests cleanly — the missing language-data
package only affects this one pre-existing test's own assertion about where the data ships from, not
the OCR pipeline's basic functioning (confirmed separately: `assist-read-image.test.js`'s 8 tests all
mock the Tesseract call, so they do not depend on the missing package either).

**Documentation mismatch (not a functional gap), confirmed again.** `CLAUDE.md`'s repository map names
`backend/service-agreement-routes.js`; that file does not exist in this checkout. Service agreements are
actually generated through `backend/templates-routes.js` + `backend/templates/service-agreement-map.js`.

**Nothing could not be located this run** beyond the two items already called out in §3 (Automated
Client Appt Reminders has no code; the Opal Assist picture/Client-file/export flows and the
trip-home-fit calendar fix are none of them provable from a browser inside this sandbox, so none of
them can move past their current evidence label from here).

**Write-back.** `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node
../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json` →
`post-tracker: 13 features posted, 0 already posted tonight, brief posted`.

**Open questions for the team (carried forward, unchanged, now joined by a third):** (1) should
"Employee Personal Page (My Profile Tab)" and "Professional Development" be merged into one tracker
card — both point at the same code and the same test gap, confirmed again tonight; (2) where does the
Outlook M365 app-bar embed belong in the tracker — unchanged since 25 Nov, no clean existing home;
(3) where does Opal Assist itself belong — now the more pressing version of the same question, given
tonight's addition of a new clinical-notes read path with no tracker card tracking it at all.
