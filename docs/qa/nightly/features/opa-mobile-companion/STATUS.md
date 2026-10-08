# Opa Mobile Companion

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed this window: **no** — zero commits since 2026-10-07 touching `backend/` or `frontend/current/`.
  Eighth consecutive reconfirmation night.
- Created (any located code at all): **yes**

## Located files
- `backend/mobile-routes.js` — own-day aggregates + voice-note drafts (`/api/mobile/*`), including
  `GET /api/mobile/calendar` for Calendar View
- `backend/case-note-routes.js` — Case Noting pilot (`/api/mobile/case-note-drafts/*`,
  `/api/mobile/ai/case-note/*`), fail-closed clinical AI pathway via `backend/clinical-note-provider.js`
- Desktop thin-client reuse: `frontend/current/casenotes.js`/`casenotes-compose.js` (CASE NOTES tab) call the
  same `/api/mobile/*` endpoints the phone app uses — the phone app itself is not in this repo.
- Note: `backend/calendar-routes.js` is a separate, portal-wide master-calendar subsystem, not this feature's
  Calendar View — do not conflate the two.

## Guard check
`mobile-routes.js:40`: `router.use('/api/mobile', requireAuth);` — header documents the self-scoped exception
("every endpoint returns the CALLER'S OWN day only... anything not owned by the caller answers 404"); noted as
self-scoped by design, not broken. `case-note-routes.js`: same self-scoped pattern plus `aiRateLimit` on the
AI-calling routes. No gaps found.

## Tests run tonight
- unit: `mobile-routes.test.js, case-note-routes.test.js, casenotes-compose.test.js, casenotes-helpers.test.js` —
  143/143 pass
- integration: `case-note-client-link.itest.js, case-note-deidentification.itest.js` — 6/6 pass

## Open tasks (from the tracker)
- Case Noting — build, todo
- Calendar View — build, todo

## Compare with the tracker
None new. The tracker's own `claude_update` already says the backend is built, self-scoped and well tested, and
the open item is the tracker's own Case Noting checklist, every item still unchecked, ending in a named person's
sign-off — a human task, not a code gap.
