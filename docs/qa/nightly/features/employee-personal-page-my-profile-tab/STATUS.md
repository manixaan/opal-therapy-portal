# Employee Personal Page (My Profile Tab)

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed this window (commits since 2026-10-04 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-04); the audited commit (`aacf8e68`) is still unchanged. This is the sixth consecutive reconfirmation night on this exact code. Tonight is not Sunday UTC, so targeted batches were run (not the complete suites) — see each section below for exactly what ran tonight.
- Created (any located code at all): **yes**

## Located files
- backend/profile-routes.js — leave requests (/api/profile/leave*), CPD (/api/profile/cpd*), credentials and PD documents
- frontend/current/mockup_v3.html PROFILE TAB (line 4188, id="view-profile") — personal details, work locations, leave, PD, PD documents, credentials, notifications cards

## Guard check
requireAuth everywhere; self-scoped by design and consistently enforced (own records by default; org-wide view only for owner via canViewAll). Approvals gated by canApprove (owner-only — admin explicitly excluded per a documented 2026-08-06 RBAC decision). PATCH on another user's credential returns 404 not 403 (anti-enumeration). Cross-user document access is audit-logged. No gaps found.

## Tests run tonight
- unit: `credential-extraction.test.js, credential-surface-guards.test.js, security.test.js` — 440/452 pass, 12 skipped (credentials sub-area only — no dedicated test exercises the leave or CPD request/approve endpoints at all, confirmed again tonight by grepping for profile/leave and profile/cpd across every test file)
- integration: `not run tonight (credential-scans.itest.js was run as part of the resource-hub batch and passed; documents.itest.js / audit.itest.js / onboarding-returns.itest.js / stage2-pilot-readiness.itest.js / readonly-and-hardening.itest.js were not run tonight — see Technical detail)` — n/a

## Open tasks (from the tracker)
- Review Portal Structure — build, todo

## Compare with the tracker
None — this matches the tracker's own claude_update exactly: leave requests and CPD activities have zero automated test coverage, and the manual click-through QA task ("Review Portal Structure") is still open. Credentials specifically are the one well-tested sub-area.
