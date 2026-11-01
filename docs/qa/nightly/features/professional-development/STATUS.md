# Professional Development

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed in this change window (since 2026-10-18): no
- Created (any located code): yes — two separate systems

## Located files

1. **Resource Hub self-logged CPD tracker** (own activity log): `backend/resource-hub-r2-routes.js` — `/api/rh2/cpd*`, `/api/rh2/cpd/summary`
2. **My Profile organisational CPD** (owner approve/reject of submitted activities): `backend/profile-routes.js` — `/api/profile/cpd*` (same file covered in the Employee Personal Page folder)

## Guard check

- `/api/rh2/*` — `router.use('/api/rh2', requireAuth, <scope middleware>)`. No defect.
- `/api/profile/cpd*` — `requireAuth` + in-handler `canApprove()`/`canViewAll()` (owner-only). No defect.

## Tests run

| Test | Result |
|---|---|
| `DB_NAME=therapy_scheduler_audit2 DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/resource-hub-r2.itest.js --runInBand` | ✅ 33 passed — self-logged CPD (create/list/patch/delete, cross-user 404 isolation) is fully exercised (lines ~740-753) |
| `/api/profile/cpd*` approve/reject — any test | ❌ none found anywhere |

## Open tracker tasks

None recorded against this feature (empty task list). Tracker's own `next_action` field is still open ("Add an integration test for the CPD submit-approve-reject round trip in My Profile").

## Commits in window

None touching `backend/resource-hub-r2-routes.js` (CPD section) or `backend/profile-routes.js` since 2026-10-18.

## Disagreement

None (tracker-ahead-of-evidence sense). The tracker's own description of the gap is accurate and unchanged: the self-logged tracker is proven, the owner approve/reject workflow in My Profile is not tested anywhere. See `../employee-personal-page-my-profile-tab/STATUS.md` — fixing one fixes both cards.
