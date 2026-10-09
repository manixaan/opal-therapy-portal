# Opa Mobile Companion

- Tracker stage: `idea`
- Tracker environment: `none`
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-10-08): no
- Created (any located code at all): yes

## Located

- `backend/mobile-routes.js` — `requireAuth` only; header comment documents strict `user_id`/own-profile scoping (self-scoped by design, same pattern as `snapshot-routes.js`).
- `backend/case-note-routes.js` — `requireAuth` on `/api/mobile/case-note-drafts` and `/api/mobile/ai/case-note`.

## Tests

- Unit: `tests/mobile-routes.test.js` + `tests/case-note-routes.test.js` — **105/105 pass.**
- Integration: `tests/integration/case-note-client-link.itest.js` + `tests/integration/case-note-deidentification.itest.js` — **6/6 pass.**
- e2e / browser QA: none — expected, this is the native mobile app, not the portal web UI.

## Open tasks (from the tracker)

Tracker task "Case Noting" carries a 7-item checklist (about 20 sub-items) and **every single item is still unchecked**, ending in "Get Ann's sign-off on the pilot." Task "Calendar View" is also `todo`.

## Commits since the last audit that touched it

None — no commits have landed on `develop` under `backend/` or `frontend/current/` since the last audit (2026-10-08). Code audited tonight is the same commit (`aacf8e6`) as the last several nights.

## Disagreement with the tracker

None.

