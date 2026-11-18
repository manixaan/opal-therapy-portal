# Nightly tracker audit — 2026-11-18

## 1. Status line
**RAN** · 2026-11-18 18:11 UTC · commit `9444e23` (branch `develop`, as fetched before this audit) · broken: 1, built-untested: 1, needs-refinement: 8, proven: 1, untouched: 2 (13 features total). Tracker write-back and git push results are recorded in Technical detail below — if either step says it did not complete, the rest of this brief still reflects a real audit.

## 2. Do this first
1. **[/opal-critical] Portal Onboarding Workflow — broken.** `tests/onboarding-document-reader.test.js`
   fails because the OCR language pack `@tesseract.js-data/eng` is declared in `backend/package.json` but
   missing from `backend/node_modules` in this environment. This looks like an install gap, not a code bug —
   604 other onboarding tests pass and `node --check` is clean everywhere — but it should be confirmed on a
   real install before being dismissed.
2. **[/opal-feature] Automated Reminders — tracker ahead of the evidence.** The Therapist Snapshot task's
   own checklist marks "Create minimise function on snapshot" as done, but no matching code was found in
   `frontend/current/reports.js` or anywhere else (only an unrelated minimise on the separate Opa AI chat
   widget). Worth a two-minute look before anyone assumes it works.
3. **[/opal-critical] Calendar — a known bug from the last browser QA was never reverified.** The 2026-08-01
   browser QA log records `GET /api/outlook/categories` returning 500 when the signed-in user has no Outlook
   connection. That QA run is now stale (it even says the Travel & Flights tab is "Coming soon", which shipped
   2026-11-14), so this needs a fresh look rather than being carried forward unchecked.
4. **[/opal-critical] Opa Mobile Companion — Case Noting pathway unproven on a device.** The AI-governed
   dictation-to-draft pipeline (`backend/case-note-routes.js` `generateGovernedDraft()`, fed from mobile
   voice notes) is built and passes 184 backend tests, but nobody has walked it end to end on the test device
   yet, and that is exactly what the tracker's own next_action asks for.
5. **[/opal-critical] Employee Personal Page — no integration test for the leave/CPD approval round trip.**
   `backend/profile-routes.js` has the endpoints and partial guard coverage, but no test proves a leave
   request submitted by a therapist is actually approved by an owner and reflected back — the tracker's own
   next_action already names this gap precisely.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Xero Integration Works | idea | needs-refinement | Built & tested; both tasks still todo, Xero sandbox connection not confirmed live. | 7u/81✓, 5i/63✓ |
| Update Opal Docs Register | idea | untouched | Organising/SharePoint task — no code expected. | none |
| Report Templates | idea | needs-refinement | FCA/Letter/Agreement generation built & tested; all 3 tasks todo, no signing page found. | 14u/598✓, 1i/27✓ |
| Password Master Document | idea | untouched | Tracker says to keep this on OneDrive — no portal action. | none |
| Opa Mobile Companion | idea | needs-refinement | AI-governed case-note path built & tested; device walkthrough not yet done. | 5u/171✓, 4i/13✓ |
| Interactive Assessments | idea | needs-refinement | WHODAS 2.0 built & tested; review/triage task still todo. | 6u/481✓, 2i/81✓ |
| Employee Personal Page (My Profile Tab) | idea | needs-refinement | Partial test coverage; no leave/CPD approval round-trip test (tracker already knows this). | 4u/94✓ (partial), 0i |
| Automated Reminders | idea | needs-refinement | Appt reminders: no code at all. Snapshot: built & tested but UI refinements + a checklist mismatch found. | 0u, 1i/6✓ |
| Professional Development | idea | built-untested | Shares code with My Profile; nothing tests the CPD/PD-document endpoints specifically. | 0 (none specific) |
| Inductions | idea | needs-refinement | Learner side proven by E2E; builder/AI-helper/photo-step work still open. | 3u/92✓, 2i/7✓, E2E✓ |
| Clinical resources | idea | proven | Built, guarded, fully tested, E2E-proven, no open task — tracker underclaims this one. | 12u/398✓, 7i/168✓, E2E✓ |
| Portal Onboarding Workflow | idea | broken | Large, mostly-tested workflow; 1 unit test fails on a missing OCR package (env gap, not logic). | 24u pass/1u FAIL, 8i/208✓ |
| Portal - Splose - Outlook \| Integration Works | idea | needs-refinement | Built & heavily tested; live Multi Calendar Rules checklist walkthrough still open. | 12u/156✓, 9i/84✓ |

## 4. Prompts for the morning
**1. Portal Onboarding Workflow (broken)**
```
/opal-critical
Confirm whether @tesseract.js-data/eng is genuinely missing from backend/node_modules (it's declared in
backend/package.json) or whether tests/onboarding-document-reader.test.js needs a different fix. Do not
change onboarding-document-reader.js itself unless the failure turns out to be a real logic bug — check the
environment/install path first. Done means: npx jest tests/onboarding-document-reader.test.js passes.
```

**2. Automated Reminders (tracker-ahead disagreement)**
```
/opal-feature
Check whether the Development Manager tracker's "Create minimise function on snapshot" checklist item under
the Therapist Snapshot task (feature 398a0b36-a12f-4190-83e4-b3a8932b3b46) has a real implementation anywhere
in frontend/current/reports.js or its CSS. If it does, note where; if not, either build it or un-tick the
checklist item. Done means: the checklist and the code agree.
```

**3. Calendar — Outlook categories 500 (recheck)**
```
/opal-critical
As an owner with no Outlook connection, hit GET /api/outlook/categories (backend/calendar-routes.js or
outlook-oauth.js — grep server.js to confirm the exact file) and confirm whether it still 500s instead of
returning an empty/"not connected" result. If it still fails, fix it to return 409 or an empty list as the
2026-08-01 browser QA recommended. Done means: a passing test (new or existing) asserts the non-500 response.
```

**4. Opa Mobile Companion — device walkthrough**
```
/opal-critical
On the test device, dictate a case note through the Opa Mobile Companion app and confirm it reaches
backend/case-note-routes.js's generateGovernedDraft() (linked by voiceNoteId) and produces a usable draft
linked to the right client. This is a manual walkthrough first — only write code if the walkthrough finds a
real defect. Done means: the walkthrough is recorded as passing (or the defect found is filed as its own task).
```

**5. Employee Personal Page — leave/CPD round-trip test**
```
/opal-feature
Add an integration test (follow the pattern in tests/integration/case-note-approval-edit.itest.js) that
submits a leave request via backend/profile-routes.js as a therapist, approves it as an owner, and asserts
the therapist sees the approved status. Do the same for one CPD item. Done means: the new test file passes.
```

## 5. Ideas without a start
All 13 feature folders under `docs/qa/nightly/features/` were created fresh tonight (first run — none
existed before). The one exception is `clinical-resources/START.md`, which was written in its two-line
*proven* form rather than a starter prompt, because the evidence (12 unit test files/398 tests, 7 integration
test files/168 tests, an E2E spec proving the tab, no open tracker task, and the tracker's own next_action
saying "No action needed") clears the bar for `proven` outright.

## 6. What changed since last audit
31 commits touched `backend/` or `frontend/current/` in the 2026-11-04..2026-11-18 window, grouped by
subsystem:

- **Calendar / booking / travel** (9 commits) — flight tracking end to end (lookup, check-in buffer, drives,
  live status), weekends bookable with no preset working hours, Outlook category colours and tile redesign,
  event-panel decluttering, dark-mode calendar fix, Travel block booking type. Feeds the
  **Portal - Splose - Outlook Integration Works** tracker card.
- **Case notes** (1 commit) — the case-noting workspace (a week's blocks, one note per client), which shares
  its AI-governed draft generation path with the **Opa Mobile Companion** tracker card's Case Noting task.
- **Inductions** (8 commits) — seven new induction packs (booking rules, cancellation policy, calendar
  fundamentals, FCA report, progress report, case note writing) plus wording/image/placement cleanup. Feeds
  the **Inductions** tracker card, though all of this is *content*, not the visual-builder/photo-step/AI-helper
  work the card's tasks actually ask for.
- **Clinical letter templates** (3 commits) — Support Letter and Progress Report masters with live
  side-by-side preview. Related to, but distinct from, the three document types named in the
  **Report Templates** tracker card (FCA, Progress Letter, Client Agreement Form).
- **Opal Assist / "Opa" AI chat** (7 commits) — a model-call queue, raising the message limit from 12k to 30k
  characters, a rebuilt composer, client-grouped sidebar, and false-positive-name fixes.
- **Learning** (1 commit) — sections that unlock in order, whole-tile launch.
- **Walkthroughs** (1 commit) — template tour steps open their own screen.

**Subsystems that changed but have no tracker feature card at all:** Opal Assist / "Opa" AI chat (a large,
actively developed feature with zero presence in the Development Manager), Flights/Travel
(`flight-routes.js`, `flights.js` — entirely new in this window), and Smart Booking's weekend/no-working-hours
change (`booking-rules.js`, `availability-engine.js`). Worth adding cards for at least the first two so the
tracker reflects what the team is actually building.

## 7. Technical detail
**Commands run** (all from `backend/`, targeted per feature — no complete suite run; this is not a Sunday):

- `node --check` on all 198 `backend/*.js` files — clean, no syntax errors.
- Unit (`npx jest tests/<file>.test.js`): 24 separate batched runs covering every feature's located test
  files. 1 failure: `tests/onboarding-document-reader.test.js` (`@tesseract.js-data/eng` module missing from
  `node_modules` — see "Do this first" #1). Every other unit file passed.
- Integration (`DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config
  jest.integration.config.js ... --runInBand`): 6 batched runs across 38 `.itest.js` files, all passed
  (migrations applied cleanly; `therapy_scheduler_audit_test` database created fresh by `globalSetup.js`).
- Tracker fetch: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs
  /tmp/tracker.json` — succeeded, 13 features / 19 tasks.
- Tracker write-back: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs
  /tmp/writeback.json` — succeeded: `post-tracker: 13 features posted, 0 already posted tonight, brief posted`.

**Could not locate:**
- A client-facing service-agreement signing page (CLAUDE.md's own repo map names
  `backend/service-agreement-routes.js` and a sign page; neither exists in this checkout).
- Any code for Automated Client Appt Reminders (no SMS/email send path, no 24-hour-before scheduler).
- A snapshot-specific "minimise" implementation matching the Therapist Snapshot checklist's ticked item.
- A frontend tab banner specifically for Assessments or for Report Templates (FCA/Letter/Agreement) — these
  appear to live inside wizards/modals reached from elsewhere rather than their own `TAB` banner.

**Staleness flag:** `docs/qa/BROWSER_QA_RESULTS.md` is dated 2026-08-01 and predates most of this window's
work (it still describes the Travel & Flights tab as disabled, which is no longer true). Treat every citation
of that document in this brief and in the feature folders as "a browser check happened once, a while ago,"
not as current proof.

**Open questions for the team:**
- Should Opal Assist and Flights get their own tracker cards? Both are substantial, actively developed
  features with zero presence in the Development Manager right now.
- Is the Client Agreement Form meant to route through `templates-routes.js` only (generation, no signing), or
  is a dedicated signing page still planned? CLAUDE.md's repo map suggests the latter was once intended.
- Should "Professional Development" be formally merged into either Resource Hub or My Profile, as its own
  next_action already asks? It has no dedicated code or tab today.

