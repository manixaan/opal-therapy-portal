# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **broken** (one confirmed defect; the rest of the
  integration is proven)
- Addressed this window: no (no commits since 2026-09-27)
- Created at all: yes

## Located files

`backend/calendar-routes.js`, `splose-sync-routes.js`, `splose-link-routes.js`,
`travel-routes.js`, `backend/outlook-oauth.js` (a helper module — its actual
HTTP routes, e.g. `/auth/outlook-login`, `/auth/oauth/callback`,
`/api/outlook/categories`, `/api/outlook/disconnect`, `/api/sync/*`, live in
the legacy **`backend/routes.js`**, which requires `outlook-oauth.js`; this
means CLAUDE.md's routing table is incomplete for Outlook). Tests: 9 unit
files (`outlook-delta-preserve`, `outlook-mirror`, `splose-api-queue`,
`splose-credentials`, `splose-draft-sync`, `splose-link-routes`,
`splose-poller`, `travel-cascade`, `travel-feasibility`) + 8 integration
files. No test exists specifically for `/api/outlook/categories`.

## Guard status

`calendar-routes.js`, `splose-sync-routes.js`, `splose-link-routes.js`,
`travel-routes.js` all guard with `requireAuth` + `requireRole`/
`denyReadOnly`/`denySploseToReadOnly`; `/api/splose/connection` and
practitioner-link admin routes are owner-only. `/api/outlook/categories`
(`routes.js:1463`) has `requireAuth` — guarded, but see the confirmed bug
below.

## Tests run

- Unit: 9 suites, 165 tests passed.
- Integration: `DB_NAME=therapy_scheduler_auditD DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/events-sync.itest.js tests/integration/event-travel-plan.itest.js tests/integration/event-times.itest.js --runInBand` → 3 suites, 17 tests passed.
  `...tests/integration/splose-connection.itest.js tests/integration/splose-draft-sync.itest.js tests/integration/outlook-claim.itest.js tests/integration/outlook-delta-preserve.itest.js tests/integration/travel-overrides.itest.js --runInBand` → 5 suites, 41 tests passed.
- **Totals: 17 files, 223 tests, all passed, 0 failures.**
- No TODO/FIXME found.

## Confirmed defect: `GET /api/outlook/categories` returns 500, not a clean "not connected" response

`backend/routes.js:1463-1476`:
```
router.get('/api/outlook/categories', requireAuth, async (req, res) => {
  try {
    const user = await db.getUser(req.session.userId);
    const accessToken = await getValidAccessToken(user);   // throws for no connection
    ...
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch Outlook categories', details: err.message });
  }
});
```
`getValidAccessToken` (`routes.js:150-153`) throws `'Outlook not connected'`
when the user has no `access_token`. The catch block doesn't distinguish
"not connected" from a real Graph API failure — every path returns 500.
This matches `docs/qa/BROWSER_QA_RESULTS.md`'s console-errors table
(`GET /api/outlook/categories 500` ×3, owner session, rated Medium, still
open — fix commit `b7e3308` addressed two unrelated defects, not this one).
No commits have landed since, so the bug is unchanged today.

## Classification by sub-thing

- **Core calendar/Splose/Outlook sync + travel-time calculation: proven.**
  Fully guarded, 223 passing tests, browser-QA coverage in flows D, E, F.
- **`/api/outlook/categories`: broken.** Confirmed 500-on-not-connected, no
  test covers it.
- **"Multi Calendar Rules" tracker task:** no "multi-calendar-rules"
  engineering artifact exists anywhere — this reads as a pure manual
  decision/stress-test task ("decide Outlook calendar scope, stress-test"),
  not an engineering backlog item.

## Open tasks from the tracker

- "Multi Calendar Rules" (todo) — see above; mostly manual verification, not
  code. The `/api/outlook/categories` bug is a genuine code fix independent
  of this task.

## Commits in the window

None.

## Disagreement note

Confirms the previous `claude_update` exactly, independently verified at
the file:line level rather than trusted from the doc: "solidly built and
tested, but the Outlook categories check shows a confusing 500 instead of a
clean message."
