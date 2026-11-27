# Portal - Splose - Outlook | Integration Works

Tracker stage: idea · Tracker environment: none
Evidence label: **needs-refinement**
Addressed this window (since 2026-11-13): yes
Created (any located code): yes

## Located files

`backend/calendar-routes.js`, `backend/travel-routes.js`, `backend/travel-sync-routes.js`
(Outlook mirroring of travel legs, migration 073), `backend/travel-outlook-sync.js`,
`backend/travel-feasibility.js`, `backend/travel-cascade.js`, `backend/splose-sync-routes.js`,
`backend/splose-link-routes.js`, `backend/splose-poller.js`, `backend/splose-api.js`,
`backend/splose-match.js`, `backend/splose-credentials.js`, `backend/outlook-oauth.js`,
`backend/outlook-embed.js`. Frontend: `============ CALENDAR TAB ============`
(`mockup_v3.html:5231`); Outlook/Sync UI is an icon-bar + sync popup inside the same shell, not
a separate tab.

## Guard check

All guarded. `travel-sync-routes.js`, `splose-sync-routes.js`, `splose-link-routes.js` and
`calendar-routes.js` each apply `requireAuth` plus `requirePermission`/`requireRole` or an
explicit self-scoped-by-design header comment. No unguarded endpoint found.

## Tests

- Unit (41 files: `calendar-*`, `outlook-*`, `splose-*`, `travel-*`): **41/41 suites,
  598/598 tests passed**.
- Integration (10 files): `splose-draft-sync.itest.js`, `splose-link-ignore.itest.js`,
  `travel-outlook-sync.itest.js`, `outlook-claim.itest.js`, `outlook-delta-preserve.itest.js`,
  `calendar-local-first.itest.js`, `event-travel-plan.itest.js`, `travel-overrides.itest.js`,
  `splose-connection.itest.js`, `calendar-category-colours.itest.js` — **10/10 suites,
  79/79 tests passed**.
- Browser/E2E: `e2e/tests/portal.spec.js` covers Splose data-scoping and fail-closed behaviour,
  blocked Splose write routes, and the Outlook per-user not-connected state.
  `docs/qa/BROWSER_QA_RESULTS.md` rows D (Outlook state, 4/4) and E (Calendar/shell, 6/6) are
  green, from 2026-08-01 — that QA pass is 3+ months old relative to tonight and predates most
  of the calendar/travel/sync work below, so treat it as evidence the *shell* renders, not that
  the specific "Multi Calendar Rules" claims (two-way match, saved-but-not-synced indicator,
  travel-time-for-a-day accuracy) have been walked by a human.
- A known open defect from that same browser QA: `GET /api/outlook/categories` 500s for a user
  with no Outlook connection (Medium severity) — still unresolved as far as this audit can see.

## Open tasks (from tracker)

- Multi Calendar Rules — todo. A human checklist: confirm each workflow rule, the
  saved-but-not-synced indicator, travel-time accuracy, the two-way Portal/Splose match, decide
  what Outlook should show, and stress-test with real examples. This is explicitly designed as
  a confirm-it's-working exercise, not a build task — but it has never been walked end to end.

## Commits in window (since 2026-11-13)

`244f872` fix(outlook): embed session own store · `d068624` feat(outlook): portal as "Opal"
icon in Outlook app bar · `812b051` feat(billing): travel bills minutes calendar showed ·
`f9e2cd0` fix(travel): week's travel to Outlook in one request, per-day guard (T-08) ·
`566e542` fix(travel): Outlook travel mirrored only when day real · `c4a4156` feat(calendar):
three-tab Sync popup, outside-event QC, night mode · `3f63508` feat(sync): one sync choice per
Outlook direction, three-tab Sync now — plus a large body of calendar/booking/travel polish
commits in the same window (see the morning brief's "What changed" section).

## Disagreement

None on the tracker stage. Worth flagging directly to the team: the "Multi Calendar Rules"
checklist asks for things ("saved but not synced" indicator, two-way match, travel-time
accuracy) that automated tests already exercise individually (`splose-draft-sync`,
`travel-feasibility`, `splose-match`) — the gap is a *human* confirmation pass, not missing
code.
