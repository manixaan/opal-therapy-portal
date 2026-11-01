# Opa Mobile Companion

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in change window (since 2026-10-18): yes
- Created (any located code): yes

## Reason

Both tasks are built, guarded and covered by passing tests, and both were
touched by commits in this window:

- **Case Noting** — the voice-to-case-note pipeline (`backend/case-note-routes.js`,
  `backend/clinical-note-provider.js`) goes through the AI gateway correctly
  (`require('./ai/ai-gateway')`, feature registered as `clinical_note_generation`
  in `backend/ai/ai-policy.js`), is strictly user-scoped by design, and is
  exercised by passing unit and integration tests. Fixed in-window: approved
  notes re-entering approval on edit, one-editable-note / Copy / PDF export.
- **Calendar View** (the phone diary) — `backend/mobile-routes.js` reads events
  user-scoped exactly like `snapshot-routes.js`, and is exercised by a passing
  unit suite. Fixed in-window: the phone diary now matches the portal calendar
  (hides mirrored Outlook travel-leg duplicates, reads overlapping-day events,
  flags all-day events, sends address text not objects, uses the practitioner's
  work-base address for the day's first drive).

The mobile *app* itself lives outside this repository, so there is no frontend
tab to browser-test here — "proven" covers the API surface this repo owns.
The tracker's own next action (walk the device checklist on the real test
device) is a device-side QA step, not something this repo can prove.

## Located files

- `backend/mobile-routes.js` — mounted at `/api/mobile` (`backend/server.js:591`),
  `router.use('/api/mobile', requireAuth)`. Self-scoped by design (header
  comment: every read/write is `user_id`/caller-owned-only; named as the
  canonical self-scoped example in `.claude/rules/backend-api.md`).
- `backend/case-note-routes.js` — mounted at `/` (`backend/server.js:595`),
  guards `/api/mobile/case-note-drafts` and `/api/mobile/ai/case-note` with
  `requireAuth` only; self-scoped by design (header: "Strictly user-scoped
  (snapshot model) ... not-yours answers 404. No role — owner included —
  can read another user's drafts.").
- `backend/clinical-note-provider.js` — calls `./ai/ai-gateway` (not a raw
  vendor SDK); deidentification via `./ai/deidentify`.
- `backend/case-note-pdf.js`, `backend/case-note-style.js` — PDF/formatting
  support for the note draft.
- No standalone frontend tab (`mockup_v3.html`) exists for this feature — the
  consumer is the external mobile app.

## Tests and results

| Test | Result |
|---|---|
| `npx jest tests/case-note-routes.test.js` | ✅ 73/73 passed |
| `npx jest tests/mobile-routes.test.js` | ✅ 50/50 passed |
| `DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/case-note-approval-edit.itest.js tests/integration/case-note-client-link.itest.js tests/integration/case-note-deidentification.itest.js --runInBand` | ✅ 3 suites / 10 tests passed |

No integration test file exists specifically named for `mobile-routes.js`
itself (calendar/travel coverage lives in `calendar-local-first.itest.js`,
`event-travel-plan.itest.js`, `travel-outlook-sync.itest.js`,
`travel-overrides.itest.js` — not run here as they belong to the Travel
feature, not this card).

## Open tasks from the tracker

- Case Noting — status `todo` (tracker checklist is a human device-testing
  checklist: dictation accuracy, clinical-pathway sign-off from Ann — none of
  that is something code tests can prove).
- Calendar View — status `todo`, no explanation/notes recorded.

## Commits in window that touched it

- `e1af24e` fix(mobile): the phone diary matches the portal calendar
- `22e68b7` feat(case-notes): one editable note, Copy note, Download PDF on Opal letterhead
- `a56173c` fix(case-notes): editing an approved note sends it back for approval
- `dc5dbc4` revert(casenotes): no approval notice on the laptop Case Notes tab

## Disagreement

None — the tracker's own `claude_update` already says this window's two fixes
are covered by passing tests and that only the real-device walkthrough is
missing. The evidence here agrees.
