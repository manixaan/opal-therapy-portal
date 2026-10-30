# Employee Personal Page (My Profile Tab)

- Tracker stage: idea · Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed since the last audit: **no** — the window `15acf0c..338f5dc` (5 commits,
  verified by `git log`/`git diff --stat`) touches only `backend/routes.js`,
  `backend/database.js`, `backend/mobile-routes.js`, `backend/ai/ai-audit.js`,
  `backend/case-note-routes.js`, and travel/case-notes frontend + tests. None
  touch `backend/profile-routes.js` or any file behind the My Profile tab.
- Created (any located code): yes.

## Located

`backend/profile-routes.js` (1351 lines) — full My Profile backend: leave
(`/api/profile/leave`, `/leave/:id/approve`, `/leave/:id/reject`, `/leave/:id`
DELETE), CPD (`/api/profile/cpd`, `/cpd/:id/approve`, `/cpd/:id/reject`,
`/cpd/:id` DELETE — same System B as the Professional Development card),
documents (`/api/profile/documents*`, download, delete), credentials
(`/api/profile/credentials*`, scans, extraction, verify), work-schedule,
notification-prefs, setup-status, credential-reminder dismiss. Mounted at
`backend/server.js:497`. Frontend: `frontend/current/profile.js`. Tab banner:
`PROFILE TAB` at `mockup_v3.html:4315` (shifted from `:4307` by the unrelated
travel/case-notes edits in this window — same tab, no content change).

## Guard check

`requireAuth` on every route (confirmed by grep: 29/29 handlers). Leave/CPD
approve/reject and document download/delete use an inline `canApprove(user)`
/ `canViewAll(user)` check (owner-only) rather than `permissions.js`
`requirePermission`/`requireRole` middleware — a convention deviation from
`.claude/rules/backend-api.md`, not a missing guard; it returns 403 correctly.
Flagged for a human, not reported as broken.

## Tests and results

| Command | Result |
|---|---|
| `npx jest tests/credential-surface-guards.test.js` | PASS — 28/28 |
| `npx jest tests/smart-route-backend.test.js` | PASS — 13/13 |
| `tests/integration/documents.itest.js` | PASS — 3/3 |
| `tests/integration/credential-scans.itest.js` | PASS — 22/22 |
| `tests/integration/stage2-pilot-readiness.itest.js` | PASS — 12/12 |
| `tests/integration/audit.itest.js` | PASS — 5/5 |
| `tests/integration/readonly-and-hardening.itest.js` | **1 FAILED, 4 passed, 5 total** — `D-6/D-7: storage failure behaviour` expects a `chmod 0o000` directory to make a document write fail with 5xx. The sandbox runs as `root`, so the chmod has no effect on the process's own access and the write succeeds. Environment artifact of running as root, not a `profile-routes.js` regression — unrelated to the leave/CPD gap below. |

All of the above exercise `profile-routes.js` only for documents/credentials
paths; none call `/api/profile/leave*` or `/api/profile/cpd*` as an HTTP
target.

**Leave and CPD submit→approve→reject: no dedicated test anywhere**, confirmed
tonight by `grep -rl "profile/leave\|profile/cpd" tests/` across unit and
integration suites — only hit is `tests/onboarding-security.test.js:40`, a
`isPreEmployeePath('/api/profile/leave')` allowlist unit assertion, never an
HTTP call to the route.

## Commits in window touching located files

None. `profile-routes.js`, `profile.js` and the `PROFILE TAB` block in
`mockup_v3.html` are untouched in `15acf0c..338f5dc`.

## Open tracker tasks

`[todo]` "Review Portal Structure" — a manual click-through checklist
(personal details, work locations, leave↔owner round trip, PD credentials/
documents↔owner round trip, notifications). Still open; no commit or test in
this window advances it.

## Disagreement / notes

Agree with the prior claude_update and next_action: credentials/documents/
work-location sections have real (if indirect) test coverage; the leave +
CPD submit→approve→reject round trip genuinely has no dedicated test, and
tonight's independent grep reconfirms it rather than just trusting last
night's note. No disagreement with the tracker (stage is `idea`, so no
over-claim to flag).
