/opal-feature

## Idea
Opa Mobile Companion

## Why
(not yet written in the tracker)

## Who uses it
(not yet written in the tracker)

## What they see
(not yet written in the tracker)

## What should happen
(not yet written in the tracker)

## Outcome
(not yet written in the tracker)

## Decisions
(none recorded)

## Where it lives today
Backend only: `backend/mobile-routes.js` (events, voice notes, tasks, reminders), plus
`POST /api/mobile/case-note-drafts/generate` in `backend/case-note-routes.js` →
`backend/clinical-note-provider.js` → `backend/ai/ai-gateway.js` for the AI dictation→draft
step. The native/PWA mobile app itself is not in this repository — nothing here can show what
the app looks or feels like.

## Start here
The backend (50 passing tests in `tests/mobile-routes.test.js`) is solid; the open question is
proof of the actual mobile experience. If the mobile client lives in a separate repository,
the next step is outside this codebase: walk the Case Noting and Calendar View checklists
(already written in the tracker's tasks) on the real test device, per Ann's sign-off task. If
the client code is meant to land here, start by locating or adding it and wiring one Playwright
or manual browser-QA entry (`docs/qa/BROWSER_QA_RESULTS.md`, following its existing format)
that proves a dictation → draft → save round trip end to end.

## Done means
Either a device walkthrough is recorded against the tracker's "Case Noting"/"Calendar View"
checklists, or a browser/E2E check proves the flow — then the evidence label can move from
`tab-unproven` toward `proven`.

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
