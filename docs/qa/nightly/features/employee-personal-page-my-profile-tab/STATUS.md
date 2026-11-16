# Employee Personal Page (My Profile Tab)

- Tracker stage: idea | Tracker environment: none
- Evidence label: **built-untested**
- Created: yes
- Addressed this window: no

## Located files
- Backend: profile-routes.js (31 requireAuth refs — leave, CPD, documents, credentials, work-schedule,
  notification-prefs, setup-status routes)
- Frontend: frontend/current/profile.js — confirmed real fetch() calls to /api/profile/leave and
  /api/profile/cpd (submit + approve + reject), not placeholders.

## Guard check
requireAuth at every route; leave/CPD approve+reject additionally gated by inline
`canApprove(req.user)` role check (file's own header documents this as deliberate HR-style RBAC,
2026-08-06). No unguarded route found (re-confirmed tonight).

## Tests (re-run fresh tonight)
- No dedicated leave/CPD round-trip test exists anywhere. Re-grepped tonight for
  updateLeaveStatus / leave_request / profile/leave / profile/cpd across every unit test file —
  found only an incidental route-list mention (onboarding-security.test.js) and an unrelated
  availability-engine fixture insert (scheduler-availability.itest.js). Confirms the gap is real.
- Ran tests/integration/readonly-and-hardening.itest.js + audit.itest.js
  (DB_NAME=therapy_scheduler_audit_profile): 9/10 pass, 1 FAIL.
  **Failing test** (readonly-and-hardening.itest.js, D-7, line 121): expects an unwritable storage
  directory (chmod 0o000) to make a document upload fail with 5xx. This sandbox runs as root, and
  root bypasses Unix permission bits, so the write succeeds (201) instead of failing — the same
  confirmed **environment artifact** as last night, not an application defect. The paired D-6 check
  (missing storage object → 404) in the same test passes correctly.
- Tab coverage: docs/qa/BROWSER_QA_RESULTS.md section I — render-level only, not the approval round
  trip, unchanged since last night.

## Open tasks (from tracker)
- "Review Portal Structure" — todo.

## Commits in window touching this
None.

## Disagreement
None directionally — code is extensively built; the gap (missing round-trip test) matches what the
tracker itself already says.

## Note
No change from the 2026-11-15 audit. Re-verified fresh tonight: same code, same tests, same result.
