# Professional Development

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement** (ambiguous scope — two unrelated systems share the "CPD" name)
- Addressed in change window (since last audit, 2026-10-23): no — zero commits in the window; develop is frozen at the same commit audited last night. (The 2026-10-22 `resource-hub-r2-routes.js` change — shared governance `transition()` helper only, not the CPD-logbook endpoints — predates this window.)
- Created (code exists): yes, two separate systems

## Confirmed: two distinct, unrelated CPD systems
1. **My Profile CPD** — `backend/profile-routes.js`: a submit→approve/reject workflow (`POST /api/profile/cpd`, `PATCH /api/profile/cpd/:id/approve`, `PATCH /api/profile/cpd/:id/reject`), owner-only approval via in-handler `canApprove()`. **No dedicated test file exists for this round trip** (confirmed by grepping all unit/integration tests for "cpd" + "approve" together — nothing). Evidence label for this half: built-untested.
2. **Resource Hub CPD logbook** — `backend/resource-hub-r2-routes.js` → `/api/rh2/cpd*`: a self-logged CPD-hours tracker (`cpd_entries` table), own-entries-only, explicitly informational (no approval workflow — practitioner self-reports hours against the OT Board standard). Guarded via `router.use('/api/rh2', requireAuth, ...)`. Covered by `tests/integration/resource-hub-r2.itest.js` — **pass** (re-run tonight, 2026-10-24). Evidence label for this half: proven.

No TODO/FIXME in either file. Browser QA row I covers CPD/leave/documents rendering (3/3) — that's the My Profile panel render check, not either system's deeper logic.

## Open tasks from the tracker
None recorded.

## Commits in window that touched it
`0195cb30`, `dd958d0c9` touch `resource-hub-r2-routes.js`'s shared governance
helper (see above) — not the CPD logbook logic itself.

## Disagreement
The tracker card's title is ambiguous between two unrelated systems. Only the My Profile CPD approve/reject flow lacks test coverage — the Resource Hub CPD logbook is tested. This overlaps directly with the Employee Personal Page (My Profile Tab) feature's own gap — the same underlying work (a test for `profile-routes.js`'s CPD approve/reject) would close both cards.
