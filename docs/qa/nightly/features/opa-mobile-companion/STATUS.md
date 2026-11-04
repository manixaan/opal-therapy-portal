# Opa Mobile Companion

- Tracker stage: idea · Tracker environment: none
- Evidence label: **proven** (backend surface — the native/PWA client itself isn't in this repo)
- Addressed in this change window: no
- Created (any located code): **yes** — backend only

## Located files

- Backend: `backend/mobile-routes.js` (thin, user-scoped aggregated API: events, snapshot_*,
  voice_notes — never calls Splose/Outlook/Xero/Maps/AI directly), `backend/case-note-routes.js`
  (voice-note → case-note workflow, shared with the desktop Case Notes feature, not mobile-only),
  `backend/clinical-note-provider.js` (the AI invocation for dictated-narrative → structured note).
- Frontend: **none found in this repository.** The native/PWA mobile client (icons, Calendar View,
  Google Maps navigation launch) is a separate app not checked into this checkout.
- Guards: `mobile-routes.js:41` `requireAuth` only; header comment documents every endpoint scoped
  to the caller's own `user_id`/`therapist_profile_id` — self-scoped by design, matches the
  CLAUDE.md exception.
- AI gateway: compliant — `clinical-note-provider.js:44` goes through `backend/ai/ai-gateway.js`
  only, registered as policy `clinical_note_generation` in `ai-policy.js:60`.

## Tests and results

- Unit: `tests/case-note-routes.test.js` + `tests/mobile-routes.test.js` — **123/123 pass**.
- Integration: `case-note-approval-edit.itest.js`, `case-note-client-link.itest.js`,
  `case-note-deidentification.itest.js` — **10/10 pass**.
- Figures match the prior audit's run exactly (`origin/claude/nightly-audit`, 2026-11-02), so this
  is a stable, re-confirmed result, not new work.

## Open tasks from the tracker

- "Case Noting" — todo; explicitly a device-walkthrough task for a human, not a coding task.
- "Calendar View" — empty, no explanation.

## Findings

Backend is proven: guarded, AI-gateway-compliant, and both the dictation/AI-summary path and the
mobile aggregation API have full test coverage. The only thing left is a real-device walkthrough,
which is outside this repository's test surface. The dictation/AI-summary pathway is shared code
with the desktop Case Notes feature, not mobile-specific — a future standalone "Case Notes"
tracker card would otherwise double-count this same code (see "What changed" in tonight's brief).
