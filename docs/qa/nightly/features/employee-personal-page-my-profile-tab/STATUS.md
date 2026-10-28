# Employee Personal Page (My Profile Tab)

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed in change window (since last audit, 2026-10-24): no — no commit this window touched `profile-routes.js` or `profile.js`
- Created (code exists): yes

## Located files
- Backend: `backend/profile-routes.js` (1301 lines) — handles personal details, work locations, leave, CPD, documents/credentials, notifications, setup-status.
- Frontend: `frontend/current/profile.js`, `PROFILE TAB` banner in `mockup_v3.html` (line ~4295).

## Guard check
Every route uses `requireAuth`. Sensitive actions (leave/CPD approve, reject, credential verify) are additionally gated inline via `canApprove(req.user)` (owner-only) — correctly enforced. `work-schedule/:userId` also requires `requirePermission('view_all_travel')`. Not a defect.

## Tests and results
- Documents + credentials: `tests/integration/readonly-and-hardening.itest.js`, `tests/credential-surface-guards.test.js`, `tests/credential-extraction.test.js`, `tests/integration/credential-scans.itest.js`, `tests/integration/documents.itest.js`.
  - **Same single failure observed again tonight (2026-10-26)**, exactly as on 2026-10-16 through -24 (no 2026-10-25 brief was pushed — see the morning brief §7): `readonly-and-hardening.itest.js`, test "D-6/D-7: storage failure behaviour ... write failure → 5xx with NO orphaned row" — expected ≥500 on an unwritable storage directory (`chmod 0o755` restore after `fs.chmodSync`), got 201. **Likely cause: this sandbox runs the test process as root (`uid=0`), and Linux root bypasses file-permission bits, so the simulated write failure never actually happens here.** This is very likely an environment artifact of the nightly sandbox, not a proven application defect — it still has not been independently re-verified under a non-root runner, so it continues to be reported as observed rather than explained away.
  - Unit tests (credential-surface-guards, credential-extraction) and integration (credential-scans, documents) — all pass (re-run tonight).
- Work-schedule: `tests/smart-route-backend.test.js`, `tests/travel-work-location-gate.test.js` — pass.
- **Leave requests and CPD (My Profile) submit→approve→reject: no dedicated test file found anywhere** in `backend/tests/` or `backend/tests/integration/` (confirmed by grep for the handler names). This matches the tracker's own next_action.
- No E2E spec for the Profile tab. Browser QA row I (`docs/qa/BROWSER_QA_RESULTS.md`) only confirms the Leave/CPD/documents sections *render* (3/3) — it does not exercise the approve/reject workflow.
- No TODO/FIXME found in `profile-routes.js`.

## Open tasks from the tracker
"Review Portal Structure" (manual QA checklist, status todo) — a human walkthrough task, not a coding task.

## Commits in window that touched it
None — tonight's 8 commits (resource privacy/upload, booking "Make room",
a dependency patch) touched neither `profile-routes.js` nor `profile.js`.

## Disagreement
None on tracker stage (card doesn't claim more than "idea"). The gap is real and matches the tracker's own next_action: the leave/CPD approve-reject round trip has no test.

## Re-verified 2026-10-27
No commit since last night's audit (`896ace1`) touched `profile-routes.js` or `profile.js` — the true window (`896ace1..41f45ed`) holds only Calendar sync-settings/Outlook/Splose work. Re-confirmed tonight: still no dedicated test for the leave/CPD submit→approve→reject round trip. Evidence label unchanged.

## Re-verified 2026-10-28
Real window tonight is `41f45ed..15acf0c` (travel desk-work, place-names autocomplete,
a dependency patch — see the morning brief §6); none of it touches `profile-routes.js`
or `profile.js`. Re-ran `credential-surface-guards`, `credential-extraction`,
`smart-route-backend`, `travel-work-location-gate` (unit, all pass) and
`readonly-and-hardening`, `credential-scans`, `documents` (integration) tonight. The
same single `readonly-and-hardening.itest.js` D-6/D-7 root/chmod failure reproduced
again — unchanged, still believed a root-uid sandbox artifact, still unconfirmed under
a non-root runner. Still no dedicated test for the leave/CPD submit→approve→reject
round trip. Evidence label unchanged.
