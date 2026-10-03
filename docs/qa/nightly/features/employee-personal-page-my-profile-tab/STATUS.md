# Employee Personal Page (My Profile Tab)

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed this window (commits since 2026-10-02 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-02); the audited commit (`aacf8e6`) is still unchanged. This is the fourth consecutive reconfirmation night on this exact code.
- Created (any located code at all): **yes**

## Located files
- backend/profile-routes.js (1240 lines). Frontend: PROFILE TAB (mockup_v3.html:4188, id="view-profile") — personal details, work locations, leave, PD, PD documents, credentials, notifications cards.

## Guard check
requireAuth everywhere; self-scoped by design and consistently enforced (userId defaults to req.user.id; org-wide view only for owner+canViewAll, never forced). Approvals gated by canApprove (owner-only — admin explicitly excluded per a 2026-08-06 RBAC note in the code). PATCH on another user's credential returns 404, not 403, to avoid leaking existence (good anti-enumeration practice). Cross-user document access is audit-logged. No gaps found.

## Tests and results
frontend-stage3-guards.test.js and credential-surface-guards.test.js pass (280/280 combined, re-run tonight), but these are guard/markup-presence tests, not functional tests of the leave or CPD workflows themselves. No test anywhere (grep for "leave.*approv" / "cpd.*approv" across all unit tests) exercises an actual leave-request or CPD-approval round trip.
Integration tests touching this area (documents.itest.js, credential-scans.itest.js, audit.itest.js, onboarding-returns.itest.js, stage2-pilot-readiness.itest.js, readonly-and-hardening.itest.js — 59 tests) re-run tonight: 58/59 passed, same single failure as the last three nights (readonly-and-hardening.itest.js, "D-6/D-7: storage failure behaviour", expected a 5xx on an induced storage-write failure, got 201) — this is an ENVIRONMENT artifact: this sandbox runs as root (re-confirmed again tonight via `whoami`), and root bypasses the `chmod 0o000`/`0o755` the test uses to simulate an unwritable directory. Not a code defect; cannot be trusted either way in a root-run sandbox.

## Open tasks (from the tracker)
- Review Portal Structure — build, todo

## Compare with the tracker
None — this matches the tracker's own claude_update exactly ("leave requests and CPD activities have zero automated test coverage, and the manual click-through QA task is still open").
