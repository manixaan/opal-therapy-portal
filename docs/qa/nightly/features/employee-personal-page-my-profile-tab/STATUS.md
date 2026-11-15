# Employee Personal Page (My Profile Tab)

- Tracker stage: idea | Tracker environment: none
- Evidence label: **needs-refinement**
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
2026-08-06). No unguarded route found.

## Tests
- No dedicated leave/CPD round-trip test exists anywhere. Grepped for updateLeaveStatus / leave_request
  / profile/leave / profile/cpd across every test file — found only an incidental route-list mention
  (onboarding-security.test.js) and an unrelated availability-engine fixture insert
  (scheduler-availability.itest.js). This confirms the tracker's own next_action: the gap is real.
- Ran tests/integration/readonly-and-hardening.itest.js + audit.itest.js
  (DB_NAME=therapy_scheduler_audit_profile): 9/10 pass, 1 FAIL.
  **Failing test** (readonly-and-hardening.itest.js, D-7, line 121): expects an unwritable storage
  directory (chmod 0o000) to make a document upload fail with 5xx and leave no orphaned row. In this
  sandbox the test runs as root (confirmed via `whoami`/`id` → uid=0), and root bypasses Unix
  permission bits, so the write succeeds (201) instead of failing. This is a confirmed **environment
  artifact**, not an application defect — the paired D-6 check (missing storage object → 404) in the
  same test passes correctly. Flag for the team: this test needs a non-root runner or a failure-
  injection mock to be meaningful here.
- Tab coverage: docs/qa/BROWSER_QA_RESULTS.md section I — "Leave/CPD/documents: setup card + profile
  sections render; no fake-success strings; disabled features honestly labelled" — 3/3 pass
  (render-level only, not the approval round trip).

## Open tasks (from tracker)
- "Review Portal Structure" — todo.

## Commits in window touching this
None.

## Disagreement
None directionally — code is extensively built; the gap (missing round-trip test) matches what the
tracker itself already says.
