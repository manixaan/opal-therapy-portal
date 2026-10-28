# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **broken** (same confirmed bug as every night since 2026-10-17 — now the 12th consecutive night)
- Addressed in change window (since last audit, 2026-10-27 `41f45ed`): no — tonight's true window (`41f45ed..15acf0c`) is a travel desk-work feature, a place-names autocomplete feature and a dependency patch, none touching any `splose-*.js`, `outlook-*.js`, `sync-*.js` or `travel-sync-routes.js`/`travel-outlook-sync.js` file. See "Re-verified 2026-10-28" below.
- Created (code exists): yes

## Tonight's change (2026-10-26/27, the true window since the last pushed audit)
The last audit pushed to this branch was dated 2026-10-26 and audited develop
commit `896ace1`. Four real commits (plus their merge) landed on develop
since then — all in this feature's area, none in any other tracked
feature's files (confirmed via `git log 896ace1..41f45ed -- backend
frontend/current`):
- `11aa73f` feat(sync): **Calendar sync settings** — a new per-direction
  sync model (portal→Outlook, Outlook→portal, portal→Splose, Splose→portal,
  Splose→Outlook) with its own on/off, "sync events from" date and Automatic
  toggle per direction; an Owner sets practice defaults and limits. New:
  `backend/sync-settings-routes.js`, `backend/sync-preferences.js`,
  `backend/sync-backfill.js`, migration `081_sync_settings.sql`
  (`sync_settings` table, practice rows + per-person rows), frontend
  `frontend/current/sync-settings.js`/`.css`. "Sync now" plans before it
  writes (link/copy/held-edit/remove/ask-to-choose) and re-plans from fresh
  reads before applying, so a stale preview can't write anything unexpected.
  Defaults reproduce pre-existing behaviour, so nothing changes for anyone
  until a setting is actually changed.
- `971cac1` fix(outlook): the Graph webhook receiver now decrypts stored
  OAuth tokens before using them — pushes were silently falling back to the
  90-second poll whenever `TOKEN_ENCRYPTION_KEY` was set (staging,
  production), because the receiver sent Graph the raw `enc:…` ciphertext.
  Also now reads only live (`is_active`, `account_status = 'active'`)
  accounts, matching the poller's existing rule.
- `3ef3965` — merge of the above into `main`.
- `ab75330` fix(sync): a Splose auto-sync nudge that arrives after a user
  resets their settings no longer starts a fresh timer — it was looking the
  running auto-sync instance up *after* the async settings read, so a reset
  in between could create a timer that outlived the database pool.
- `41f45ed` — merge of the above into `main`.

This is new, real functionality, not a re-verification of old code — and it
touches the same `GET /api/outlook/categories` neighbourhood (`routes.js`)
without fixing the confirmed bug below (re-read tonight, still unchanged).

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

## Note: the travel/booking panel (carried forward, still no tracker card)
Flagged first on 2026-10-24's audit: five commits shipped a "Make room"
booking-panel feature — shortening/splitting existing calendar blocks to make
room for a new session — touching `frontend/current/travel.js`,
`booking-route.css` and `mockup_v3.html`, with `tests/smart-booking-route.test.js`
(still passes). Tonight the same `frontend/current/travel.js` and
`backend/routes.js` (a different handler — see "Located files") grew a new
desk-work rule (where a non-face-to-face/report block happens: at home, where
the therapist is, or automatic), tested by the new
`tests/travel-physical-route.test.js` (126 lines, passes) and an addition to
`tests/integration/event-travel-plan.itest.js` (passes). Pure frontend +
one generic events-metadata PATCH endpoint; neither change touches `splose-*`,
`outlook-*`, `sync-*` or `travel-sync-routes.js`. Still **no tracker card of
its own** as of tonight — unresolved, carried forward again in the morning
brief's "what changed" section.

## Located files
- `backend/outlook-oauth.js` — Microsoft Graph API client (unchanged).
- `backend/routes.js` — legacy catch-all; `GET /api/outlook/categories`
  (line 1487) — **unchanged, byte-for-byte identical to every prior night**
  (re-read tonight). Tonight's own travel desk-work commit touched `routes.js`
  too, but 1,100+ lines away, in the unrelated `PATCH /api/events/:dbId/travel`
  handler — confirmed by reading the diff, not just the commit message.
- `backend/travel-sync-routes.js`, `backend/travel-outlook-sync.js`,
  `backend/travel-feasibility.js`.
- `backend/splose-link-routes.js`, `backend/splose-sync-routes.js`,
  `backend/splose-match.js`, `backend/splose-poller.js`,
  `backend/splose-draft-sync.js`.
- `backend/sync-settings-routes.js`, `backend/sync-preferences.js`,
  `backend/sync-backfill.js` (new tonight).
- Frontend: `frontend/current/splose-sync.js`/`.css`,
  `frontend/current/sync-settings.js`/`.css` (new tonight).

## Guard check (re-run tonight, including new routes)
`router.use('/api/sync-settings', requireAuth, ...)` covers the new
settings routes; practice-default writes additionally require
`requireRole('owner')` in-handler. `router.use('/api/splose-sync',
requireAuth, denyReadOnly, requireDraftSync)` covers every route in
`splose-sync-routes.js`; the Owner/Admin-only undo additionally checks
`isManager(req)` in-handler and answers 403 otherwise — correct.
`travel-sync-routes.js`, `splose-link-routes.js` remain properly guarded as
before. `GET /api/outlook/categories` still has only `requireAuth` —
acceptable (personal Outlook-token read), not the defect. No unguarded
endpoint found, including in tonight's new routes.

## Confirmed bug — still broken, 11th consecutive night
`GET /api/outlook/categories` (`routes.js:1487`) still calls
`getValidAccessToken(user)` (`routes.js:151`), which still throws
`Error('Outlook not connected')` for a disconnected user, still caught only
by the route's generic handler, which still answers a raw `500` instead of a
clean response. **Re-read both functions tonight — the code is
unchanged from every prior night, including tonight's sync-settings work,
which touched `routes.js` elsewhere but not this route.** No test anywhere
references `outlook/categories` or `getValidAccessToken` (re-confirmed by
grep tonight). First reported 2026-10-17; repeated every night since;
**still unfixed tonight, 2026-10-28 — the 12th consecutive night.**

## Tests and results
Unit (re-run tonight, including new files): `splose-draft-sync.test.js`,
`splose-match.test.js`, `splose-api-queue.test.js`,
`splose-auto-sync-reset.test.js`, `splose-credentials.test.js`,
`splose-link-routes.test.js`, `splose-poller.test.js`, `sync.test.js`,
`sync-safety.test.js`, `sync-status-route.test.js`, `sync-backfill.test.js`
(new), `sync-preferences.test.js` (new), `travel-outlook-sync.test.js`,
`travel-sync-routes.test.js`, `outlook-delta-preserve.test.js`,
`outlook-mirror.test.js`, `security.test.js` — **243/243 passed**.

Integration (`DB_NAME=therapy_scheduler_audit`, `DB_PASSWORD=audit`):
`tests/integration/sync-settings.itest.js` (new, 19 tests) and
`calendar-local-first.itest.js` — **19/19 passed**.

No TODO/FIXME found in any changed or located file.

## Open tasks from the tracker
"Multi Calendar Rules" (todo) — six-item checklist. The 2026-10-22 work
advanced "Confirm the Portal and Splose end up matching in both directions"
(c3) with real, tested code; tonight's Calendar Sync Settings feature adds
per-direction control and a previewed "Sync now", which is relevant to the
checklist's general intent but doesn't map onto any single remaining item
cleanly enough to tick one off. The other five items (workflow-rule
confirmation, the "changes saved but not synced" indicator, travel-time
correctness, what Outlook should show, and a real-world stress test) are
unchanged — still open, still largely manual/QA in nature rather than
coding tasks.

## Commits in window that touched it
None tonight — the true window (`41f45ed..15acf0c`) is a travel desk-work
feature, a place-names autocomplete feature and a dependency patch (see
"Note: the travel/booking panel" above), none in `splose-*.js`, `outlook-*.js`
or `sync-*.js`. `11aa73f`, `971cac1`, `3ef3965`, `ab75330`, `41f45ed` (2026-10-27)
and `5d48f01`, `3ca80ad`, `d64389c` (2026-10-22) predate this window — see
"Tonight's change"/"Recent history" above.

## Disagreement
Two, in opposite directions on the same card:
1. The `broken` classification itself is unchanged — the `/api/outlook/categories`
   bug is exactly what the tracker's own `next_action` already names, for the
   12th night running.
2. The "Multi Calendar Rules" checklist is still behind the code: its c3 item
   ("Portal and Splose end up matching in both directions") describes
   something that now has a genuine, tested implementation (shipped
   2026-10-22), but reads as entirely unstarted (`todo`, all unchecked) in the
   tracker.

## Re-verified 2026-10-28
Re-ran the full 17-file unit set (243/243) and `sync-settings.itest.js` +
`calendar-local-first.itest.js` (part of a 172-pass integration batch) tonight —
same as last night. Re-read `GET /api/outlook/categories` (`routes.js:1487`)
and `getValidAccessToken` (`routes.js:151`) byte-for-byte — unchanged. Evidence
label unchanged: `broken`, 12th consecutive night.
