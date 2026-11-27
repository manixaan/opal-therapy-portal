# Employee Personal Page (My Profile Tab)

Tracker stage: idea · Tracker environment: none
Evidence label: **built-untested**
Addressed since last audit (2026-11-26, commit `f5fc28d` — unchanged, zero new commits tonight): no
Created (any located code): yes

## Located files

`backend/profile-routes.js` (leave, CPD approval, documents, credentials, work-schedule,
notification preferences). Tab: `============ PROFILE TAB ============`
(`mockup_v3.html:4660`). Frontend: `profile.js`.

## Guard check

`requireAuth` + inline `canApprove(user) => user.role === 'owner'` for leave/CPD approve and
reject — correctly owner-gated, documented as an explicit 2026-08-06 RBAC decision (admin
deliberately excluded from approvals). No unguarded route found.

## Tests

- Unit: no dedicated `profile-*.test.js` file exists. Guard-only coverage via
  `credential-surface-guards.test.js`, `frontend-stage2-guards.test.js`,
  `frontend-stage3-guards.test.js`, `onboarding-security.test.js`, `security.test.js`,
  `smart-route-backend.test.js` — **6/6 suites, 399/399 tests passed** (these assert the route
  is guarded; they do not exercise the leave/CPD functionality itself).
- Integration: `audit.itest.js`, `credential-scans.itest.js`, `documents.itest.js`,
  `stage2-pilot-readiness.itest.js` — all passed. `readonly-and-hardening.itest.js` — 1 of its
  tests failed ("D-6/D-7: storage failure behaviour... write failure → 5xx with NO orphaned
  row"): the test `chmod`s a directory to `0o755` expecting the write to then fail, but this
  sandbox runs as `root`, which ignores Unix permission bits — the upload succeeds (201) where
  a non-root process would get a permission error. **Confirmed environment artifact, not a
  code defect** (same category as `onboarding-document-reader.test.js`'s missing OCR model
  file). Every other assertion in that file passed.
- **Confirmed gap, grepped across every integration test file**: no integration test anywhere
  calls `/api/profile/leave/:id/approve`, `/reject`, `/api/profile/cpd/:id/approve`, or
  `/reject`. The single most functionally important part of this feature — the owner
  approval round trip for leave and CPD — has zero automated proof.
- Browser/E2E: `docs/qa/BROWSER_QA_RESULTS.md` row I (2026-08-01) confirms the profile sections
  *render* and disabled features correctly read "Coming soon"/"Preview only — not saved" — it
  does not exercise the approval round trip either.

## Open tasks (from tracker)

- Review Portal Structure — todo. A full hands-on walkthrough checklist: personal details,
  work locations + 24-hour reminder, leave + owner approval, CPD credentials/documents + owner
  approval, notifications, every button. This is exactly the round trip that has no automated
  coverage.

## Commits since last audit (2026-11-26)

None touch `profile-routes.js`.

## Disagreement

None on stage. Shares its core gap with "Professional Development" — see that card's note
about merging or re-scoping.
