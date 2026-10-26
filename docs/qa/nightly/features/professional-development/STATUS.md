# Professional Development

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement** (ambiguous scope — two unrelated systems share the "CPD" name)
- Addressed in change window (since last audit, 2026-10-24): touched but not in CPD logic — see below.
- Created (code exists): yes, two separate systems

## Confirmed: two distinct, unrelated CPD systems
1. **My Profile CPD** — `backend/profile-routes.js`: a submit→approve/reject workflow (`POST /api/profile/cpd`, `PATCH /api/profile/cpd/:id/approve`, `PATCH /api/profile/cpd/:id/reject`), owner-only approval via in-handler `canApprove()`. **No dedicated test file exists for this round trip** (confirmed by grepping all unit/integration tests for "cpd" + "approve" together — nothing). Evidence label for this half: built-untested.
2. **Resource Hub CPD logbook** — `backend/resource-hub-r2-routes.js` → `/api/rh2/cpd*`: a self-logged CPD-hours tracker (`cpd_entries` table), own-entries-only, explicitly informational (no approval workflow — practitioner self-reports hours against the OT Board standard). Guarded via `router.use('/api/rh2', requireAuth, ...)`. Covered by `tests/integration/resource-hub-r2.itest.js` — **pass** (re-run tonight). Evidence label for this half: proven.

No TODO/FIXME in either file. Browser QA row I covers CPD/leave/documents rendering (3/3) — that's the My Profile panel render check, not either system's deeper logic.

## Open tasks from the tracker
None recorded.

## Commits in window that touched it
`31d5008` (2026-10-25) touches `resource-hub-r2-routes.js` — confirmed by
reading the diff, it is one line: the Admin rh2 file route's refusal
response now also returns `reasons` (the same privacy-checklist feature
Clinical Resources' folder describes). Not the CPD-logbook endpoints
(`/api/rh2/cpd*`) and not the shared governance helper either — a different
part of the same file. The earlier `0195cb30`, `dd958d0c9` (2026-10-22)
touches to the shared governance `transition()` helper predate this window.

## Disagreement
The tracker card's title is ambiguous between two unrelated systems. Only the My Profile CPD approve/reject flow lacks test coverage — the Resource Hub CPD logbook is tested. This overlaps directly with the Employee Personal Page (My Profile Tab) feature's own gap — the same underlying work (a test for `profile-routes.js`'s CPD approve/reject) would close both cards.
