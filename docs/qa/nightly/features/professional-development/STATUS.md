# Professional Development

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since last audit (2026-09-18T19:20Z UTC, commit `0726dde`): **no** — none of tonight's
  7 commits touch `resource-hub-r2-routes.js` or `profile-routes.js`
- Created (any located code): **yes** — two separate, unconnected implementations both answer to
  "Professional Development"

## Located files

- **Resource Hub PD catalogue** — `backend/resource-hub-r2-routes.js` `/api/rh2/pd*` plus a
  personal, self-scoped **CPD tracker** at `/api/rh2/cpd*`. Frontend: `frontend/current/resourcehub.js`.
- **My Profile CPD workflow** — `backend/profile-routes.js` `/api/profile/cpd*` and
  `/api/profile/documents*`. Frontend: `frontend/current/profile.js`.

These two do not share a table, an endpoint, or an approval workflow. `git log 0726dde..HEAD
--oneline -- backend/resource-hub-r2-routes.js backend/profile-routes.js
frontend/current/resourcehub.js frontend/current/profile.js` — empty. Untouched tonight.

## Guard check

- `resource-hub-r2-routes.js`: `router.use('/api/rh2', requireAuth, ...)` with `canAuthor`
  (owner/admin) gating every PD-event write; the personal CPD log's routes are legitimately
  self-scoped (own-only). No unguarded route found.
- `profile-routes.js`: every route mounts `requireAuth` individually, with `canApprove(req.user)`
  gating the two approve/reject endpoints in-body. No unguarded route found.

## Tests run

- `resource-hub-r2.itest.js`, re-run tonight in isolation (`DB_NAME=therapy_scheduler_n4c`) —
  **PASS 33/33**, including the dedicated PD-events and CPD-tracker describe blocks.
- The My Profile half — re-run fresh tonight rather than assumed: unit
  `credential-surface-guards.test.js` + `security.test.js` — **PASS 36/36** (2 suites); integration
  `audit.itest.js`, `credential-scans.itest.js`, `documents.itest.js`,
  `stage2-pilot-readiness.itest.js` (`DB_NAME=therapy_scheduler_n4c`) — **PASS 42/42** (4 suites).
- No test proves the two systems' relationship (or lack of one) — nothing connects them.
- No TODO/FIXME found in `resource-hub-r2-routes.js` or `profile-routes.js`.

## Disagreement

There is dedicated, guarded, passing-tonight code for both halves. But it does not resolve the
ambiguity the tracker card asks about: there are two disconnected features both named
"Professional Development"/"CPD", with different data models and different approval semantics,
both reachable from the UI. The evidence label stays `tab-unproven`: the API layer is now directly
tested for both halves, but no browser/E2E check exists for either the Resource Hub PD page or the
My Profile CPD section, and the duplication itself is unresolved. Tracker stage `idea` still
understates what exists.
