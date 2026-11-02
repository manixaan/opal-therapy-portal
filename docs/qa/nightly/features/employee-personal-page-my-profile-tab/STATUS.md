# Employee Personal Page (My Profile Tab)

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed in this change window (since 2026-11-01): no — no commit in the window touches `backend/profile-routes.js` or `frontend/current/profile.js`
- Created (any located code): yes

## Located files

- Frontend tab: `frontend/current/mockup_v3.html` — `<!-- ============ PROFILE TAB ============ -->` (line 4315), sections `#pf-leave` (leave), `#pf-cpd` (professional development), `#pf-credentials`, plus documents and work-location cards
- Frontend script: `frontend/current/profile.js`
- Backend routes: `backend/profile-routes.js` — `/api/profile/leave*`, `/api/profile/cpd*`, `/api/profile/documents*`, `/api/profile/credentials*`, `/api/profile/work-schedule*`, `/api/profile/notification-prefs`, `/api/profile/setup-status`

## Guard check

All routes sit behind `requireAuth`. Leave/CPD approve-reject and all-org views additionally gate in-handler via `canApprove()`/`canViewAll()` (owner-only — file header documents this as a deliberate 2026-08-06 RBAC decision, admin's remit is scheduling/travel not HR approvals). `GET /api/profile/work-schedule/:userId` additionally requires `view_all_travel`. No defect found.

## Tests run

| Test | Result |
|---|---|
| `npx jest tests/credential-surface-guards.test.js` | ✅ 28 passed (re-run 2026-11-02) |
| `npx jest tests/smart-route-backend.test.js` (work-schedule guards) | ✅ 13 passed (re-run 2026-11-02) |
| `DB_NAME=therapy_scheduler_audit2 DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/documents.itest.js --runInBand` | ✅ 3 passed (clean tonight, no retry needed) |
| `DB_NAME=therapy_scheduler_audit2 ... tests/integration/credential-scans.itest.js --runInBand` | ✅ 22 passed |
| Leave (`/api/profile/leave*`) — any unit/integration/E2E test | ❌ none found anywhere (grepped `backend/tests/**`, `e2e/tests/**`) |
| CPD approve/reject (`/api/profile/cpd*`) — any unit/integration/E2E test | ❌ none found anywhere (the tested CPD tracker is a *different* system — Resource Hub's self-logged `/api/rh2/cpd`, see Professional Development folder) |

So: documents, credentials and work-schedule sections are proven. Leave and the organisational CPD approve/reject workflow are built and guarded but genuinely have zero test coverage anywhere in the repo — this matches what the tracker's own `claude_update` already said, and it is still true.

## Open tracker tasks

- "Review Portal Structure" — status `todo`. This is a manual browser click-through task (personal details, work locations, leave, CPD, credentials, documents, notifications, the 24-hour work-location reminder), explicitly *not* a coding task.

## Commits in window

None touching `backend/profile-routes.js` or `frontend/current/profile.js` since 2026-11-01 (or since 2026-10-18 — unchanged across both windows).

## Disagreement

None in the tracker-ahead-of-evidence sense (tracker stage is "idea", evidence is actually more mature than that for most of this tab). Worth flagging anyway: the untested leave/CPD-approval gap is real and unchanged — it is HR-sensitive (CRITICAL-level) code with no regression test.
