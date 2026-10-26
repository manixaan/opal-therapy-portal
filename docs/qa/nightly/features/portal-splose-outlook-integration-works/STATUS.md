# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **broken** (same confirmed bug as every night since 2026-10-17 — now the 10th consecutive night)
- Addressed in change window (since last audit, 2026-10-24): not in this feature's own files, but tonight's unrelated "Make room" booking commits shipped under the same Book/Calendar area — see note below.
- Created (code exists): yes

## Recent history (2026-10-22)
That night shipped a genuine two-way Portal/Splose match-link-ignore engine:
`backend/splose-match.js` (pure `findMatches`), `backend/splose-sync-routes.js`
(`GET matches`, link one/bulk-exact, ignore one/bulk, list ignored,
Owner/Admin undo), migration 080, and the frontend review UI in
`splose-sync.js`/`.css` (Link/Send/Ignore per row, bulk "Link all exact
matches", Ignored list with Undo). A separate small fix that night
(`d64389c0`) stopped a refused travel→Outlook run from logging a spurious
unhandled-rejection. This directly advanced "Multi Calendar Rules"'
checklist item "Confirm the Portal and Splose end up matching in both
directions" — still all-unchecked in the tracker, see Disagreement. None of
this changed again tonight; re-verified below against the same code.

## Note: a new "Make room" booking feature shipped tonight, unrelated to this card
Five commits tonight (`94dad51`, `58f3fec`, `c86355b`, `ac4912e`, `74d9d91`)
shipped a booking-panel feature — shortening/splitting existing calendar
blocks to make room for a new session — touching
`frontend/current/travel.js`, `booking-route.css` and `mockup_v3.html`, with
a new frontend test `tests/smart-booking-route.test.js` (passes). This is a
pure frontend change to the booking panel: no new backend route, no guard
surface, and it does not touch `splose-*`, `outlook-*` or `travel-sync-routes.js`.
It has **no tracker card of its own** — it does not belong to this feature
(the title only matches "Calendar" loosely) and is flagged in the morning
brief's "what changed" section instead.

## Located files
- `backend/outlook-oauth.js` — Microsoft Graph API client (unchanged).
- `backend/routes.js` — legacy catch-all; `GET /api/outlook/categories`
  (line 1466) — **unchanged, byte-for-byte identical to every prior night**
  (re-read tonight).
- `backend/travel-sync-routes.js`, `backend/travel-outlook-sync.js`,
  `backend/travel-feasibility.js`.
- `backend/splose-link-routes.js`, `backend/splose-sync-routes.js`,
  `backend/splose-match.js`, `backend/splose-poller.js`,
  `backend/splose-draft-sync.js`.
- Frontend: `frontend/current/splose-sync.js`/`.css`.

## Guard check (re-run tonight)
`router.use('/api/splose-sync', requireAuth, denyReadOnly, requireDraftSync)`
covers every route in the new `splose-sync-routes.js`; the Owner/Admin-only
undo additionally checks `isManager(req)` in-handler and answers 403
otherwise — correct. `travel-sync-routes.js`, `splose-link-routes.js` remain
properly guarded as before. `GET /api/outlook/categories` still has only
`requireAuth` — acceptable (personal Outlook-token read), not the defect. No
unguarded endpoint found, including in tonight's new routes.

## Confirmed bug — still broken, 10th consecutive night
`GET /api/outlook/categories` (`routes.js:1466`) still calls
`getValidAccessToken(user)` (`routes.js:151`), which still throws
`Error('Outlook not connected')` for a disconnected user, still caught only
by the route's generic handler, which still answers a raw `500` instead of a
clean response. **Re-read both functions tonight — the code is
unchanged from every prior night.** No test anywhere references
`outlook/categories` or `getValidAccessToken` (re-confirmed by grep tonight).
First reported 2026-10-17; repeated every night since; **still
unfixed tonight, 2026-10-26 — the 10th consecutive night** (the tracker's
own write-back from the night of 2026-10-25 already called it the 9th; no
brief for that night was pushed to this branch — see the morning brief §7).

## Tests and results
Unit (re-run tonight): `splose-draft-sync.test.js`,
`splose-match.test.js` — **all pass**; `sync.test.js`,
`sync-safety.test.js`, `travel-outlook-sync.test.js`,
`outlook-delta-preserve.test.js` — **all pass**.

Integration (`DB_NAME=therapy_scheduler_auditnight1026`, `DB_PASSWORD=audit`):
`splose-draft-sync.itest.js`, `splose-link-ignore.itest.js`,
`splose-connection.itest.js` — **all pass** (re-run tonight).

No TODO/FIXME found in any changed or located file.

## Open tasks from the tracker
"Multi Calendar Rules" (todo) — six-item checklist. The 2026-10-22 work
advanced "Confirm the Portal and Splose end up matching in both directions"
(c3) with real, tested code; the other five items (workflow-rule
confirmation, the sync indicator, travel-time correctness, what Outlook
should show, and a real-world stress test) are unchanged — still open, still
largely manual/QA in nature rather than coding tasks.

## Commits in window that touched it
None in this feature's own files — see the "Make room" note above for
tonight's unrelated booking-panel commits. The 2026-10-22 commits
`5d48f018`, `3ca80ad9`, `d64389c0` predate this window — see "Recent
history" above.

## Disagreement
Two, in opposite directions on the same card:
1. The `broken` classification itself is unchanged — the `/api/outlook/categories`
   bug is exactly what the tracker's own `next_action` already names, for the
   10th night running.
2. The "Multi Calendar Rules" checklist is still behind the code: its c3 item
   ("Portal and Splose end up matching in both directions") describes
   something that now has a genuine, tested implementation (shipped
   2026-10-22), but reads as entirely unstarted (`todo`, all unchecked) in the
   tracker.
