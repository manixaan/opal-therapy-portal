# Opa Mobile Companion

Tracker stage: idea · Tracker environment: none
Evidence label: **tab-unproven**
Addressed this window (since 2026-11-13): yes
Created (any located code): yes

## Located files

- Case Noting (dictation + AI clinical pathway): `backend/case-note-routes.js` (mounts
  `/api/mobile/case-note-drafts` and `/api/mobile/ai/case-note`), `backend/mobile-notes-owing.js`,
  AI policy `clinical_note_generation` registered in `backend/ai/ai-policy.js`
  (classification CLINICAL, human-review required).
- Calendar View: `backend/mobile-calendar.js`, `backend/mobile-event-edit.js`,
  `backend/mobile-routes.js` (appointment move/edit/client/type/address change, APNs push,
  notes-owing, client card — migration 094).
- No dedicated web tab — this is a phone app consuming `/api/mobile/*`. `frontend/current/opa.js`
  is the unrelated Opa AI chat widget shell, not the case-noting UI.

## Guard check

Both `mobile-routes.js` and `case-note-routes.js` apply `requireAuth` only, with a header
comment documenting every query is scoped to `req.user.id` ("no role — owner included — can
read another user's drafts"). Self-scoped by design, not broken.

## Tests

- Unit: `mobile-calendar.test.js`, `mobile-event-edit.test.js`, `mobile-move.test.js`,
  `mobile-routes.test.js`, `case-note-routes.test.js` — **5/5 suites, 170/170 tests passed**.
- Integration (`DB_NAME=therapy_scheduler_audit`): `mobile-crm.itest.js`,
  `mobile-event-edit.itest.js`, `mobile-move.itest.js`, `case-note-workspace.itest.js`,
  `case-note-approval-edit.itest.js`, `case-note-client-link.itest.js`,
  `case-note-deidentification.itest.js` — **7/7 suites, 34/34 tests passed**.
- No E2E spec and no device walkthrough is recorded anywhere in the repo. The tracker's own
  task text asks a person to do this testing on the physical test device — that evidence can
  only come from a human, not this audit.

## Open tasks (from tracker)

- Case Noting — todo. Full checklist (confirm pilot, test dictation, test AI summary against
  clinical pathway, decide "good enough", test save-to-portal, fix & re-test, get Ann's sign-off)
  is unchecked.
- Calendar View — todo, no detail recorded.

## Commits in window (since 2026-11-13)

`2ae079b` feat(mobile): appointment detail canEdit/canMove · `c6d599a` feat(mobile): change
client/session type/address from phone · `9874238` feat(mobile): client card, notes owing,
push to APNs (migration 094) · `e4fa521` feat(mobile): drag-to-move · `e222a77`
feat(casenotes): case-noting workspace

## Disagreement

None — tracker stage (`idea`) does not overclaim; the tracker's own `claude_update` already
matches the evidence.
