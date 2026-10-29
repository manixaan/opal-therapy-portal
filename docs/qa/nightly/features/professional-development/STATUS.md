# Professional Development

- Tracker stage: idea · Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed since the last audit (develop unchanged since 2026-10-28, also commit `15acf0c`): no — neither system's CPD-specific code was touched (the files were touched for unrelated reasons; see below).
- Created (any located code): yes, two separate systems.

## Located

Two unrelated systems share only the name "CPD" — confirmed by reading both directly (different tables, different access models):

- **System A — Resource Hub self-logged CPD tracker:** `backend/resource-hub-r2-routes.js` (~lines 2304-2399), `/api/rh2/cpd` (GET/POST), `/api/rh2/cpd/:id` (PATCH/DELETE), `/api/rh2/cpd/summary`. Backs onto `cpd_entries`. Code comment: "own entries only, every role" — informational self-tracking, no approval step, OT Board CPD compliance remains the practitioner's own responsibility.
- **System B — My Profile CPD submit/approve/reject:** `backend/profile-routes.js` (lines 204-312), `/api/profile/cpd` (GET/POST), `/api/profile/cpd/:id/approve`, `/api/profile/cpd/:id/reject`, `/api/profile/cpd/:id` (DELETE). Backs onto a different table via `db.createCPDActivity`/`updateCPDStatus`/`getCPDActivities`.

## Guard check

System A: `/api/rh2` requireAuth + self-scoping (`user_id = $1`) — self-scoped by design.
System B: approve/reject routes use `requireAuth` + an inline `canApprove(req.user)` check (`role === 'owner'`), not the `requirePermission`/`requireRole` middleware pattern `.claude/rules/backend-api.md` calls for. This functions correctly (403 for non-owner/unauthenticated) but bypasses the audited `permissions.js` role table — a convention deviation worth a human eye, not a missing guard.

## Tests and results

| Command | Result |
|---|---|
| `npx jest tests/pd-catalogue-guards.test.js` | PASS — 46 tests (System A catalogue/eligibility) |
| `resource-hub-r2.itest.js` (part of the Clinical-resources integration run) | PASS — exercises `/api/rh2/cpd` CRUD |
| any test targeting `/api/profile/cpd` (System B) | **none exists** — confirmed by `grep -n "profile/cpd" tests/*.test.js tests/integration/*.itest.js`, zero hits. Several files `require` `profile-routes.js` incidentally for documents/credentials, never for CPD. |

## Commits in window touching located files

`backend/profile-routes.js` touched by `74444eb feat(onboarding): wizard data lands where the portal reads it` — an onboarding-focused commit, not a CPD change. `resource-hub-r2-routes.js` touched by the resource-library commits (CPD section not specifically mentioned).

## Open tracker tasks

None recorded directly against this feature (the "Review Portal Structure" task sits under Employee Personal Page and is the same underlying gap).

## Disagreement / notes

Agree with the prior claude_update on both claims: two unrelated systems share the "CPD" name, and System B's approve/reject round trip has no dedicated test anywhere — both independently confirmed.
