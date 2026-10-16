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
`backend/mobile-routes.js` and `backend/case-note-routes.js` for Case
Noting (dictation, AI summary, saving to the portal) — solid and
AI-governed. `GET /api/mobile/calendar` already exists for Calendar View,
tested at the unit level, with no mobile-app frontend in this repo to
prove it on the device.

## Start here
This is marked CRITICAL because it touches clinical data and the AI
gateway. For Case Noting: have Ann walk through a full example on the
test device and complete her sign-off checklist — this audit can run the
code's tests but cannot do this hands-on step. For Calendar View: check
with whoever owns the mobile app frontend (outside this repo) on whether
`GET /api/mobile/calendar` is already wired up there; if not, that's the
actual remaining work, not a backend build.

## Done means
Ann's sign-off is recorded for Case Noting, and the mobile app's Calendar
View screen is confirmed wired to the existing `GET /api/mobile/calendar`
endpoint. Evidence label should reach `proven` for Case Noting once
signed off.

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
