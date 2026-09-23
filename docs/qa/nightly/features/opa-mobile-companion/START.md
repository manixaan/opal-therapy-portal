/opal-critical

**Idea**
Opa Mobile Companion

**Why**
(not yet written in the tracker)

**Who uses it**
(not yet written in the tracker)

**What they see**
(not yet written in the tracker)

**What should happen**
(not yet written in the tracker)

**Outcome**
(not yet written in the tracker)

No decisions recorded yet at the feature level. Task-level notes (verbatim):

- **Case Noting**: "at the moment we have created a series of little icons
  in the mobile application which is now on the testing device noting the
  other one is the calendar that someone can see in which case they can
  access events and quick look at which opens up the travel and with a
  click they can access and navigate via Google Maps to the next
  destination now the case noting users artificial Intelligence where it
  follows a strict clinical pathway as its dealing with sensitive data.
  Currently the pilot project is built. But rigerous testing is required to
  understand the case noting summarisation capability and its organisation
  and linking to the portal once the user is finsihed with their case
  note. The case noting in the app is designed as a dictation tool. Please
  build to do lists based on this" — followed by: "there will be no
  listing of what any sorts it'll just be testing so verifying the
  operation so no one will be doing any manual listing or writing down
  what's functional functional no note taking it's just testing"
- **Calendar View**: (no notes recorded)

## Where it lives today

Backend: `backend/mobile-routes.js`, `backend/case-note-routes.js`,
`backend/clinical-note-provider.js`, `backend/case-note-style.js`. The
mobile app's own UI is still not in this repository. **New 2026-09-22**:
`frontend/current/casenotes-compose.js` — a desktop-portal case-note
composer (client picker, on-device dictation, names check, governed draft)
that reuses the same mobile backend endpoints. See STATUS.md for the full
file list and test results — both the mobile backend and this new desktop
composer are solidly built and unit/integration tested (412 + 6 tests
passing); nothing anywhere proves either end-to-end experience in a real
browser or on the test device.

## Start here

This is CRITICAL level (clinical/sensitive data, AI governance). Three
things, in order: (1) fix the stale `docs/mobile/CASE_NOTE_AI_PRIVACY.md`
claim that the feature needs `ANTHROPIC_API_KEY` — it routes through
Bedrock only, per `clinical-note-provider.js` and `ai-policy.js`, and this
now also misdescribes the new desktop composer since it shares the same
`/generate` endpoint; (2) confirm whether `CLINICAL_NOTE_AI_ENABLED` is
actually `true` anywhere it matters; (3) add a Playwright E2E spec (e.g.
`e2e/tests/case-notes-compose.spec.js`) that logs in as a therapist, opens
Case Notes → "New case note," picks a caseload client, types (not dictates —
SpeechRecognition isn't reliably automatable in CI) a transcript, runs the
names check, answers any flagged words, generates a draft, and asserts it
lands in the review surface (`casenotes.js`) linked to the right client —
follow `portal.spec.js`'s login/tab-navigation pattern. That's the smallest
test that turns "solid backend + guarded frontend" into real end-to-end
proof for the desktop half of this feature. The mobile pilot's own
walkthrough (dictation → AI summary → portal save on the test device) is
still a manual verification this audit cannot do.

## Done means

For the desktop composer: the E2E spec above passing. For the mobile pilot:
the tracker's own checklist items (accuracy against the clinical pathway,
correct linking to the client/case, no loss or duplication, Ann's sign-off)
being worked through by a person on the test device — there is no test file
this audit can point to that would prove that half on its own.

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
