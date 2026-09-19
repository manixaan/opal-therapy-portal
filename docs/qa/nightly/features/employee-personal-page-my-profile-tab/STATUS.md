# Employee Personal Page (My Profile Tab)

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since last audit (2026-09-17T18:21Z UTC): **no**
- Created (any located code): **yes**

## Located files

Re-verified fresh tonight — the ambiguity stands, and neither candidate surface was rebuilt since last night:

- **The "People" register** (best match for "one profile per person"): `frontend/current/employees.js` (`?v=1`) + `employees.css` (`?v=1`), mounted at the `EMPLOYEES TAB` banner (`mockup_v3.html:4153`) under **More → People**. Calls `/api/onboarding/employees` and `/api/onboarding/employees/:userId`, both served by `backend/onboarding-routes.js`. No commit touched `employees.js`/`.css` since the last audit.
- **The pre-existing "My Profile" tab** (the parenthetical in the tracker title): `backend/profile-routes.js` + `frontend/current/profile.js` (`PROFILE TAB`, `mockup_v3.html:4170`) — an individual's own personal record (leave, CPD, documents, credentials).

**Recency note:** commit `41a9e27` (Splose practitioner self-linking, landed today) made a small edit inside `profile-routes.js`'s `GET /api/profile/setup-status` handler — it widens which roles get told to link their Splose practitioner (`isTherapist && ...` → `r.role !== 'read_only' && ...`). This is a role-logic fix inside an existing endpoint, not a structural change to the My Profile tab or its guard, and does not move this feature's evidence.

## Guard check

`onboarding-routes.js:50` — `router.use('/api/onboarding', requireAuth)`, plus `requirePermission('onboarding.view')` on both `/api/onboarding/employees` and `/api/onboarding/employees/:userId`. No unguarded route found. (`profile-routes.js`'s guard pattern is covered under the Professional Development folder's audit, not repeated here.)

## Tests run

Re-run fresh tonight, no code changed here since the last audit:

- No dedicated `employees*.test.js` unit file exists. The version pin is asserted in `backend/tests/assessment-surface-guards.test.js` (`['employees.js', 1], ['employees.css', 1]`) — **PASS**, run as part of the full 82/82 guard suite tonight, current pins agree.
- No E2E spec and no `docs/qa/BROWSER_QA_RESULTS.md` entry proves the Employees tab (or the My Profile tab) itself renders in a browser. Flows C and I in `BROWSER_QA_RESULTS.md` (2026-08-01) only touch the post-registration setup card and "profile sections render" at a surface level — neither is a dedicated pass over either candidate tab.

No TODO/FIXME found in `frontend/current/employees.js` or `profile.js`.

## Disagreement

None in the strict sense. Worth flagging again: the tracker title conflates two different tabs, and the audit still cannot tell which one the practice actually meant — see "Start here."
