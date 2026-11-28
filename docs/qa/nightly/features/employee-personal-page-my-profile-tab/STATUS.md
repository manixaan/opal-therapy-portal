# Employee Personal Page (My Profile Tab)

Tracker stage: idea · Tracker environment: none
Evidence label: **built-untested**
Addressed since last audit (2026-11-26, commit `f5fc28d`): no — zero new commits tonight
Created (any located code): yes

## Located files
`backend/profile-routes.js` (leave, CPD, documents, credentials, work-schedule,
notification-prefs, setup-status), `frontend/current/profile.js`, `PROFILE TAB` in
`mockup_v3.html`.

## Guard check
Router-level `requireAuth`. Verified directly: the two owner-approval actions
(`leave/:id/approve|reject`, `cpd/:id/approve|reject`) are gated by
`canApprove(user) { return user?.role === 'owner'; }` — an explicit, documented
2026-08-06 RBAC decision ("Admin's remit is scheduling + travel; approvals are
practice management") that deliberately excludes admin, not just a generic
owner-or-admin check. Personal GET/PUT endpoints filter by `req.user.id`. No
missing guards found.

## Tests and results (run tonight)
- Unit: no dedicated `profile-*.test.js` file exists. Guard-only coverage via
  `credential-surface-guards.test.js`, `security.test.js`, `smart-route-backend.test.js`,
  `frontend-stage2-guards.test.js`, `frontend-stage3-guards.test.js`,
  `onboarding-security.test.js` — 6 suites / **404 passed** — but these exercise
  generic permission-boundary / path-allowlist behaviour, not the leave/CPD
  workflow itself.
- Integration (`DB_NAME=therapy_scheduler_audit`): `credential-scans.itest.js` +
  `documents.itest.js` = 2 suites / **25 passed**. `audit.itest.js` +
  `stage2-pilot-readiness.itest.js` = 2 suites / **17 passed**.
  `readonly-and-hardening.itest.js` = **4 passed, 1 FAILED**
  ("D-6/D-7: storage failure behaviour ... write failure → 5xx with NO orphaned
  row" — the test `chmod`s a directory to `0o755` expecting the write to then
  fail, but this sandbox runs as root, which ignores Unix permission bits, so
  the upload succeeds (201) instead of failing. **Confirmed independently
  tonight by re-running the file** — environment artifact, not a code defect,
  same category as the OCR-package failure under Portal Onboarding Workflow.
- **Confirmed gap, grepped across every test file in the repo**: no unit or
  integration test anywhere calls `updateLeaveStatus`/`updateCPDStatus`, or
  exercises `/api/profile/leave/:id/approve|reject` or
  `/api/profile/cpd/:id/approve|reject`. The single functionally most important
  part of this card — the owner approval round trip for leave and CPD — has
  zero automated proof.
- `node --check`: OK. No TODO/FIXME found.

## Frontend wiring (verified, not assumed)
`profile.js` genuinely calls `fetch('/api/profile/leave'...)`,
`/api/profile/leave/:id/approve|reject`, `/api/profile/cpd`,
`/api/profile/cpd/:id/approve|reject` — real, wired functionality, not a
placeholder.

## Browser/tab evidence
`docs/qa/BROWSER_QA_RESULTS.md` row I confirms the profile sections *render*
and disabled features correctly read "Coming soon"/"Preview only — not saved"
(those strings belong to unrelated disabled features elsewhere on the page,
confirmed by grep) — it does not exercise the leave/CPD approval round trip.

## Open tasks from the tracker
- **Review Portal Structure** (todo) — a full hands-on walkthrough checklist
  including submitting a leave request and having the owner approve/reject it,
  and the same round trip for CPD. This is exactly the round trip that has no
  automated coverage.

## Disagreement
None on stage. Shares its core gap with "Professional Development" — see that
card's note about merging or re-scoping.

## Commits since last audit (2026-11-26, commit f5fc28d)
None touch `profile-routes.js`.
