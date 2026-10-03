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
(not yet written in the tracker)

## Where it lives today
Case Noting: backend/case-note-routes.js (/api/mobile/case-note-drafts + legacy /api/mobile/ai/case-note), case-note-style.js, docs/mobile/CASE_NOTE_AI_PRIVACY.md, docs/mobile/MOBILE_PERSISTED_DRAFT_CONTRACT.md Calendar View: backend/mobile-routes.js (GET /api/mobile/today, /calendar, /appointments/:id, /travel), docs/mobile/MOBILE_BACKEND_PHASE2_REPORT.md No mobile client code lives in this repository (no mobile.html, no mobile UI bundle) — the tracker's checklist describes an existing on-device pilot that must live in a separate mobile app project not checked into this repo.

## Start here
This is a human pilot-testing task, not primarily a coding one: run through the Case Noting checklist on the actual mobile pilot device with Ann, decide what "good enough" looks like for an AI case-note summary, and get her sign-off. Only after that should engineering time go into fixing whatever the walkthrough surfaces.

## Done means
All seven Case Noting checklist items checked in the tracker, with Ann's sign-off recorded.

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
