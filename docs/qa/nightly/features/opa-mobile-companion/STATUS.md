# Opa Mobile Companion

- Tracker stage: idea · Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-10-29, commit `15acf0c`): **yes** — three
  commits in tonight's window (`15acf0c..338f5dc`) touched this feature's located
  files: `e1af24e` (mobile diary de-duplication/overlap fix), `a56173c`
  (case-note approval-voided-on-edit), `dc5dbc4` (frontend-only revert of
  a56173c's laptop approval banner; the backend rule from a56173c is unchanged).
  `08da79d` and `338f5dc` are the unrelated travel-alerts feature/test fix and do
  not touch this feature's files.
- Created (any located code): yes.

## Located

- `backend/mobile-routes.js` — `GET /api/mobile/{clients,today,calendar,appointments/:id,travel,voice-notes,voice-notes/:id}`, POST/PATCH/DELETE voice-notes. Header states it never calls Splose/Outlook/Xero/Maps/any AI provider and is scoped to the caller's own day only.
- Tracker task **"Calendar View"** → `GET /api/mobile/calendar` (mobile-routes.js:452) — located.
  Tonight's change (`e1af24e`): `loadOwnAppointments` (mobile-routes.js:161) now
  calls `db.getEventsForTherapists(..., { overlap: true })` so events crossing
  Perth midnight appear on every day they touch (new `overlap` param added to
  `getEventsForTherapists` in `database.js:1446-1460`, default `false` so
  existing callers keep containment semantics); `isTravelMirror` (line 126)
  filters `custom_metadata.travelLegKey` so Outlook copies of the portal's own
  travel legs are hidden on the phone, same rule the portal calendar applies;
  `isAllDayEvent` (line 130) flags all-day events under the portal's 23-hour
  rule.
- Tracker task **"Case Noting"** → **not** in `mobile-routes.js`. It is `backend/case-note-routes.js` (header: "CASE-NOTE DRAFTS — voice-to-case-note for Opa Mobile"). Routes: `/api/mobile/case-note-drafts*` and deprecated alias `/api/mobile/ai/case-note`. Calls `clinical-note-provider.js`, which correctly goes through `backend/ai/ai-gateway.js` — no gateway-boundary violation. Registered in `ai-policy.js` as `clinical_note_generation`.
  Tonight's change (`a56173c`): `PATCH /api/mobile/case-note-drafts/:id`
  (case-note-routes.js:850-910) now voids approval on a real edit to an
  already-approved note — a `changed` check compares the new `noteBody`/`plan`
  against the stored row; if `row.review_status === 'approved' && changed`, the
  UPDATE also sets `review_status = 'review_required'`, `reviewed_by = NULL`,
  `reviewed_at = NULL`, and the linked `ai_interactions` row is reopened via the
  new `ai-audit.reopenReview` (ai/ai-audit.js:349). A no-op save (no actual text
  change) leaves the approval intact. Audited as `mobile.case_note_updated` with
  `approvalVoided`, `aiInteractionId`, `interactionReopened`.
  `dc5dbc4` reverted only the laptop-side approval-notice UI in
  `frontend/current/casenotes.js`/`mockup_v3.html` (CI's
  frontend-stage3-guards bans approve/sign-off wording on the laptop surface);
  the backend approval-void rule from `a56173c` is unchanged and still applies
  whether the edit came from the phone or the laptop. `casenotes.js` pin is
  back to `?v=3` in `mockup_v3.html:130`, consistent with the revert (verified,
  no stale pin).
- No frontend tab exists for mobile, by design — consumed by an external mobile client not in this repo.

## Guard check

- `mobile-routes.js:41` — `router.use('/api/mobile', requireAuth)`, no further
  role check. Verified every route filters by `req.user.id` or the caller's own
  `therapist_profile_id`; unowned resources 404 (e.g. `appointments/:id` at
  line 495-499). Self-scoped by design, not broken.
- `case-note-routes.js:51,55` — `requireAuth` on both `/api/mobile/case-note-drafts`
  and the deprecated `/api/mobile/ai/case-note` mount. Header explicitly
  documents "Strictly user-scoped (snapshot model): every read/write filters
  user_id; not-yours answers 404. No role — owner included — can read another
  user's drafts." The PATCH handler re-loads via `loadOwnDraft(req, id)`
  (ownership-scoped) before any approval-void logic runs — a non-owner still
  gets 404, unaffected by tonight's change. Self-scoped by design, not broken.
- `node --check` passed clean on `mobile-routes.js`, `case-note-routes.js`,
  `ai/ai-audit.js`.

## Tests and results

| Command | Result |
|---|---|
| `npx jest tests/mobile-routes.test.js` | PASS — 50/50 (covers Outlook-copy hiding, midnight-overlap, work-base origin, exact-midnight boundary) |
| `npx jest tests/case-note-routes.test.js` | PASS — 69/69 (includes `describe('editing an approved case note', ...)` at line 1318: void-on-edit, no-op-keeps-approval, audited as `approvalVoided`, re-approval after edit) |
| `npx jest tests/mobile-routes.test.js tests/case-note-routes.test.js tests/clinical-note-provider.test.js tests/clinical-note-deidentify.test.js tests/ai-gateway-boundary.test.js tests/ai-single-gateway-guards.test.js` (combined run) | PASS — 166/166 |
| `DB_NAME=therapy_scheduler_auditg3 DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/case-note-approval-edit.itest.js --runInBand` | PASS — 4/4 (real Postgres: approval-void persists, AI interaction reopens, no-op save keeps approval) |
| `DB_NAME=therapy_scheduler_auditg3 DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/case-note-client-link.itest.js tests/integration/case-note-deidentification.itest.js --runInBand` | PASS — 6/6 |

No integration test exists for `mobile-routes.js` itself (no `*.itest.js`
references `api/mobile`/`mobile-routes`/calendar overlap against real Postgres
— the overlap/dedup fix is unit-tested only, against a mocked `pg`). No test
exists — and none can — proving the external mobile client successfully calls
these APIs; that is impossible to establish from this repository.

## Commits in window touching located files

- `e1af24e` — `backend/database.js`, `backend/mobile-routes.js`,
  `backend/tests/mobile-routes.test.js` (+93 lines of new tests) — mobile diary
  de-duplication and day-overlap fix. RELEVANT.
- `a56173c` — `backend/ai/ai-audit.js`, `backend/case-note-routes.js`,
  `backend/tests/case-note-routes.test.js`,
  `backend/tests/integration/case-note-approval-edit.itest.js`,
  `frontend/current/casenotes.js`, `frontend/current/mockup_v3.html` —
  approval-void-on-edit. RELEVANT.
- `dc5dbc4` — `frontend/current/casenotes.js`, `frontend/current/mockup_v3.html`
  — reverts a56173c's laptop-only UI banner; backend rule unchanged. RELEVANT
  (frontend-only follow-up to the above).
- `08da79d`, `338f5dc` — travel feature / test-timing fix. Not relevant; files
  touched (`routes.js`, `travel-*`, `mockup_v3.html` travel banner) do not
  overlap this feature's located files.

## Open tracker tasks

`[todo]` Case Noting — located (`case-note-routes.js`, not `mobile-routes.js`),
tonight's approval-void-on-edit behaviour is tested unit + integration; no
browser/E2E proof possible from this repo (external mobile client). `[todo]`
Calendar View — located, tonight's de-duplication/overlap fix is unit-tested;
same structural gap on end-to-end device proof.

## Disagreement / notes

Agreement on substance, partial disagreement on specificity (carried over from
last audit). Tracker's `claude_update`: "the mobile API (clients/calendar in
mobile-routes.js; voice-to-case-note clinical AI in case-note-routes.js) is
guarded and fully tested, but nothing in this repository can confirm the real
mobile client calls it correctly." — still accurate tonight, and the tracker
already correctly splits Case Noting into `case-note-routes.js` separately from
`mobile-routes.js`, so last night's naming-precision note has been addressed in
the tracker's own text. `next_action` ("Confirm with the mobile client codebase
… or run the manual device-test checklist") is still the correct single next
step — unchanged by tonight's commits, since both fixes are proven in this
repo's own test suites but, as always, not against the real device/client.
The `needs-refinement` label is correct (both tracker tasks remain `todo`): the
underlying code quality improved materially tonight (two real bugs fixed and
covered by new tests — duplicate/missing calendar entries on the phone, and an
approval attestation that could survive a silent edit), but the open tracker
tasks and the permanent device-proof gap are unchanged, so the label does not
move to `proven`.
