# Employee Personal Page (My Profile Tab)

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since last audit (2026-09-18T19:20Z UTC, commit `0726dde`): **no**
- Created (any located code): **yes**

## Located files

Re-verified fresh tonight (commit `cec0a03`) — the ambiguity stands, and neither candidate surface
was touched since last night:

- **The "People" register** — `frontend/current/employees.js`/`.css` (`?v=1`), mounted at the
  `EMPLOYEES TAB` banner (now `mockup_v3.html:4167`, was 4153 — a cosmetic +14 line shift from
  tonight's unrelated theme commit `fc769fe`, content identical). Calls
  `/api/onboarding/employees` and `/api/onboarding/employees/:userId`, served by
  `backend/onboarding-routes.js`.
- **The pre-existing "My Profile" tab** — `backend/profile-routes.js` +
  `frontend/current/profile.js` (`PROFILE TAB`, now `mockup_v3.html:4184`, same cosmetic shift).
- `git log 0726dde..HEAD --oneline -- frontend/current/employees.js frontend/current/employees.css
  backend/onboarding-routes.js backend/profile-routes.js frontend/current/profile.js` — empty.
  Untouched tonight.

## Guard check

`onboarding-routes.js:50` — `router.use('/api/onboarding', requireAuth)`, plus
`requirePermission('onboarding.view')` on both `/api/onboarding/employees` and
`/api/onboarding/employees/:userId`. No unguarded route found.

## Tests run

Re-run fresh tonight, no code changed here since last audit:

- No dedicated `employees*.test.js` unit file exists. The version pin is asserted in
  `backend/tests/assessment-surface-guards.test.js` — **PASS**, run as part of the full 82/82
  guard suite tonight, current pins agree.
- No E2E spec and no `docs/qa/BROWSER_QA_RESULTS.md` entry proves the Employees tab (or the My
  Profile tab) itself renders in a browser. No new artifact appeared tonight.

No TODO/FIXME found in `frontend/current/employees.js` or `profile.js`.

## Disagreement

None in the strict sense. The tracker title still conflates two different tabs, and the audit
still cannot tell which one the practice actually meant — see START.md.
