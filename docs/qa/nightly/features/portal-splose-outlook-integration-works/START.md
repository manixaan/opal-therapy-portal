/opal-feature

## Idea
Portal - Splose - Outlook | Integration Works

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
(none recorded in the tracker)

## Where it lives today

`backend/splose-sync-routes.js`, `backend/splose-api.js`, `backend/splose-caseload.js`,
`backend/splose-draft-sync.js`, `backend/splose-poller.js` (sync engine); `backend/splose-link-routes.js` +
`backend/splose-credentials.js` (Settings → Integrations → Splose: practitioner self-link, practice
API key); `backend/outlook-oauth.js`, `backend/travel-routes.js`. Frontend: Calendar tab, Travel &
Flights tab, and the Settings → Integrations → Splose panel (inline script in `mockup_v3.html`).
346 unit + 58 integration tests all pass tonight — see STATUS.md.

## Start here

Everything at the API/guard level is solid; the gap is proof that the newest UI actually works.
Walk through Settings → Integrations → Splose in a browser: (1) as an owner, connect/disconnect
the practice-wide Splose API key and confirm the connection status updates; (2) as a therapist,
link your own Splose practitioner identity via the picker. `docs/qa/BROWSER_QA_RESULTS.md` flow E
(2026-08-01) predates this UI entirely — either add a new flow row there or a spec under
`e2e/tests/` covering both. Separately, the tracker task "Multi Calendar Rules" has no matching
code anywhere in this repo — the architecture is deliberately single-calendar (an Outlook-only
mirror), the opposite of "multi calendar" — worth a decision on whether the task name should
change or the architecture should.

## Done means

A fresh `docs/qa/BROWSER_QA_RESULTS.md` entry or `e2e/tests/*.spec.js` spec exists covering the
owner connect/disconnect flow and the therapist practitioner-link flow, moving this to `proven`.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
