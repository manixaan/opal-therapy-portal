# Opa Mobile Companion

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed this window (commits since 2026-10-02 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-02); the audited commit (`aacf8e6`) is still unchanged. This is the fourth consecutive reconfirmation night on this exact code.
- Created (any located code at all): **yes**

## Located files
- Case Noting: backend/case-note-routes.js (/api/mobile/case-note-drafts + legacy /api/mobile/ai/case-note), case-note-style.js, docs/mobile/CASE_NOTE_AI_PRIVACY.md, docs/mobile/MOBILE_PERSISTED_DRAFT_CONTRACT.md
- Calendar View: backend/mobile-routes.js (GET /api/mobile/today, /calendar, /appointments/:id, /travel), docs/mobile/MOBILE_BACKEND_PHASE2_REPORT.md
- No mobile client code lives in this repository (no mobile.html, no mobile UI bundle) — the tracker's checklist describes an existing on-device pilot that must live in a separate mobile app project not checked into this repo.

## Guard check
mobile-routes.js: requireAuth on /api/mobile, self-scoped-by-design CLAIM VERIFIED (every query filtered by req.user.id/therapist_profile_id, 404 on anything not owned — spot-checked /today, /appointments/:id, voice-notes CRUD, linkTargetOwned()). case-note-routes.js: requireAuth on both mount points, same ownership-check pattern verified. No gaps.

## Tests and results
Unit: mobile-routes.test.js 41/41, case-note-routes.test.js 64/64 — re-run tonight, 105/105 pass, identical to the last three nights.
Integration: case-note-client-link.itest.js, case-note-deidentification.itest.js — re-run tonight, part of a 27/27-passing batch again.

## Open tasks (from the tracker)
- Case Noting — build, todo (checklist: confirm pilot behaviour, test dictation end to end, test AI summary against clinical pathway, decide "good enough", test save-to-portal, fix+re-test, get Ann's sign-off — all unchecked)
- Calendar View — build, todo

## Compare with the tracker
None — the tracker's own claude_update already frames this accurately ("the pilot's own human sign-off task is still open").
