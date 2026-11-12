# Opa Mobile Companion

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in change window (2026-10-29 to 2026-11-12): yes — `backend/case-note-pdf.js` (new), `backend/case-note-routes.js`, `backend/mobile-routes.js`; commits include `a56173c fix(case-notes): editing an approved note sends it back for approval`, `feat(case-notes): one editable note, Copy note, Download PDF on Opal letterhead`, `dc5dbc4 revert(casenotes): no approval notice on the laptop Case Notes tab`, `e1af24e fix(mobile): the phone diary matches the portal calendar`
- Created (any code located): yes — API surface only; the mobile app itself is not in this repository

## Located files

- Routes: `backend/mobile-routes.js`, `backend/case-note-routes.js`
- AI layer: `backend/clinical-note-provider.js` — the only caller of `backend/ai/ai-gateway.js` for this feature; boundary respected
- Data access: inline SQL (`voice_notes`, `events`, `snapshot_*` tables); `backend/case-note-pdf.js`, `backend/case-note-style.js`
- Frontend: **none found in this repository**. The mobile app (native or PWA) that would actually render case noting and the calendar view is not checked in here — only its backend API surface exists in this repo. (`frontend/current/opa.js`/`opa.css` is the unrelated "Opal Assist" chat widget, not the mobile companion app.)
- Unit tests: `mobile-routes.test.js`, `case-note-routes.test.js`, `casenotes-compose.test.js`, `casenotes-helpers.test.js`
- Integration tests: `case-note-approval-edit.itest.js`, `case-note-client-link.itest.js`, `case-note-deidentification.itest.js`
- E2E: none (no app to drive from this repo).

## Guard check

Clean, self-scoped by design. `mobile-routes.js:41` — `requireAuth` only, but the file header (lines 1-29) documents every endpoint as scoped to the caller's own `user_id`/`therapist_profile_id`, 404 on anything not owned — matches the `snapshot-routes.js` exception. `case-note-routes.js:52,56` — same pattern; header explicitly states no role, owner included, may read another user's drafts.

## AI governance — verified

`clinical-note-provider.js` is properly walled off and documented in `docs/mobile/CASE_NOTE_AI_PRIVACY.md`: fails closed without `CLINICAL_NOTE_AI_ENABLED` plus a key, and is restricted to an Australian Bedrock region — consistent with `.claude/rules/ai-gateway.md`'s clinical-data region requirement.

## Tests run

- Unit: 4 suites, 163 tests — **all pass** (deliberate `ERROR`-level log lines for simulated `ECONNREFUSED`/disk-failure/`ECONNRESET` scenarios are intentional failure-path tests, not real errors)
- Integration: 3 files, included in a 41-test run — **all pass**

## Open tasks from tracker

- "Case Noting" — `todo`. An explicitly testing-only task (no manual listing, "it's just testing") — walk the dictation flow, test the AI summary against the clinical pathway, agree a quality bar, confirm notes save correctly, fix and re-test, get Ann's sign-off. This is a human-on-the-device task; the backend side is tested, but nothing here proves the device-side pilot works.
- "Calendar View" — `todo`, no further detail recorded.

## Why proven, not tab-unproven

This matches the classification held for four consecutive nights. The usual "needs a browser/E2E proof of the tab" rule doesn't apply the same way here: there is no in-repo tab or page to drive with Playwright — the mobile app itself lives outside this repository. Given that, the standard applied consistently across these audits is: self-scoped guards re-verified by direct grep + passing unit/integration tests = `proven` for the backend surface that this repo actually contains, with a clear note (not a demotion) that the on-device pilot experience the tracker describes cannot be verified from here.

## Disagreement

None in the formal sense. The practical issue, carried forward unchanged: this card describes a mobile-app pilot that is "currently built" per the tracker notes, but **this repository holds only its backend API** — the actual pilot app isn't here to verify. The backend side is well tested; the end-to-end mobile experience described in the tracker cannot be confirmed from this repository alone.

## Commits in window touching it

See header.
