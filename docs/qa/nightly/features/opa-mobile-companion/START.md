/opal-critical

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
Case Noting: `backend/case-note-routes.js`, `backend/clinical-note-provider.js` (via `backend/ai/ai-gateway.js`). Calendar View: `backend/mobile-routes.js`. Both API-only — no mobile client in this repository.

## Start here
This is CRITICAL level: it touches AI-generated clinical notes. On the actual test device, walk through the case-noting pilot end to end (dictate → AI summary → save against the right client) per the tracker's own checklist, and separately confirm the Calendar View screen loads real appointments and travel directions. Report back which steps the pilot already handles correctly versus where it breaks — this is a verification task, not a build task, per the tracker's own notes ("no manual listing, just testing").

## Done means
A walkthrough on the real device confirms both flows work end to end; record the result (pass/fail per step) somewhere the team can see it — this audit folder's STATUS.md is a reasonable place to append it next run.

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
