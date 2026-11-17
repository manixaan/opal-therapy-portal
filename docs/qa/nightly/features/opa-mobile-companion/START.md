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
`backend/mobile-routes.js` (calendar/travel/appointments, self-scoped), `backend/case-note-routes.js`
(the AI case-noting path, shared with the desktop case-noting workspace), via
`backend/clinical-note-provider.js` → `backend/ai/ai-gateway.js`. 435 unit + 3 integration passing.
No mobile client exists in this repository.

## Start here
Both tasks on this card are manual-testing jobs, not build tasks — the automated coverage is already
strong (435 unit + 3 integration passing). On the actual test device: dictate one case note end to
end, checking speech-capture accuracy and whether the AI summary follows the clinical pathway and
handles sensitive details safely, then confirm the saved note lands against the right client.
Separately, open the Calendar View icon and confirm events/travel/navigation work. Record the
walkthrough result rather than writing code — do not close these tasks on test counts alone (that
was this audit's own mistake on 2026-11-15/16; see STATUS.md's "Correction").

## Done means
A recorded manual walkthrough result (pass/fail per checklist item) handed to Ann for sign-off, per
the tracker's own checklist. Evidence label moves to `proven` once that sign-off exists.

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
