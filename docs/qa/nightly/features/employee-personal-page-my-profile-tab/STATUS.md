Feature: Employee Personal Page (My Profile Tab)
Tracker stage: idea
Tracker environment: none
Evidence label: needs-refinement
Addressed in change window (2026-10-02 to 2026-10-16): no
Created (any located code): yes

## Located files
`backend/profile-routes.js` — every route guarded by `requireAuth`; the
leave and CPD approval routes, and the credential-verify route, add an
inline `canApprove()` check. Frontend: `PROFILE TAB` banner confirmed at
`frontend/current/mockup_v3.html:4188`.

## Guard check
Pass.

## Tests run
- Unit: `credential-extraction`, `credential-surface-guards` → 2 suites /
  62 tests, all PASS. No unit test file exists for `profile-routes.js`
  itself.
- Integration (`DB_NAME=therapy_scheduler_audit`): `documents.itest.js`,
  `credential-scans.itest.js`, `audit.itest.js`,
  `readonly-and-hardening.itest.js` → **13 suites: 12 passed, 1 FAILED.
  152 tests: 151 passed, 1 FAILED.**
  - Failing test: `readonly-and-hardening.itest.js` → "D-6/D-7: storage
    failure behaviour (local backend) › missing storage object → 404;
    write failure → 5xx with NO orphaned row" — expected status ≥ 500,
    got 201.
    **Root cause: an environment artifact, not a code defect.** The test
    simulates a storage write failure with `fs.chmodSync(dir, 0o000)` to
    make a directory unwritable. This sandbox's test process runs as
    root (confirmed via `ps aux`), and root bypasses Linux directory
    permission bits, so the write succeeds instead of failing. The other
    half of the same test (missing object → 404) passed. This same file
    also covers, and passed: read-only users blocked from writing,
    non-UUID `:id` → 404 not 500, denied cross-user document access being
    audited, and credential-verify 404 for a bad id.
  - **Zero test coverage anywhere** (unit or integration) for
    `/api/profile/leave` or `/api/profile/cpd`.

## Browser / E2E evidence
`docs/qa/BROWSER_QA_RESULTS.md` flow I covers generic rendering ("Setup
card + profile sections render; no fake-success strings; disabled
features read 'Coming soon'/'Preview only'") but this is not the
detailed, click-every-button review the tracker's own task explicitly
asks for (personal details, work locations, leave, PD, credentials, PD
documents, notifications, each individually verified and cross-checked
against the matching owner-portal workflow).

## Open tasks from tracker
- Review Portal Structure [todo] — a hands-on browser click-through
  review, not a coding task; this audit cannot perform it.

## Commits in window touching this feature
None.

## Disagreement with tracker
None.
