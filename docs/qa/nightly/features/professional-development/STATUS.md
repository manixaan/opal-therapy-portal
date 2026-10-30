# Professional Development

- Tracker stage: idea · Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed since the last audit: **no** — the window `15acf0c..338f5dc` (5
  commits, verified by `git log`/`git diff --stat`) does not touch
  `backend/profile-routes.js` or `backend/resource-hub-r2-routes.js`.
- Created (any located code): yes, two separate systems.

## Located

Two unrelated systems share only the name "CPD" — confirmed tonight by
re-reading both directly (different tables, different access models):

- **System A — Resource Hub self-logged CPD tracker:**
  `backend/resource-hub-r2-routes.js:2306-2392`. `/api/rh2/cpd` (GET/POST),
  `/api/rh2/cpd/:id` (PATCH/DELETE), `/api/rh2/cpd/summary`. Backs onto
  `cpd_entries`, scoped `WHERE user_id = $1`. Self-tracking, no approval step.
- **System B — My Profile CPD submit/approve/reject:**
  `backend/profile-routes.js:204-321`. `/api/profile/cpd` (GET/POST),
  `/api/profile/cpd/:id/approve`, `/api/profile/cpd/:id/reject`,
  `/api/profile/cpd/:id` (DELETE). Different table via
  `db.createCPDActivity` / `updateCPDStatus` / `getCPDActivities`.

## Guard check

System A: `router.get('/api/rh2/cpd', safe(...))` — mounted under `/api/rh2`,
`requireAuth` + self-scoped by `user_id = $1` in every query — self-scoped by
design, not broken.
System B: `requireAuth` + inline `canApprove(req.user)` (role === 'owner') on
approve/reject, not `permissions.js` middleware — functions correctly (403
confirmed by grep of the handler), but is a convention deviation worth a
human eye, same note as the My Profile card.

## Tests and results

| Command | Result |
|---|---|
| `npx jest tests/pd-catalogue-guards.test.js` | PASS — 46/46 (System A catalogue/eligibility) |
| `tests/integration/resource-hub-r2.itest.js` | PASS — 33/33 (exercises `/api/rh2/cpd` CRUD, cross-user 404 isolation, summary) |
| any test targeting `/api/profile/cpd` (System B) | **none exists** — confirmed tonight by `grep -rl "profile/cpd" tests/ tests/integration/`, zero hits anywhere. Files that `require('./profile-routes')` (`documents.itest.js`, `credential-scans.itest.js`, `stage2-pilot-readiness.itest.js`, `audit.itest.js`, `readonly-and-hardening.itest.js`) exercise documents/credentials paths only, never CPD. |

## Commits in window touching located files

None. Neither `resource-hub-r2-routes.js` nor `profile-routes.js` appears in
`git diff --stat 15acf0c..338f5dc`.

## Open tracker tasks

None recorded directly against this feature (tasks array is empty in the
snapshot). The gap below is the same one driving the "Review Portal
Structure" task on the Employee Personal Page card.

## Disagreement / notes

Agree with the prior claude_update and next_action: two unrelated systems
share the "CPD" name, and System B's approve/reject round trip has no
dedicated test anywhere — both independently reconfirmed tonight by direct
code read and fresh grep, not assumed from last night's note. No disagreement
with the tracker (stage `idea`, no over-claim to flag).
