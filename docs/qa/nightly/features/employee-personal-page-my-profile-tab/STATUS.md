# Employee Personal Page (My Profile Tab)

- Tracker stage: idea · Tracker environment: none
- Evidence label: **broken** — re-confirmed tonight (2026-11-06), **3rd consecutive night** this
  defect has been flagged (first raised 2026-11-04/05, independently re-derived tonight from the
  code itself, not copied from the prior brief).
- Addressed in this change window (since the 2026-11-05 audit, commit `8853376`): no — the 4
  commits since then (`704a51f`, `0a365c4`, `cd8c4a8`, `e3c0b90`) don't touch this feature.
- Created (any located code): **yes**

## Located files
- Backend: `backend/profile-routes.js` — leave, CPD, PD documents, credentials (per its own header comment, lines 1-15)
- Frontend: `frontend/current/profile.js`; tab banner `<!-- ============ PROFILE TAB ============ -->` at `frontend/current/mockup_v3.html:4323`
- Tests — unit: `tests/credential-surface-guards.test.js`, `permissions.test.js`, `frontend-stage2-guards.test.js`, `frontend-stage3-guards.test.js`, `security.test.js`
- Tests — integration: `tests/integration/credential-scans.itest.js` (credentials only — leave/CPD have no integration coverage)
- E2E: none found under `e2e/tests/` for the Profile tab

## Guard check
Every route in `profile-routes.js` carries `requireAuth` individually (27 routes checked, none missing it). Owner-only actions additionally gate on `canApprove(req.user)` (`role === 'owner'`, `profile-routes.js:35-37`).

## Tonight's independent re-verification (file:line, read fresh)
- **Leave**: `frontend/current/profile.js:93` `isManager = ['owner','admin'].includes(u.role)` → `_renderLeaveApprovalView` (line 122) → `_renderLeaveApprovalRows(pending, true)` (line 172) renders live Reject/Approve buttons (lines 190-191) for Admin too. Backend `PATCH /api/profile/leave/:id/approve` and `/reject` (lines 124, 154) both gate on `canApprove` = owner-only.
- **CPD**: same pattern, `profile.js:284`/`364`/`382-383` vs backend lines 262/283 — see the sibling `professional-development` feature folder.
- **Credentials Verify**: `profile.js:1344` (and the earlier `isManager` check at line 793 gating the "Verify" button rendering) vs `PATCH /api/profile/credentials/:id/verify` (`profile-routes.js:859-860`) — also owner-only via `canApprove`. The route's own doc-comment (lines 857-858) says *"Owner/Admin only"*, which is itself wrong/stale against the code — a second, smaller documentation bug worth a one-line fix alongside the real one.
- **CONFIRMED, independently, for the third night running**, across all three approval surfaces: Admin sees a clickable button that always 403s. Backend is correctly locked down; no security hole.

## Tests run tonight
- Unit: `npx jest tests/credential-surface-guards.test.js tests/permissions.test.js tests/frontend-stage2-guards.test.js tests/frontend-stage3-guards.test.js tests/security.test.js` → **358/358 pass**
- Integration (`DB_NAME=therapy_scheduler_audit_d`): `tests/integration/credential-scans.itest.js` → **22/22 pass** (covers credential CRUD/scan/verify from the Owner side only — never asserts an Admin gets 403, and never touches leave or CPD)
- `node --check backend/profile-routes.js` → OK

## Open tracker tasks
"Review Portal Structure" (status `todo`) — explicitly a manual click-through verification job for a human, not a code task; not something this audit executes.

## Disagreement
Tracker stage `idea` / environment `none` undersells a real, mostly-guarded, partly-tested feature. The concrete defect (Admin-facing buttons that always fail) is real, reproducible from code alone, and now confirmed on three separate nights — first item for "Do this first" in tonight's master brief.
