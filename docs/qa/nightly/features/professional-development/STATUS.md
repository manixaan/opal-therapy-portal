# Professional Development

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed this window: **no** — zero commits since 2026-10-07 touching `backend/` or `frontend/current/`.
  Eighth consecutive reconfirmation night.
- Created (any located code at all): **yes**

## Located files
- `backend/resource-hub-r2-routes.js` — PD events catalogue CRUD (`/api/rh2/pd*`, `/api/rh2/cpd*`)
- `backend/profile-routes.js` — personal CPD log + PD evidence documents (`/api/profile/cpd*`,
  `/api/profile/documents*`)
- `backend/database.js` — `createCPDActivity`/`updateCPDStatus`/`deleteCPDActivity`
- Frontend: PD sub-view inside `<!-- RESOURCES TAB (Resource Hub R1) -->` (mockup_v3.html:4954), rendered by
  `frontend/current/resourcehub.js` (`#resources/pd`); personal CPD log inside `<!-- PROFILE TAB -->`
  (mockup_v3.html:4188), `frontend/current/profile.js`

## Guard check
`/api/rh2/*` sits behind `router.use('/api/rh2', requireAuth, flagGate)`; PD write routes additionally check
`canAuthor(req.user)` inline, returning 403 for non-admin/owner — consistent with the rest of
`resource-hub-r2-routes.js`'s house pattern (no gap). `profile-routes.js`'s CPD routes carry the same
`requireAuth` + inline `canApprove`/`canViewAll` pattern already reviewed under Employee Personal Page. No gaps
found.

## Tests run tonight
- unit: `pd-catalogue-guards.test.js` (run as part of a 12-file Resource Hub + profile-guard batch) — 46 of the
  batch's tests belong to this file specifically; full batch: 444 passed, 12 skipped, 0 failed
- integration: `resource-hub-r2.itest.js` (RBAC for PD events, run as part of a 6-file Resource Hub batch) —
  133/133 pass for the full batch

## Open tasks (from the tracker)
(no tasks recorded in the tracker — the card has a title only)

## Compare with the tracker
Significant, unchanged from prior nights: the tracker card has stage "idea" and zero recorded sub-tasks, implying
nothing has started. In reality this is a fully built, tested feature (PD events catalogue + personal CPD log)
with its own tab, admin authoring UI and a Home-page preview card. Recommend the team add this as a proper
feature card with its own idea/why text, or confirm it should be merged into the existing Resource Hub tracking.
