# Opa Mobile Companion

Tracker stage: idea · Tracker environment: none
Evidence label: **needs-refinement**
Addressed since last audit (2026-11-26, commit `f5fc28d`): no — zero new commits
Created (any located code): yes

*Reconfirmed 2026-11-28:* independently re-ran `mobile-calendar.test.js`,
`mobile-event-edit.test.js`, `mobile-move.test.js`, `mobile-routes.test.js`,
`case-note-routes.test.js` (5 suites / 170 passed), plus the matching
integration files (7 suites / 34 passed) — consistent with the counts below.
`node --check`: OK. No TODO/FIXME found. Note: this audit's first pass tonight
also pulled in `backend/opa-routes.js` (the `opa-deidentify`/`opa-knowledge`/
`opa-shell` tests) as if it were part of this card — on a second look, that's
wrong: `opa-routes.js` backs the general "Opa" chat pebble visible on the
*desktop* web shell (`id="opa-pebble"` in `mockup_v3.html`), a separate,
uncarded AI-chat feature in its own right, not the mobile app's case-noting or
calendar view. Correcting that here rather than reporting it as this card's
evidence.

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

## Commits since last audit (2026-11-26)

None — `origin/develop` is unchanged at `f5fc28d`. (The mobile/case-note commits this audit
first noticed — `2ae079b`, `c6d599a`, `9874238`, `e4fa521`, `e222a77` — all predate
2026-11-26 and are already reflected in the passing test counts above; they are not new
tonight.)

## Note on the evidence label

This is a native mobile app, not a `mockup_v3.html` tab, so the `tab-unproven` label's literal
criterion (a browser/E2E test covering the tab) doesn't cleanly apply. Classified as
**needs-refinement** instead, consistent with every prior night's call on this card: the code
is built and the API-level tests are solid, but the Case Noting task is still open and the one
thing that can close it — a human walkthrough on the physical test device — hasn't happened.

## Disagreement

None — tracker stage (`idea`) does not overclaim; the tracker's own `claude_update` already
matches the evidence.
