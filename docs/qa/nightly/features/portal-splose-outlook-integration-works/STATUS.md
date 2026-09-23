# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window (2026-09-22 → 2026-09-23): no — zero commits landed in this window
  at all. The second Splose-linking surface described below (`37f4e057`) landed in the *prior* window
  (2026-09-21 → 2026-09-22) and is unchanged tonight.
- Created (any located code): yes — extensively, and long predates this window

## Update (2026-09-22, prior window — unchanged tonight): a second, new Splose-linking surface, still unproven at the browser level

`37f4e057` (prior window) is a genuinely NEW admin-side capability, not the
self-service Settings screen moved or renamed. That 2026-09-18 self-service screen (each user linking
their own Splose identity — `GET/PUT/DELETE /api/splose/my-practitioner`, `/api/splose/connection`)
is untouched and still exists. Tonight adds a second, distinct surface — Settings → **Users & Roles**
(`frontend/current/people.js`, new, 441 lines; `GET /api/admin/people` in `backend/app-routes.js`) —
where an **owner** picks which Splose practitioner *another person* maps to via a dropdown
(`PUT/DELETE /api/admin/people/:userId/splose-link` in `backend/splose-link-routes.js`, 78 new
lines). No email-match requirement (unlike self-link); org+active-practitioner uniqueness instead
(409 on conflict). Confirmed by reading `people.js`'s `sploseBlock()`/`sploseCell()` (~lines 292-313,
118-120) and the route diff.

**Guard check on the new code: clean.** `backend/app-routes.js`:
`router.get('/api/admin/people', requireAuth, requireRole('owner'), ...)`. `splose-link-routes.js`:
`router.use('/api/admin/people/:userId/splose-link', requireAuth, requireRole('owner'))` before both
PUT and DELETE. Org-scope enforced in `loadTargetUser` (404 if target org ≠ caller org). Audit events
logged with `self:false` and `userId`.

**New tests exercise the routes directly, not the rendered UI.** `admin-people.itest.js` (new, 101
lines) and 6 new tests in `splose-link-routes.test.js` ("Owner links a practitioner to ANOTHER
person") hit `/api/admin/people` and the new splose-link endpoints via supertest — this proves the
API contract (org scoping, 403/404/409, audit fields, no token leakage) but is **not** UI/E2E proof.
Re-checked again tonight: `grep -rniE "splose" e2e/tests/*.spec.js` and `docs/qa/BROWSER_QA_RESULTS.md`
still show no mention of `/api/admin/people`, the practitioner dropdown, or link/unlink anywhere.
**The gap this audit has now flagged for six straight nights hasn't closed — still two unproven UI
paths** (self-service linking, unproven since 2026-09-18; owner-assigns-to-another-person, unproven
since 2026-09-22), both rendering through the same underlying Splose-link mechanism.

Test results, re-run fresh tonight: `splose-link-routes.test.js` → still 23/23. `admin-people.itest.js`
→ still 2/2 (ran cleanly this time, no DB-name collision — this session had the database to itself).
Broader regression, run together with the Opa Mobile Companion batch: unit 23 suites/548 tests,
integration 15 suites/99 tests — both a superset of and consistent with last night's figures
(17 suites/388 + mobile's own suites; 12 suites/91 + admin-people's 2 + mobile's 6), no regression.

## Located files

- Routes: `backend/routes.js` (core Outlook/Splose sync surface: `/api/events`, `/api/sync/*`, `/api/sync-status`, `/api/outlook/*`, `/api/calendar/reconcile`, `/api/splose/status`), `backend/splose-link-routes.js` (practitioner linking), `backend/splose-sync-routes.js` (draft-and-publish queue), `backend/travel-routes.js`, `backend/scheduler-routes.js` (Multi Calendar Rules candidate matching), `backend/calendar-routes.js`
- Data access: `backend/outlook-oauth.js`, `backend/travel-cascade.js`, `backend/travel-feasibility.js`, `backend/availability-engine.js`, `backend/candidate-engine.js`, `backend/candidate-scorer.js`, `backend/splose-api.js`, `backend/splose-draft-sync.js`, `backend/splose-poller.js`, `backend/splose-credentials.js`, `backend/calendar-permissions.js`, `backend/geo.js`
- Frontend: `<!-- BOOK TAB -->` and `<!-- CALENDAR TAB -->` banners in `mockup_v3.html`; `frontend/current/splose-sync.js` (pending-changes queue, unsynced-tile marking, two-way conflict dialog); `frontend/current/travel.js`; `frontend/current/scheduler.js` + `scheduler.css`

## Guard check

Every route file guards through `requireAuth` (imported from `permissions.js`, never re-declared locally), most per-route rather than blanket: `splose-link-routes.js` (`requireAuth` + `requireRole('owner')` on the connection endpoint), `splose-sync-routes.js` (`requireAuth, denyReadOnly, requireDraftSync`), `travel-routes.js` and `scheduler-routes.js` (`requireAuth` + `requireMasterCalendarAccess`/`denyReadOnly` per route), `calendar-routes.js` (`requireAuth` + role gates on writes/admin endpoints), `routes.js` (per-route `requireAuth`, plus `requireRole('owner','admin')` on reconcile/diagnostics). No unguarded route found.

**Dead code found (not a guard defect — these are never mounted):** `backend/routes-outlook-integration.js` and `backend/routes-backup-original.js` duplicate live sync logic but are never `require()`d anywhere in the codebase. `routes-outlook-integration.js` defines its own local `requireAuth` rather than importing the shared one — exactly the anti-pattern the project's own convention warns against — but since it's unmounted it poses no live risk today. Worth a cleanup ticket so it can't be wired in later by accident.

## Tests

- Unit (all pass, re-run tonight): `splose-link-routes.test.js`, `splose-api-queue.test.js`, `splose-credentials.test.js`, `splose-poller.test.js`, `splose-draft-sync.test.js`, `sync.test.js`, `sync-safety.test.js`, `sync-status-route.test.js`, `outlook-mirror.test.js`, `outlook-delta-preserve.test.js`, `scheduler-geo.test.js`, `scheduler-helpers.test.js`, `scheduler-matrix.test.js`, `travel-cascade.test.js`, `travel-feasibility.test.js`, `availability-engine.test.js`, `contact-matching.test.js` — 23 suites total (with mobile tests run alongside), 548 tests, 0 failures
- Integration (all pass, re-run tonight): `splose-connection.itest.js`, `splose-draft-sync.itest.js`, `events-sync.itest.js`, `event-times.itest.js`, `event-delete-cascade.itest.js`, `event-travel-plan.itest.js`, `travel-overrides.itest.js`, `series-master.itest.js`, `scheduler-availability.itest.js`, `outlook-claim.itest.js`, `outlook-delta-preserve.itest.js`, `oauth-callback.itest.js`, `admin-people.itest.js` — 13 suites, 93 tests, 0 failures
- Browser/E2E: `docs/qa/BROWSER_QA_RESULTS.md` (2026-08-01) rows C, D, E, F, J cover Splose link pending state, per-user Outlook not-connected state, the "Travel & Flights" tab (deliberately disabled, "Coming soon"), and Splose 403 fail-closed boundaries. `e2e/tests/portal.spec.js` exercises Splose fail-closed/permission checks and per-user session isolation of Outlook state. `e2e/tests/tutorials.spec.js` references the Master Scheduler and Splose induction walkthroughs and switches to the calendar tab. **However**, this audit specifically checked for coverage of the Settings → Integrations → Splose screen added 2026-09-18 (self-service practitioner linking, `41a9e27`; practice API key moved into the database, `494bd86`) — grepping both e2e spec files for any mention of Splose connect/disconnect, practitioner linking, or API-key management finds **nothing**. The existing browser/E2E coverage is real but proves the older sync-engine boundaries, not this newer Settings UI. Prior audit nights (2026-09-18 through 09-20) independently reached the same conclusion; nothing in tonight's window changes it.

## Open tasks from the tracker

- "Multi Calendar Rules" — `todo`. Checklist asks to confirm each workflow rule is in operation: the unsynced indicator, travel-time calculation, two-way Portal/Splose match, what Outlook should show, and a stress test with real-world examples. The code and unit/integration tests cover the mechanics (`splose-sync.js`'s pending queue and conflict dialog, `travel-cascade.js`/`availability-engine.js` for travel time), but the checklist's own ask — a human stress test with real-world examples — is a manual verification step, not something this audit can perform.

## Known open issues (from browser QA, still logged as of 2026-08-01)

- `GET /api/outlook/categories` returns 500 for a user with no Outlook connection instead of an empty/"not connected" result (Medium severity, `routes.js` ~line 1463)
- Google Maps `InvalidKey` warning in staging (placeholder key), degrading travel-time features (Medium severity, environment issue not code)

## Commits in the window that touched it

None this window (2026-09-22 → 2026-09-23) — `develop` did not move since last night (both audits sit
on `74601fc`). Prior window (2026-09-21 → 2026-09-22): 37f4e057 `feat(people): Users & Roles
redesigned — one row per person, a side panel, and the Splose practitioner picked from a dropdown` —
see "Update" above.

Older: ff19cab (2026-09-20) all-day row fix, 22ce321/41a9e27/494bd86 (2026-09-18) the original
Settings screen, 9092bc7/3ca64ca (2026-09-17) perf work.

## Disagreement

None on tracker-vs-evidence (stage `idea` still undersells a mature subsystem). Worth flagging to the
team directly: the Splose-practitioner-linking UI gap has now been open and independently
re-confirmed for **six** consecutive audit nights (2026-09-18 through 2026-09-23), still covering two
unproven UI paths.

## Audit history

This feature has been `tab-unproven` for the Settings UI gap across at least four prior nightly
audits (2026-09-18 through 09-21). 2026-09-22's redesign (`37f4e057`) added a second admin-side
linking surface (Users & Roles) with its own API-level test coverage but the same lack of browser/E2E
proof. Tonight (2026-09-23) is a quiet re-verification night — no commits, no tracker changes — the
label stays `tab-unproven` for a sixth consecutive night, still covering two unproven UI paths.
