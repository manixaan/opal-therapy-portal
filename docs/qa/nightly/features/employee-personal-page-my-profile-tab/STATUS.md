# Employee Personal Page (My Profile Tab)

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed in change window (since last audit, 2026-10-23): no — zero commits in the window; develop is frozen at the same commit audited last night
- Created (code exists): yes

## Located files
- Backend: `backend/profile-routes.js` (1301 lines) — handles personal details, work locations, leave, CPD, documents/credentials, notifications, setup-status.
- Frontend: `frontend/current/profile.js`, `PROFILE TAB` banner in `mockup_v3.html` (line ~4295).

## Guard check
Every route uses `requireAuth`. Sensitive actions (leave/CPD approve, reject, credential verify) are additionally gated inline via `canApprove(req.user)` (owner-only) — correctly enforced. `work-schedule/:userId` also requires `requirePermission('view_all_travel')`. Not a defect.

## Tests and results
- Documents + credentials: `tests/integration/readonly-and-hardening.itest.js`, `tests/credential-surface-guards.test.js`, `tests/credential-extraction.test.js`, `tests/integration/credential-scans.itest.js`, `tests/integration/documents.itest.js`.
  - **Same single failure observed again tonight (2026-10-24)**, exactly as on 2026-10-16 through -23: `readonly-and-hardening.itest.js`, test "D-6/D-7: storage failure behaviour ... write failure → 5xx with NO orphaned row" — expected ≥500 on an unwritable storage directory (`chmod 0o755` restore after `fs.chmodSync`), got 201. **Likely cause: this sandbox runs the test process as root (`uid=0`), and Linux root bypasses file-permission bits, so the simulated write failure never actually happens here.** This is very likely an environment artifact of the nightly sandbox, not a proven application defect — it still has not been independently re-verified under a non-root runner, so it continues to be reported as observed rather than explained away. The other 692 tests in tonight's integration batch passed (plus `onboarding.itest.js`'s 49, run separately — 741/742 passed overall).
  - Unit tests (credential-surface-guards, credential-extraction) and integration (credential-scans, documents) — all pass (re-run tonight, 2026-10-24).
- Work-schedule: `tests/smart-route-backend.test.js`, `tests/travel-work-location-gate.test.js` — pass.
- **Leave requests and CPD (My Profile) submit→approve→reject: no dedicated test file found anywhere** in `backend/tests/` or `backend/tests/integration/` (confirmed by grep for the handler names). This matches the tracker's own next_action.
- No E2E spec for the Profile tab. Browser QA row I (`docs/qa/BROWSER_QA_RESULTS.md`) only confirms the Leave/CPD/documents sections *render* (3/3) — it does not exercise the approve/reject workflow.
- No TODO/FIXME found in `profile-routes.js`.

## Open tasks from the tracker
"Review Portal Structure" (manual QA checklist, status todo) — a human walkthrough task, not a coding task.

## Commits in window that touched it
None (zero commits since last audit).

## Disagreement
None on tracker stage (card doesn't claim more than "idea"). The gap is real and matches the tracker's own next_action: the leave/CPD approve-reject round trip has no test.
