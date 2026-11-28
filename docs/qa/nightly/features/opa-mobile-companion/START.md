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

## Task notes, verbatim (Case Noting)

"The case noting tool already exists as a pilot in the mobile app. It lets staff dictate
notes, then uses AI to follow a strict clinical pathway for sensitive information. This task
is about testing and verifying that pilot works, with no manual listing or note-taking
involved. We will reuse the current pilot and the mobile icons already on the test device,
then check, fix and confirm each part works."

"at the moment we have created a series of little icons in the mobile application which is
now on the testing device noting the other one is the calendar in which case they can access
events and quick look at which opens up the travel and with a click they can access and
navigate via Google Maps to the next destination now the case noting users artificial
Intelligence where it follows a strict clinical pathway as its dealing with sensitive data.
Currently the pilot project is built. But rigerous testing is required to understand the case
noting summarisation capability and its organisation and linking to the portal once the user
is finsihed with their case note. The case noting in the app is designed as a dictation tool.
Please build to do lists based on this
---
there will be no listing of what any sorts it'll just be testing so verifying the operation so
no one will be doing any manual listing or writing down what's functional functional no note
taking it's just testing"

## Where it lives today

`backend/case-note-routes.js` (dictation drafts + AI summarisation, policy
`clinical_note_generation` in `backend/ai/ai-policy.js`), `backend/mobile-notes-owing.js`,
`backend/mobile-calendar.js`, `backend/mobile-event-edit.js`, `backend/mobile-routes.js`
(migration 094). All guarded with `requireAuth` and self-scoped to `req.user.id`.

## Start here

All API-level unit (170) and integration (34) tests pass tonight, and the AI pathway is
registered and audited through the single gateway. What's missing is proof the pilot actually
works end to end on the device — that's a human task, not a code task. Open
`backend/case-note-routes.js` to see the current dictation → draft → AI-summary → save flow,
then walk through the tracker's own "Case Noting" checklist on the test device: dictate a note,
check the AI summary follows the clinical pathway, confirm it saves against the right client,
and record each checklist item as pass/fail (no written report — just tick the boxes).

## Done means

A human has walked the physical-device checklist and ticked each box, or filed a defect for any
step that fails. There is no new automated test that can prove this — the existing 204 passing
tests already prove the API side.

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
