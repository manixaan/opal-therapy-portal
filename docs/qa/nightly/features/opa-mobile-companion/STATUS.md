# Opa Mobile Companion

- Tracker stage: idea | Tracker environment: none
- Evidence label: **needs-refinement** (corrected tonight — see "Correction" below; was `proven` on
  2026-11-15 and 2026-11-16)
- Created: yes
- Addressed this window: no new code since 2026-11-16; `case-note-routes.js`/`nf2f-routes.js` did
  change on 2026-11-14 (commit `e222a77`, the desktop case-noting workspace), already accounted for
  in the 2026-11-15 audit

## Located files
- `backend/mobile-routes.js` — a thin, self-scoped API surface for a mobile companion app (clients,
  today, calendar, appointments/:id, travel, voice-notes CRUD). Header comment documents it as
  deliberately self-scoped (every endpoint returns only the caller's own day/data), matching the
  CLAUDE.md-documented self-scoped-by-design exception alongside `snapshot-routes.js`.
- `backend/case-note-routes.js` — the AI case-noting path (`POST /api/mobile/case-note-drafts/generate`,
  `/names-check`, `GET`, `/regenerate`, `/review`). A deprecation comment in `mobile-routes.js`
  explains the AI drafting endpoint moved out and now lives here, sharing the same governed route
  and `ai_interactions` linkage that the desktop case-noting workspace (`e222a77`) uses — one shared
  backend, two front doors, not a duplicate.
- `backend/clinical-note-provider.js` → `backend/ai/ai-gateway.js`. Feature key
  `clinical_note_generation` in `ai-policy.js`: classification CLINICAL, region australia,
  de-identification required.
- No mobile frontend exists in this repo (confirmed again tonight) — the device client is a separate
  app, which is expected and not a gap.

## Guard check
`mobile-routes.js`: `requireAuth`, self-scoped by design. `case-note-routes.js`: `requireAuth` +
every write additionally scoped via `loadOwnEvent`/`loadOwnClient`/`loadOwnBlockForClient`. No
missing guards.

## Tests (re-run fresh tonight)
- Unit: `mobile-routes.test.js` 50/50, plus `case-note-routes.test.js` + `casenotes-workspace.test.js`
  + the full `tests/ai-*.test.js` set (18 files) run together — **435/435 passed, 20/20 suites**.
- Integration: `tests/integration/case-note-workspace.itest.js` — **3/3 passed**
  (DB_NAME=therapy_scheduler_audit_h).

## Open tasks (from tracker)
- "Case Noting" — todo. The task text explicitly asks for *rigorous manual testing* of dictation
  accuracy and AI-summary quality on the real device — something no automated test here can prove.
- "Calendar View" — todo, no further detail.

## Correction (2026-11-17)
This feature was classified `proven` on both 2026-11-15 and 2026-11-16, reasoning that both open
tracker tasks were "already done in code." Tonight's independent re-verification agrees the code and
tests are solid (435 unit + 3 integration, all passing) but disagrees with the label: both tasks are
still `status: todo` in the tracker, which by this audit's own classification rule (a task that is
`todo`/`in_progress`/`waiting_on_you` keeps a feature at `needs-refinement`) should not have been
waived. More importantly, the gap is the same *shape* as the gap that correctly keeps Interactive
Assessments, Report Templates and Xero Integration below `proven` elsewhere in this same tracker:
automated tests prove the API contract, but nothing — here or anywhere in the repo — proves the
real-world experience the task is actually asking about (dictation accuracy, AI-summary quality on
the real device). Treating that as settled because "the tracker's own next_action says to close the
tasks" repeats the tracker's own click-through of itself: the two prior nights' write-back
(`post-tracker.mjs`) is what put "close both tasks" into `next_action` in the first place, and that
text was then read back as if it were independent tracker guidance. Reclassifying to
`needs-refinement` for consistency with the rest of this tracker's pattern, and writing a corrected
`next_action` back to the tracker tonight.

## Commits in window touching this
`e222a77` (2026-11-14) touched `case-note-routes.js`/`nf2f-routes.js` directly, adding
`nf2f_event_id` support that the mobile `generate`/list endpoints also use — already covered by the
2026-11-15 audit, not new tonight.

## Note
Corrected tonight from the 2026-11-15/2026-11-16 `proven` label — see "Correction" above. Everything
else (located files, guard check, test results) independently re-verified fresh, not carried
forward.
