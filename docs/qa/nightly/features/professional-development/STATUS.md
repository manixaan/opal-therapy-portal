# Professional Development

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since last audit (2026-09-18T02:05Z UTC baseline `b6a8ad4`): **no** — the code that matters
  here (`backend/resource-hub-r2-routes.js`) has only 2 commits total in its whole history
  (`6273803`, `2d9cd10`), neither since `b6a8ad4` and neither about PD/CPD specifically. None of
  tonight's ~20 learning/workshop/induction commits touch this feature.
- Created (any located code): **yes** — and there is more of it, and it is better tested, than last
  night's audit found

## Located files

Two separate, unconnected implementations both answer to "Professional Development" tonight:

- **Resource Hub PD catalogue** (not found by last night's audit) — `backend/resource-hub-r2-routes.js`
  `/api/rh2/pd*` (`GET /api/rh2/pd`, `GET /api/rh2/pd/catalogue`, `GET /api/rh2/pd/:id`,
  `POST`/`PATCH`/`DELETE /api/rh2/pd/:id`, admin/owner-authored, backed by a `pd_events` table) plus a
  personal, self-scoped **CPD tracker** at `/api/rh2/cpd*` (`GET`/`POST /api/rh2/cpd`,
  `PATCH`/`DELETE /api/rh2/cpd/:id`, `GET /api/rh2/cpd/summary` — Dec 1–Nov 30 registration-year
  aware, own-only, no approval step). Frontend: `frontend/current/resourcehub.js` — a full
  `rh2-page` under the `pd` nav item ("Professional development"), reached from the Resource Hub,
  plus a Home-page "Upcoming professional development" preview card.
- **My Profile CPD workflow** (found by last night's audit) — `backend/profile-routes.js`
  `/api/profile/cpd*` (log an activity, owner/admin `approve`/`reject` via in-body
  `canApprove(req.user)`) and `/api/profile/documents*` (PD evidence uploads). Frontend:
  `frontend/current/profile.js` — the "Professional development" / "CPD approvals" section of the
  My Profile tab.

These two do not share a table, an endpoint, or an approval workflow: the Resource Hub tracker is a
self-only log with no approve/reject step; the Profile tracker has one. Both are live and reachable
from the UI under the same name.

## Guard check

- `resource-hub-r2-routes.js`: `router.use('/api/rh2', requireAuth, ...)` at the router level, with
  `canAuthor(req.user)` (owner/admin) gating every PD-event write; the personal CPD log's read/write
  routes are legitimately self-scoped (own-only, enforced by `WHERE user_id = $current` patterns) and
  need no extra role check. No unguarded route found.
- `profile-routes.js`: every route mounts `requireAuth` individually, with `canApprove(req.user)`
  gating the two approve/reject endpoints in-body — the same idiom used elsewhere in this codebase
  (`accounting-routes.js`'s `ownerOnly`, `onboarding-routes.js`'s `ownerOnly` helper), not an isolated
  gap. No unguarded route found.

## Tests run

- `backend/tests/integration/resource-hub-r2.itest.js`, re-run tonight in isolation
  (`DB_NAME=therapy_scheduler_inductions_audit2`, to avoid the cross-session DB contention described
  below) — **33/33 passed**, including a dedicated `describe('PD events', ...)` block (create/list/
  patch/delete, 403 for non-admin, 400 for a bad `mode`, past-vs-upcoming filtering — 6 assertions)
  and a dedicated `describe('CPD tracker', ...)` block (own-only across users, registration-year
  summary math — 2 tests). This is real, direct, passing coverage of the Resource Hub half of PD
  that last night's audit did not find at all.
- The My Profile half is still only incidentally exercised, exactly as last night:
  `credential-surface-guards.test.js`, `security.test.js`, `audit.itest.js`,
  `credential-scans.itest.js`, `documents.itest.js`, `stage2-pilot-readiness.itest.js` — not
  re-run tonight since nothing in `profile-routes.js` or its dependents changed since the last audit
  (verified via `git log b6a8ad4..HEAD -- backend/profile-routes.js`, empty) and this feature carries
  no new risk to re-verify against; last night's pass results stand.
- No dedicated test proves the two systems' *relationship* (or lack of one) — nothing asserts that a
  CPD entry logged in one place is or isn't visible in the other, because nothing connects them.
- No TODO/FIXME found in `resource-hub-r2-routes.js` or `profile-routes.js`.

## Disagreement

Last night's audit judged this `tab-unproven` on the basis of one file (`profile-routes.js`) with
only incidental test coverage, and could not tell if the tracker item mapped to real code at all.
Tonight's find of `resource-hub-r2-routes.js`'s dedicated, well-tested PD catalogue and CPD tracker
answers "is there a real home" with yes — there is dedicated, guarded, passing-tonight code, and it
significantly predates this feature's tracker entry. But it does not resolve the ambiguity the task
asked about: there are now two disconnected features both named "Professional Development" /
"CPD", with different data models and different approval semantics, both reachable from the UI. The
evidence label stays `tab-unproven` rather than moving to `proven`: the API layer is now directly
tested, but no browser/E2E check exists for either the Resource Hub PD page or the My Profile CPD
section, and the duplication itself is unresolved. Tracker stage `idea` still understates what
exists.

## A note on tonight's test environment

Mid-audit, a parallel nightly-audit session was confirmed (via `ps aux`, pid 2736) running its own
integration suites against the same shared `DB_NAME=therapy_scheduler_audit`. An initial Inductions
integration run against that shared name returned 78 failed / 52 passed, entirely `users_organisation_id_fkey`
violations from cross-session table truncation — not a real defect. All integration numbers in this
folder tonight (Inductions and this file) were taken from re-runs against session-private database
names (`therapy_scheduler_inductions_audit`, `_audit2`) to avoid that contention.
