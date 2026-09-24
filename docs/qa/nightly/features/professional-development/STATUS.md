# Professional Development

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window (2026-09-23 → 2026-09-24): no — zero commits landed in this window at all
- Created (any located code): yes — split across two other subsystems, no dedicated PD subsystem exists

## Located files

No standalone PD route/data-access file and no dedicated table (migration 029 only extends the pre-existing `pd_events` table). Split across:

- Admin-curated PD events catalogue, a sub-feature of the Resource Hub: `backend/resource-hub-r2-routes.js` (`pd_events` CRUD, `GET /api/rh2/pd`, `/api/rh2/pd/:id`, owner/admin-only writes)
- Employee-facing CPD records, in My Profile: `backend/profile-routes.js` (`/api/profile/cpd` GET/POST/`:id/approve`/`:id/reject`/DELETE)
- Frontend: `frontend/current/profile.js` (My Profile CPD UI), `frontend/current/resourcehub.js` (admin PD catalogue UI, layered into the Resources tab, no separate PD tab banner)

## Guard check

`profile-routes.js`: CPD routes individually carry `requireAuth`; approve/reject gated by `canApprove()` (owner-only, in-handler). `resource-hub-r2-routes.js`: `router.use('/api/rh2', requireAuth, ...)` blanket guard, PD write routes additionally check `canAuthor()` (owner/admin). No guard defects found.

## Tests (re-run fresh tonight)

- Unit: `pd-catalogue-guards.test.js` — run tonight bundled with other feature areas, 0 failures. No dedicated CPD-specific unit test file for `profile-routes.js`'s CPD routes — coverage folds into the broader guard-test suites.
- Integration: `resource-hub-r2.itest.js` (contains a dedicated `describe('PD events', ...)` block exercising create/patch/delete/list, 403 for therapist create, 400 for bad `mode`, org-scoping) — run tonight in the PD/Profile + Inductions/Resources batch, 0 failures. No CPD-specific integration test identified by name for the My Profile side.
- Browser/E2E: `docs/qa/BROWSER_QA_RESULTS.md` row I ("Leave/CPD/documents") — sections render, disabled features honestly read "Coming soon"/"Preview only — not saved" (meaning some CPD/document functionality is intentionally stubbed in the build tested, not broken). This is the only browser evidence and it predates most of the window's work; it covers the My Profile CPD half only, not the Resource-Hub PD-catalogue half, which has zero browser evidence of any kind.

## Open tasks from the tracker

None recorded — "Professional Development" has no tasks, only the bare feature title.

## Commits in the window that touched it

None — `develop` sits on `74601fc` again tonight. Re-verified fresh: both halves' tests re-run tonight with identical (passing) results — no regression.

## Disagreement

None — too little in the tracker to disagree with. Worth flagging to the team that this card has no tasks and no notes, while real, working (if split across two subsystems) code already exists for it.
