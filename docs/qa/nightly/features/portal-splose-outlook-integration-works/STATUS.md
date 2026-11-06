# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea · Tracker environment: none
- Evidence label: **broken** — narrower than before: one of two carried-over defects is now fixed,
  the other (Outlook-categories 500) is still live and unfixed
- Addressed in this change window (4 commits since the 2026-11-05 audit's cutoff `8853376`:
  `704a51f`, `0a365c4`, `cd8c4a8`, `e3c0b90`): **yes** — `0a365c4` (splose-sync change-alert dialog
  fix) and `e3c0b90` (block-review audit-write fix) both touch this subsystem
- Created (any located code): yes — large, mature subsystem

## History

Real prior audits exist for this feature on 2026-11-01/02/04/05, committed to `origin/claude/nightly-audit` —
they were not visible from this run's own checkout because that checkout started from `origin/develop`,
which has never had `claude/nightly-audit` merged into it, so `docs/qa/nightly/` looked empty there
(only `README.md`). That history has now been recovered onto this branch. The 2026-11-05 brief (the
most recent) labelled this feature **broken** for two reasons, both carried over unfixed for 2-4
nights running at that point:

1. The block-review `confirm`/`sweep`/`confirm-guessed` handlers called `audit(...)` without
   `await`ing it before responding, so the audit-log write raced the response — confirmed flaky
   there (2 of 4 isolated runs of `tests/integration/block-review.itest.js` failed).
2. `GET /api/outlook/categories` falls through to a raw 500 instead of a clean 409 when Outlook
   isn't connected — flagged since an August browser QA pass, still zero test coverage as of
   2026-11-05.

Tonight's run independently re-verified both, rather than carrying the old labels forward:

1. **Fixed.** Commit `e3c0b90` ("fix(block-review): write the audit entry before answering",
   3 Nov) now `await`s every `audit()` call site in `block-review-routes.js` (sweep, confirm-guessed,
   confirm, dismiss) — exactly the fix the 2026-11-05 `START.md` prescribed. Verified by running
   `tests/integration/block-review.itest.js` in isolation **four separate times tonight: 13/13
   passed every time**, no flake (matching the prior audit's own test methodology of 4 isolated
   runs, this time clean).
2. **Still broken, confirmed by direct code read tonight.** `backend/routes.js:1487-1498`
   (`GET /api/outlook/categories`) is unchanged: any error from `getValidAccessToken` (including
   "not connected") still falls into the generic `catch` and returns a raw 500. No test anywhere
   references this endpoint specifically (`grep` across `tests/*.test.js` and
   `tests/integration/*.itest.js` for the literal route finds none). This is a real, reproducible
   gap, not an unverifiable claim — carrying it forward as genuinely unfixed, now flagged for a
   fifth time.

## Located files

- Backend: `backend/routes.js` (`GET /api/outlook/categories`), `backend/calendar-routes.js`,
  `backend/splose-link-routes.js`, `backend/splose-sync-routes.js`, `backend/travel-routes.js`,
  `backend/travel-sync-routes.js`, `backend/sync-settings-routes.js`, `backend/block-review-routes.js`,
  `backend/outlook-oauth.js`, background pollers `splose-poller.js` / `splose-draft-sync.js`.
- Frontend: `frontend/current/travel.js`, `travel-alerts.js`, `splose-sync.js`, `block-review.js`;
  Book/Calendar/Travel & Flights/Travel Logbook tabs in `mockup_v3.html`.

## Guard check

All located routers mount `requireAuth` plus `requireRole`/`requireAnyPermission`/a local
`denyReadOnly` role gate. `/api/outlook/categories` is `requireAuth`-only but reads only the
caller's own token — self-scoped by design, not a guard defect.

## Tests run tonight

- Unit (24 files covering the subsystem) — **394/394 passed**.
- Integration (11 files, DB `therapy_scheduler_audit_a`) — **108/108 passed**, including
  `block-review.itest.js` re-run in isolation 4 more times (13/13 each run, no flake).
- No E2E spec exists for Calendar/Book/Travel (`e2e/tests/` has only `portal.spec.js` and
  `tutorials.spec.js`); `docs/qa/BROWSER_QA_RESULTS.md` was last dated 2026-08-01 per the prior
  audit and was not independently re-checked tonight.

## Open tracker tasks

- "Multi Calendar Rules" (todo) — a human walkthrough checklist (sync indicator, travel time,
  two-way match, what Outlook should show), not a code gap; automated coverage backs every rule
  it lists except the two defects above.

## Disagreement

None against the tracker (stage `idea` already understates this). The real comparison is against
the prior night's own brief: this run narrows the `broken` finding rather than repeating it
unchanged — one root cause resolved, one confirmed still open.
