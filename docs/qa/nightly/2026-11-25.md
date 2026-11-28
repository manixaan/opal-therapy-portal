# Nightly tracker audit — 2026-11-25

## 1. Status line

**RAN** · 2026-11-25 18:40 UTC · commit `2ae079b` (origin/develop) · proven: 1, built-untested: 2,
needs-refinement: 5, broken: 0, untouched: 2, tab-unproven: 3 (13 features total).

**The busiest night this audit has seen.** Ten commits landed in `backend/`/`frontend/current/`
between the last audit (2026-11-24 18:29 UTC, commit `e4fa521`) and tonight's run (2026-11-25 18:40 UTC,
commit `2ae079b`), spanning three subsystems: a large addition to the Opa mobile app (edit an
appointment's client, session type or address from the phone; a client card; "notes owing"; push
notifications via a new APNs integration — migration 094), several calendar/travel fixes and a new
trackpad pinch-to-zoom on the Portal - Splose - Outlook side, and a brand-new Microsoft 365 app that
embeds the whole portal inside Outlook's app bar (with a same-night fix to a session-cookie regression
it introduced). All ten commits' own risk notes are read in full below; none of the three CRITICAL-risk
items it names (contact data now reaching the phone, the new outbound APNs destination, the
SameSite=None cookie trade-off on the Outlook embed) were found to miss a guard, an audit record, or a
test. Every new file passed `node --check` and carried no TODO/FIXME. 153 unit test files (4,146 tests:
4,145 passed, 1 known environment-artifact failure, unchanged from every prior night) and 49 integration
test files (749 tests, all passing) were run fresh tonight, not assumed — including every new test file
tonight's commits added (`mobile-event-edit.test.js`/`.itest.js`, `mobile-crm.itest.js`,
`calendar-pinch-zoom.test.js`, `snapshot-billable-hours.itest.js`, `push-apns.test.js`) and a full
re-run of every untouched subsystem's own tests, which came back an exact match to last night's counts.
No `broken` feature was found anywhere in this run — no unguarded routes, no `node --check` failures,
no regression in any previously-passing test.

## 2. Do this first

1. **[/opal-critical] Opa Mobile Companion — the widest gap of any card tonight; the device walkthrough
   now needs to cover five new things, not two.** Tonight added editing an appointment's client, session
   type or address from the phone (`PATCH /api/mobile/appointments/:id/details`), a client card, "notes
   owing", and push notifications (APNs) — on top of yesterday's drag-to-move, still undemonstrated on a
   device. Every server-side piece is guarded (`requireAuth` plus `manage_own_schedule`/
   `manage_all_schedules` on the writes, every query scoped to the caller), audited, and tested (10 unit
   files / 228 tests, 7 integration files / 34 tests, all passing, including the guard/refusal paths:
   stranger's row → 404, stale view → 409, missing client → 400, `read_only` → 403). But nothing in this
   repository can prove any of it actually works on a phone, and push has never been exercised against
   real APNs (no key yet, by the commit's own admission). Done means: on the test device, dictate a case
   note (still open from prior nights), drag-move an appointment, open the edit sheet and change an
   address then a client/type, open the client card, dismiss a notes-owing item, and — once an APNs key
   exists — confirm a push notification actually arrives. Record each as passing or file the defect.

2. **[/opal-critical] The new Outlook/Teams "Opal" app-bar embed — not yet opened inside a real Outlook
   host, and it already needed one same-night fix.** `backend/outlook-embed.js` and
   `frontend/current/outlook-tab.*` add a Microsoft 365 app that opens the whole portal inside Outlook's
   app bar via Teams SSO, dormant unless `OPAL_OUTLOOK_TAB_ENABLED=true` and Entra settings exist. Within
   the same night a regression surfaced and was fixed: the embed session was built on the *same*
   `PgSessionStore` object as the ordinary session, which silently broke every ordinary password sign-in
   (no session cookie at all over plain http; the Lax cookie lost its SameSite over https) —
   `createSessionDispatcher` now refuses a shared store, and a regression test pins the ordinary cookie's
   shape after the embed middleware runs. This repository has no exact tracker card for either the
   embed feature or its fix (see item 5). Both are read by this audit as guarded and tested
   (`outlook-embed.test.js`, re-run fresh tonight, passing; the account-resolution logic is shared,
   unchanged in behaviour, with Opal Assist's own bearer path via a clean extraction,
   `resolveAccount()`), but — by the commit's own admission — "not exercised against a real Outlook host
   yet (needs https + Entra setup)". Done means: with `OPAL_OUTLOOK_TAB_ENABLED=true` and a real Entra
   app registered, open the tab inside an actual Outlook/Teams client, sign in via SSO, confirm the
   portal renders and is usable framed, and — separately — confirm an ordinary password sign-in still
   gets a normal session cookie afterward (the regression this same night's fix targets).

3. **[/opal-feature] Automated Reminders (tracker-ahead disagreement, eleven nights running) — now with
   a second, separate piece of real progress alongside it.** The Therapist Snapshot task's own checklist
   still marks "Create minimise function on snapshot" as done; no matching whole-panel implementation
   exists anywhere in `frontend/current/reports.js` (only a narrower "Completed" sub-list collapse) —
   confirmed again tonight, 2026-11-15 through 2026-11-25. Separately, and unrelated to that checklist
   item, tonight's `feat(snapshot): billable hours counted by the invoicing rules` commit replaced the
   Snapshot's Outlook-category guesswork with invoicing's own rules (`backing/billing/snapshot-hours.js`,
   new, with a passing integration test) — genuine progress, but no unit test exists for the new module
   itself. Done means: either build the whole-panel minimise or un-tick the checklist item; separately,
   consider adding a unit test for `snapshot-hours.js`'s pure calculation logic.

4. **[/opal-critical] Xero Integration Works — still never confirmed against a real Xero sandbox,
   eleventh night running.** Unchanged tonight (no billing/invoicing/Xero commits landed) — 215 unit +
   90 integration tests still pass, every one of them against a mocked Xero client. The live-sandbox-in-
   a-browser gap is unchanged.

5. **[/opal-feature] Decide where the Outlook M365 embed belongs in the tracker.** Tonight's two largest
   new files (`backend/outlook-embed.js`, `frontend/current/outlook-tab.*`) and their same-night
   session-store fix don't fit any of the 13 cards especially well — "Portal - Splose - Outlook |
   Integration Works" is this audit's best guess (both have "Outlook" in the name) but that card is
   about calendar/Splose/Outlook *data sync*, not embedding the whole portal as a Microsoft 365 app.
   Either file this under that card explicitly, or give it its own. Also worth a decision while there:
   "Employee Personal Page (My Profile Tab)" and "Professional Development" still point at the same
   code (`backend/profile-routes.js`) and the same untested leave/CPD round-trip gap, unchanged again
   tonight — carried forward from every prior night's brief.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Portal - Splose - Outlook \| Integration Works | idea | needs-refinement | **Addressed tonight** — pinch-zoom, a travel-legs-lag fix, a saved-address suburb fix, and a Swap-type rebook fix all landed; the one open task (Multi Calendar Rules) is still a human checklist. | 62u/1415✓, 14i/125✓ |
| Opa Mobile Companion | idea | needs-refinement | **Addressed tonight, heavily** — edit client/session/address, a client card, notes owing, and push (APNs) all landed on top of yesterday's drag-to-move; the device walkthrough now covers five things, not two. | 10u/228✓, 7i/34✓ |
| Automated Reminders | idea | needs-refinement | **Addressed tonight** on the Snapshot side — billable hours now follow invoicing's own rules. Appt reminders: still no code at all. The minimise-checklist disagreement is unrelated and unchanged. | 0u, 2i/9✓ |
| Xero Integration Works | idea | tab-unproven | Unchanged tonight — every Xero call in every test is still mocked; a real sandbox connection is still never confirmed live. | 12u/215✓, 6i/90✓ |
| Report Templates | idea | tab-unproven | FCA/Letter/Agreement generation built & tested (626 tests, no flake tonight); three document flows never hand-checked. | 15u/626✓, 1i/27✓ |
| Interactive Assessments | idea | tab-unproven | WHODAS 2.0 built & tested (484 tests); no browser proof of the tab. | 6u/484✓, 2i/81✓ |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Built & guarded; no test proves the leave/CPD approval round trip. | 4u/94✓, 0i |
| Professional Development | idea | built-untested | Lives inside My Profile's CPD section; shares Employee Personal Page's code and its untested round trip. | 4u/94✓ (indirect), 0i |
| Inductions | idea | needs-refinement | Learner side proven by E2E; builder/AI-helper/photo-step work still open. | 3u/92✓, 2i/7✓, E2E✓ |
| Clinical resources | idea | proven | Built, guarded, fully tested, E2E-proven, no open task — tracker underclaims this one. | 12u/398✓, 7i/168✓, E2E✓ |
| Portal Onboarding Workflow | idea | needs-refinement | Extensively built/tested (653/654 tests); real gap is SharePoint storage for Stage 2. | 25u/604✓+1 known fail, 8i/208✓ |
| Update Opal Docs Register | idea | untouched | Organising/SharePoint task — no code expected. | none |
| Password Master Document | idea | untouched | Tracker says to keep this on OneDrive — no portal action. | none |

## 4. Prompts for the morning

**1. Opa Mobile Companion — device walkthrough, now covering five server-side additions**
```
/opal-critical
On the test device, walk through everything the server side has added over the last two nights:
(1) dictate a case note and confirm it reaches backend/case-note-routes.js's generateGovernedDraft()
(linked by voiceNoteId) and produces a usable draft linked to the right client; (2) drag an appointment
to a new time (POST /api/mobile/appointments/:id/move) and confirm it saves and Outlook/Splose stay
consistent; (3) open the edit sheet (GET …/:id/edit), change the address, then change the client/session
type (PATCH …/:id/details) and confirm each rebooks correctly; (4) open the client card
(GET …/:id/client) and confirm contacts/history/last-note render; (5) dismiss a "notes owing" item and
confirm undo brings it back. Every one of these is guarded (requireAuth + manage_own_schedule/
manage_all_schedules, every query scoped to the caller), audited, and tested (10 unit files / 228 tests,
7 integration files / 34 tests, all passing — including the 404/409/400/403 refusal paths) — but nothing
here proves the phone's own UI works. This is a manual walkthrough first — only write code if it finds a
real defect. Separately, once an APNs key exists, register for push and confirm a "time to leave" or
evening notes-owing notification actually arrives (backend/push/apns.js, backend/push/push-jobs.js —
never exercised against real APNs yet). Done means: each item is recorded as passing, or the defect
found is filed as its own task.
```

**2. Outlook M365 app-bar embed — open it inside a real Outlook/Teams host**
```
/opal-critical
backend/outlook-embed.js and frontend/current/outlook-tab.{html,js} (new 25 Nov 2026) add a Microsoft
365 app that opens the whole portal inside Outlook's/Teams' app bar via Teams JS SSO
(POST /api/auth/entra-embed, validated by assist/entra-auth.js's resolveAccount() — a clean extraction
shared with Opal Assist's existing bearer path, confirmed behaviour-unchanged by diff and by
tests/assist-entra-auth.test.js). It is dormant unless OPAL_OUTLOOK_TAB_ENABLED=true and the Entra
settings exist, and — by the commit's own admission — has never been opened inside a real Outlook host.
The same night, a session-cookie regression this feature introduced was found and fixed: the embed
session was built on the SAME PgSessionStore object as the ordinary session, which silently broke every
ordinary password sign-in (regression test now pins the ordinary cookie's shape after the embed
middleware runs; tests/outlook-embed.test.js, re-run fresh tonight, passing). With a real Entra app
registered: enable the feature, open the tab inside an actual Outlook or Teams client, sign in via SSO,
confirm the portal renders and works while framed, and separately confirm an ordinary password sign-in
still gets a normal (Lax, non-Secure over http) session cookie afterward. Done means: both are confirmed
working inside a real host, or the defect found is filed as its own task.
```

**3. Automated Reminders (tracker-ahead disagreement, eleven nights running)**
```
/opal-feature
Check whether the Development Manager tracker's "Create minimise function on snapshot" checklist item
under the Therapist Snapshot task (feature 398a0b36-a12f-4190-83e4-b3a8932b3b46) has a real whole-panel
implementation anywhere in frontend/current/reports.js or its CSS. A narrower "Completed" sub-list
collapse already exists (swCompletedCollapsed()/swToggleCompleted()) but nothing minimises the whole
Snapshot widget. Either build the whole-panel minimise or un-tick the checklist item to match what
exists. Separately (unrelated to the checklist item): backend/billing/snapshot-hours.js is new as of
tonight and has an integration test (snapshot-billable-hours.itest.js) but no unit test of its own pure
calculation logic — worth adding one. Done means: the checklist and the code agree; optionally, a unit
test exists for snapshot-hours.js.
```

**4. Xero Integration Works — confirm a real sandbox connection**
```
/opal-critical
Confirm a real Xero sandbox connection live in a browser and record it in docs/qa/BROWSER_QA_RESULTS.md.
215 unit + 90 integration tests all pass, but every one of them mocks the Xero client
(backend/xero-api.js, backend/xero-payroll-connection.js). No test here can prove a real Xero call works; only
a browser session against a sandbox tenant can. Done means: a sandbox connection is confirmed working and
recorded.
```

**5. Decide where the Outlook M365 embed belongs in the tracker; decide the Profile/CPD card merge**
```
/opal-feature
Two small tracker decisions, both carried forward: (1) backend/outlook-embed.js and
frontend/current/outlook-tab.* (the new Outlook/Teams app-bar embed) don't clearly belong to any of the
13 tracker cards — "Portal - Splose - Outlook | Integration Works" is this audit's best guess by name
alone, but that card is about calendar/Splose/Outlook data sync, not embedding the portal as an app.
Either file it there explicitly or give it its own card. (2) "Employee Personal Page (My Profile Tab)"
(83bb9988-52ba-4f8c-85ba-7b65aca189b2) and "Professional Development" (37f4e057-ae96-4a9e-a576-5f808b7dc8fb)
both point at backend/profile-routes.js and the same untested leave/CPD round-trip gap — decide whether
to merge them, and consider adding one integration test exercising /api/profile/leave and
/api/profile/cpd (approve and reject paths) either way. Done means: both decisions are recorded in the
tracker.
```

## 5. Ideas without a start

Two feature folders' START.md changed tonight, both because the code they track grew substantially:

- **Opa Mobile Companion** — added the edit-sheet files (`mobile-event-edit.js`,
  `mobile-notes-owing.js`), push (`push/apns.js`, `push/push-jobs.js`), and migration 094 to "Where it
  lives today"; "Start here" now lists five things to try on the device instead of two.
- **Portal - Splose - Outlook | Integration Works** — added the pinch-zoom/travel-lag/address/Swap-type
  fixes to "Where it lives today"; "Start here" now also flags the Outlook M365 embed as a same-night
  addition with no clean tracker home.

No other feature's START.md changed — the tracker's own words for the other eleven features are
unchanged from last night, and none of tonight's ten commits touched their code.

## 6. What changed since last audit

Ten commits landed, all dated 2026-11-25, between last night's audit (2026-11-24 18:29 UTC, commit
`e4fa521`) and tonight's (18:40 UTC, commit `2ae079b`):

**Opa Mobile Companion** (4 commits):
- `9874238` **feat(mobile): client card, notes owing, push to APNs (migration 094)** —
  `backend/mobile-notes-owing.js`, `backend/push/{apns,push-jobs}.js` [new], `backend/mobile-routes.js`,
  `backend/migrations/094_mobile_push_and_notes_owing.sql` [new], `backend/.env.example`,
  `backend/server.js`. RISK (CRITICAL, by the commit's own note) — client contact data, a new
  migration, a new outbound service (APNs); "not exercised against real APNs (no key yet)".
- `c6d599a` **feat(mobile): change client, session type or address from the phone** —
  `backend/mobile-event-edit.js` [new], `backend/mobile-routes.js`, `backend/routes.js` (extracted
  `deleteEventCore`). RISK (scheduling writes, by the commit's own note) — fail-closed on caseload/
  stale-view/missing-client/unknown-type/not-owner, each writing nothing.
- `4201130` **fix(calendar): saved address re-derives its suburb; Swap type rebooks an event** —
  `backend/routes.js`, `frontend/current/{mockup_v3.html,travel.js,booking-route.js}`. (Shared with
  Portal - Splose - Outlook below — the Swap-type fix is calendar-side, consumed by the phone's own
  client/type change above.)
- `2ae079b` **feat(mobile): appointment detail reports canEdit/canMove for the Edit button** —
  `backend/mobile-routes.js` (small, surfaces the edit-sheet's own guard result to the phone's UI).

**Portal - Splose - Outlook | Integration Works** (2 commits, plus the shared fix above):
- `cb3bffa` **fix(calendar): travel legs follow a pinch zoom live** — `frontend/current/travel.js`,
  `frontend/current/mockup_v3.html`.
- `fb5180f` **feat(calendar): trackpad pinch zooms the time axis** — `frontend/current/mockup_v3.html`
  (85 new lines), `backend/tests/calendar-pinch-zoom.test.js` [new].

**Automated Reminders** (1 commit):
- `59b13b1` **feat(snapshot): billable hours counted by the invoicing rules** —
  `backend/billing/snapshot-hours.js` [new], `backend/snapshot-routes.js`,
  `frontend/current/reports.js`.

**No exact tracker feature — reported here, not skipped** (3 commits, 2 subsystems):
- `d068624` **feat(outlook): the whole portal as an "Opal" icon in the Outlook app bar** —
  `backend/outlook-embed.js` [new], `backend/assist/entra-auth.js` (extracted `resolveAccount()`,
  confirmed behaviour-unchanged by diff), `backend/server.js`, `frontend/current/outlook-tab.{html,js}`
  [new]. RISK (CRITICAL, by the commit's own note) — a new authentication surface, SameSite=None cookie
  trade-off; "not exercised against a real Outlook host yet".
- `244f872` **fix(outlook): the embed session gets its own store — password sign-in broke** — same-
  night fix to a regression the commit above introduced (`backend/outlook-embed.js`,
  `backend/server.js`). RISK (CRITICAL, by the commit's own note) — every ordinary password sign-in was
  silently affected; "d068624 was never pushed, so no deployed environment had the bug."
- `82e5731` **fix(outlook): the Outlook tab page links the icon set, manifest and typeface** —
  `frontend/current/outlook-tab.html` (a missed shared-head pin, found by the project's own
  `frontend-stage3-guards.test.js`); also fixed `.gitignore`'s `node_modules` pattern (a worktree
  symlink was getting staged).

Neither the Outlook embed nor its fix fits any of the 13 tracker cards especially well (see "Do this
first" item 5 and item 2's prompt). No other subsystem changed tonight; every other feature's
unchanged-tonight status below is a fresh re-run, not an assumption.

## 7. Technical detail

**Setup.** PostgreSQL was down at the start of this run (`service postgresql status` →
`16/main (port 5432): down`) — started with `service postgresql start`, confirmed online.
`backend/node_modules/.bin/jest` was present — no install needed. Tracker snapshot pulled via
`NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs
/tmp/tracker.json` → `fetch-tracker: 13 features, 19 tasks -> /tmp/tracker.json`.

**A bootstrap correction worth recording.** This run's `docs/qa/nightly/` history lives only on
`origin/claude/nightly-audit` (back to 2026-11-15) — it has never been merged to `develop`, so the
develop-based working checkout this audit starts from (`git checkout -B nightly-audit-work
origin/develop`, per the bootstrap instructions) shows none of it, and `docs/qa/nightly/` there holds
only `README.md`. The prior ten nights' briefs and feature folders were read directly from
`origin/claude/nightly-audit` instead (`git fetch origin claude/nightly-audit`, then reading each file
with `git show origin/claude/nightly-audit:<path>`), and the delivery step below rebuilds tonight's
`claude/nightly-audit` branch from that history plus a merge of tonight's `origin/develop`, rather than
branching fresh from `develop` and risking the force-push discarding ten nights of prior audit docs.
Last night's own status line (RAN 18:29 UTC 2026-11-24, commit `e4fa521`) was used as the audit window's
start, confirmed as an ancestor of tonight's `origin/develop` HEAD (`2ae079b`) by
`git merge-base --is-ancestor`. Today (2026-11-25, UTC) is a Wednesday, not Sunday — no complete-suite
weekly deep run tonight, per the weekly rule.

**Locate.** `git log e4fa521..origin/develop --stat -- backend frontend/current` showed the ten commits
above touching 24 backend files (6 new) and 6 frontend files (2 new), plus one migration and nine new
test files. Every new/changed backend file listed above passed `node --check` and a fresh grep found no
TODO/FIXME in any of them.

**Guard check.** Every new or changed route sits behind `requireAuth` (router-wide on `/api/mobile`) plus
an explicit `requireAnyPermission('manage_own_schedule', 'manage_all_schedules')` on every write
(`move`, `edit`, `details`); every query in the new mobile files is scoped to `user_id = req.user.id` (or
`therapist_profile_id`), confirmed by reading every new SQL statement in `mobile-routes.js`,
`mobile-event-edit.js` and `mobile-notes-owing.js`, not only by the passing tests. The client card
explicitly refuses `read_only` (403) ahead of any Splose call. The client picker never trusts a client
id from the phone directly — it re-resolves through the caller's own Splose caseload
(`splose-caseload.js`'s `loadOwnClient`) every time. Push notifications carry only minutes/counts, never
a client name (read by inspection of every `title`/`body` string in `push/push-jobs.js`). The Outlook
embed's CSRF story was read directly: `embedGuards` refuses any unsafe method on an embed session
without `Sec-Fetch-Site: same-origin` (fail-closed), and `createSessionDispatcher` now throws at startup
if handed the same store object twice — read in `backend/outlook-embed.js` and confirmed wired correctly
in `backend/server.js` (`embedStore: new PgSessionStore(dbPool, SESSION_TTL_MS)`, a second instance, not
the one `SESSION_STORE` already uses). `backend/assist/entra-auth.js`'s `resolveAccount()` extraction was
diffed directly against its pre-extraction form: identical logic, just shared between the bearer path
and the new embed exchange — no behaviour change. AI-gateway boundary re-confirmed clean tonight
(`tests/ai-gateway-boundary.test.js`, `tests/ai-single-gateway-guards.test.js` — 30/30 pass) — nothing
new tonight imports an AI SDK or touches `backend/ai/`. `scripts/check-asset-pins.js` reports every
cache-bust pin in `mockup_v3.html` matches what tonight's commit would ship.

**Test selection and execution.** Every file below was run fresh tonight, not assumed — 153 unit test
files / 4,146 tests across six batches (Opa Mobile Companion: 10 files/228; Portal-Splose-Outlook main
batch: 61 files/1,121 plus `frontend-stage3-guards.test.js` separately at 294; the entra-auth/Xero batch:
10 files/154; two frontend-guard files touching `reports.js`: 2 files/56; Report Templates: 15 files/626;
Interactive Assessments+Profile+Inductions: 12 files/585; Clinical resources: 12 files/398+12 skipped;
Portal Onboarding Workflow: 25 files/605 (604 passed, the known `onboarding-document-reader.test.js`
artifact unchanged); the three remaining Xero files, `pricing-engine`/`reconciliation-engine`/
`mmm-locality`: 3 files/37; AI-gateway boundary reconfirmation: 2 files/30) — and 49 integration test
files / 749 tests across five batches (Opa Mobile Companion: 7 files/34; Portal-Splose-Outlook: 14
files/125; Automated Reminders' snapshot: 2 files/9; Portal Onboarding Workflow: 8 files/208; Resources+
Templates+Assessments+Inductions+Xero: 18 files/373). Every count for an unchanged subsystem matched
last night's exactly (Clinical resources 398+12 skipped and 168 integration; Report Templates 626 unit —
one file larger than last night's 598 because `templates-frontend-guards.test.js` was included in this
night's batch selection — and 27 integration; Interactive Assessments 484 and 81; Xero 215 and 90;
Portal Onboarding Workflow 208 integration; Inductions 92 and 7) — independently confirming no
unchanged subsystem's behaviour actually changed.

**Known environment artifact, confirmed again (eleventh night running).**
`tests/onboarding-document-reader.test.js` fails with "Cannot find module
'@tesseract.js-data/eng/package.json'". `@tesseract.js-data/eng` is declared in `backend/package.json`
but genuinely absent from `backend/node_modules` in this sandbox (checked directly tonight with
`ls backend/node_modules/@tesseract.js-data`: no such directory). Not fixable from inside this audit (no
`npm install` permitted). First seen 2026-11-15.

**Documentation mismatch (not a functional gap), confirmed again.** `CLAUDE.md`'s repository map names
`backend/service-agreement-routes.js`; that file does not exist in this checkout. Service agreements are
actually generated through `backend/templates-routes.js` + `backend/templates/service-agreement-map.js`.

**Nothing could not be located this run** beyond the two items already called out in "Every feature"
(Automated Client Appt Reminders has no code; the mobile app's and the Outlook embed's own frontend
experiences are either outside this repository or untested inside a real host, so neither can be proven
from here).

**Write-back.** `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node
../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json` →
`post-tracker: 13 features posted, 0 already posted tonight, brief posted`.

**Open questions for the team (carried forward, unchanged):** (1) should "Employee Personal Page (My
Profile Tab)" and "Professional Development" be merged into one tracker card — both point at the same
code and the same test gap, confirmed again tonight; (2) where does the new Outlook M365 app-bar embed
belong in the tracker — new tonight, no clean existing home.
