# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea · Tracker environment: none
- Evidence label: **broken**
- Addressed in this change window: **no** — zero commits touched `backend/` or `frontend/current/`
  between the 2026-11-04 audit's cutoff and tonight's HEAD (both `8853376a`)
- Created (any located code): **yes** — large, mature subsystem

## Located files

- Backend: `backend/routes.js` (legacy `GET /api/outlook/categories`), `backend/calendar-routes.js`,
  `backend/splose-link-routes.js`, `backend/splose-sync-routes.js`, `backend/travel-routes.js`,
  `backend/travel-sync-routes.js`, `backend/block-review-routes.js`, `backend/outlook-oauth.js`.
- Frontend: Book/Calendar/Travel & Flights/Travel Logbook tabs in `mockup_v3.html`; `block-review.js/.css`.
- Guards: all guarded (`requireAuth` + role/permission middleware); `/api/outlook/categories` is
  `requireAuth`-only but self-scoped by design (reads the caller's own token) — not a defect.

## Tests and results

- Unit: 19 suites / 326 tests — **all pass**
  (`block-review`, `booking-rules`, `outlook-delta-preserve`, `outlook-mirror`, `splose-*`, `travel-*`).
- Integration:
  - `tests/integration/block-review.itest.js` — **FLAKY-FAILS**: run in isolation four times
    tonight, 2026-11-05: failed, failed, passed, passed (when run alongside
    `travel-outlook-sync.itest.js` too). **Refined root cause** (corrects last night's framing):
    the confirm handler *does* write the audit row — `audit(req, 'block_review.confirm', ...)` at
    `block-review-routes.js:146` — but `audit()` is never `await`ed before `res.json({ ok: true })`
    on line 147. That races the `INSERT INTO audit_logs` against the test's immediate `SELECT`;
    sometimes the insert lands first, sometimes it doesn't. Not "no audit log at all" — a
    fire-and-forget write with no ordering guarantee. Still a real defect: the same unawaited
    pattern exists on `sweep` (line 82) and `confirm_guessed` (line 112) too, it just hasn't been
    caught there yet.
  - `tests/integration/travel-outlook-sync.itest.js` — pass.
  - No test specifically targets `/api/outlook/categories`.

## Open tasks from the tracker

- "Multi Calendar Rules" — todo, all 6 checklist items unchecked (confirm workflow rules, travel
  time, save/sync indicator, two-way match, decide Outlook scope, stress test).

## Commits in the window that touched it

None — zero commits touched `backend/`/`frontend/current/` between the 2026-11-04 audit's cutoff
and tonight's HEAD (both at `8853376a`). Last window's activity (`3c85f54` block-review,
`1c6a40b` merge, `971cac1` Outlook webhook decrypt fix, `ab75330` Splose auto-sync reset,
`11aa73f` sync settings, `3ca80ad`/`5d48f01` Splose reconcile, `94dad51`/`58f3fec`/`c86355b`/
`ac4912e`/`74d9d91` Make room, `08da79d`/`6a124db` travel, `d64389c` travel/Outlook rejection
logging) was already reported by the 2026-11-01/02/04 audits.

## Disagreement

Tracker stage is `idea` with no why/who/what fields recorded, but the located code is a large,
actively-developed, mostly-tested subsystem — the tracker card understates what already exists.
This is the opposite of the usual "tracker ahead of evidence" disagreement: here the **evidence is
ahead of the tracker**.

## Findings

1. **broken, pre-existing**: `GET /api/outlook/categories` returns a raw 500 (`routes.js:1487-1499`)
   instead of a clean 409 when Outlook isn't connected. Matches `docs/qa/BROWSER_QA_RESULTS.md` line
   74/98 exactly, and matches this feature's own tracker `next_action`. Untouched by any commit in
   the 14-day window.
2. **broken, carried over — 3rd night unfixed, root cause refined tonight**: the block-review
   `confirm` endpoint's audit write (`block-review-routes.js:146`) is fire-and-forget — not
   awaited before the response — so `tests/integration/block-review.itest.js` fails
   non-deterministically. Billing-risk feature (invoice-generation holds out "guessed" blocks)
   with an unreliable audit trail.
