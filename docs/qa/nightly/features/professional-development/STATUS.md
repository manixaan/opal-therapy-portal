# Professional Development

- Tracker stage: idea · Tracker environment: none
- Evidence label: **broken** — re-confirmed tonight (2026-11-06), **3rd consecutive night** this
  exact defect has been flagged (first raised 2026-11-04/05 as "Admin approval-button mismatch",
  independently re-derived tonight from the code itself, not copied from the prior brief).
- Addressed in this change window (since the 2026-11-05 audit, commit `8853376`): no — the 4
  commits since then (`704a51f`, `0a365c4`, `cd8c4a8`, `e3c0b90`) don't touch this feature.
- Created (any located code): **yes**

## Located files
- Backend: `backend/profile-routes.js` — CPD activities (`GET/POST /api/profile/cpd`, `PATCH /api/profile/cpd/:id/approve`, `PATCH /api/profile/cpd/:id/reject`, `DELETE /api/profile/cpd/:id`)
- Frontend: `frontend/current/profile.js` (CPD section, ~lines 278-420)
- A separate PD catalogue also exists in the Resource Hub (`frontend/current/resourcehub.js`, guarded by `backend/tests/pd-catalogue-guards.test.js`) — unrelated to the approval bug below, noted for completeness since no feature-specific tracker task narrows which surface "Professional Development" means.
- Guards: every CPD route carries `requireAuth`. No missing guard.

## Tonight's independent re-verification (file:line, read fresh, not assumed from the prior brief)
- Backend: `backend/profile-routes.js:35-37` — `function canApprove(user) { return user?.role === 'owner'; }`, documented at line 33 as *"RBAC 2026-08-06: ... approvals are practice management"* (owner-only by design). Gates `PATCH /api/profile/cpd/:id/approve` (line 262) and `/reject` (line 283).
- Frontend: `frontend/current/profile.js:284` — `const isManager = ['owner','admin'].includes(u.role);` — includes **admin**. Line 364 renders the approvals view for any manager; lines 382-383 render live "Reject"/"Approve" buttons.
- **CONFIRMED, independently, for the third night running**: Admin sees working-looking CPD Approve/Reject buttons that always 403, because the frontend's role check (`owner`+`admin`) doesn't match the backend's (`owner` only). Not a security hole — the backend is correctly locked down.

## Tests run tonight
- `npx jest tests/credential-surface-guards.test.js tests/permissions.test.js tests/frontend-stage2-guards.test.js tests/frontend-stage3-guards.test.js tests/security.test.js tests/pd-catalogue-guards.test.js` → **404/404 pass** (358 + 46).
- No unit or integration test exists for the CPD submit→approve/reject round trip at all (confirmed by search — no `profile-routes` test file, no `*.itest.js` posting to `/api/profile/cpd`). The bug above was found by reading code, not by a failing test — nothing currently catches it automatically.

## Open tracker tasks
None recorded on this feature card.

## Disagreement
Tracker stage `idea` / environment `none` undersells a real, guarded, partly-tested feature that is broken for Admin in a specific, reproducible, now-thrice-confirmed way.
