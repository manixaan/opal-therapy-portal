# Nightly tracker audit — 2026-11-18

## 1. Status line
**RAN** · 2026-11-18 18:11 UTC · commit `9444e23` (origin/develop — zero commits have touched `backend/` or `frontend/current/` since 2026-11-14, same commit the three prior nights checked) · built-untested: 1, needs-refinement: 5, proven: 1, tab-unproven: 4, untouched: 2 (13 features total).

**A methodology note, repeating one this audit has hit before** (see commit `fce7347` on this branch, 2026-11-15, and the same note on 2026-11-17): `docs/qa/nightly/` is never merged to `develop`, so its real history — four prior nights, 2026-11-14 through 2026-11-17 — only exists on `origin/claude/nightly-audit`. Tonight's run again initially missed it, built a 14-day change window assuming this was a first run, and nearly force-pushed over that history. It wasn't a first run; the mistake was caught before the push went through (the push was rejected as stale, which is what surfaced it), the two histories were merged properly, and every classification below was re-derived from this audit's own fresh evidence and then checked against the 2026-11-17 brief's reasoning rather than copied from it. Twelve of thirteen classifications ended up matching the 2026-11-17 audit exactly; this run's own first pass had independently mislabelled six of them `needs-refinement` before that check caught the same category of mistake the 2026-11-15 correction already describes (confusing a tab/test-proof gap for a functional code gap) — corrected before this brief was finalised.

## 2. Do this first
1. **[/opal-feature] Automated Reminders — tracker ahead of the evidence.** The Therapist Snapshot
   task's own checklist marks "Create minimise function on snapshot" as done, but no matching code was found
   in `frontend/current/reports.js` or anywhere else (only an unrelated minimise on the separate Opa AI chat
   widget). Worth a two-minute look before anyone assumes it works.
2. **[/opal-critical] Opa Mobile Companion — not actually proven.** Don't close its two tracker tasks on
   test counts alone (184 backend tests prove the API, not the device experience). Run the manual device
   walkthrough the task itself asks for.
3. **[/opal-feature] Portal-Splose-Outlook Integration — "Multi Calendar Rules" is a live-portal checklist,
   not code.** Everything else in this integration passes (156 unit + 84 integration tonight); this one task
   is a confirm-and-sign-off checklist against the live portal.
4. **[/opal-critical] Employee Personal Page — no test proves leave/CPD approval actually works end to end.**
   Code is built, guarded, and used by real people; nobody has proven the therapist→owner round trip
   (`built-untested`).
5. **[/opal-critical] Portal Onboarding Workflow — the tracker's own checklists are stale against the code.**
   Stage 1's Letter-of-Offer flow and Stage 2's dynamic employee contract already exist; the one real gap is
   SharePoint document storage, confirmed absent by a repo-wide grep.

No `broken` feature was found anywhere in this run — no unguarded routes, no `node --check` failures. The one
failing test (`tests/onboarding-document-reader.test.js`, a missing OCR package) is a four-night-running
environment artifact, not a code defect — see Technical detail.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Xero Integration Works | idea | tab-unproven | Built & tested (144 tests); real Xero sandbox connection never confirmed in a browser. | 7u/81✓, 5i/63✓ |
| Update Opal Docs Register | idea | untouched | Organising/SharePoint task — no code expected. | none |
| Report Templates | idea | tab-unproven | FCA/Letter/Agreement generation built & tested (625 tests); three document flows never hand-checked. | 14u/598✓, 1i/27✓ |
| Password Master Document | idea | untouched | Tracker says to keep this on OneDrive — no portal action. | none |
| Opa Mobile Companion | idea | needs-refinement | AI-governed case-note path built & tested; device walkthrough not yet done. | 5u/171✓, 4i/13✓ |
| Interactive Assessments | idea | tab-unproven | WHODAS 2.0 built & tested (562 tests); no browser proof of the tab. | 6u/481✓, 2i/81✓ |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Built & guarded; no test proves the leave/CPD approval round trip. | 4u/94✓ (partial), 0i |
| Automated Reminders | idea | needs-refinement | Appt reminders: no code at all. Snapshot: built & tested but a checklist/code mismatch found. | 0u, 1i/6✓ |
| Professional Development | idea | tab-unproven | No dedicated code (lives in Resource Hub or My Profile); no browser proof either way. | 0 (none specific) |
| Inductions | idea | needs-refinement | Learner side proven by E2E; builder/AI-helper/photo-step work still open. | 3u/92✓, 2i/7✓, E2E✓ |
| Clinical resources | idea | proven | Built, guarded, fully tested, E2E-proven, no open task — tracker underclaims this one. | 12u/398✓, 7i/168✓, E2E✓ |
| Portal Onboarding Workflow | idea | needs-refinement | Extensively built/tested (812/813 tests); real gap is SharePoint storage for Stage 2. | 24u pass/1u env-artifact, 8i/208✓ |
| Portal - Splose - Outlook \| Integration Works | idea | needs-refinement | Huge working integration (240 tests); Multi Calendar Rules task itself unbuilt. | 12u/156✓, 9i/84✓ |

## 4. Prompts for the morning
**1. Automated Reminders (tracker-ahead disagreement)**
```
/opal-feature
Check whether the Development Manager tracker's "Create minimise function on snapshot" checklist item under
the Therapist Snapshot task (feature 398a0b36-a12f-4190-83e4-b3a8932b3b46) has a real implementation anywhere
in frontend/current/reports.js or its CSS. If it does, note where; if not, either build it or un-tick the
checklist item. Done means: the checklist and the code agree.
```

**2. Opa Mobile Companion — device walkthrough**
```
/opal-critical
On the test device, dictate a case note through the Opa Mobile Companion app and confirm it reaches
backend/case-note-routes.js's generateGovernedDraft() (linked by voiceNoteId) and produces a usable draft
linked to the right client. This is a manual walkthrough first — only write code if the walkthrough finds a
real defect. Done means: the walkthrough is recorded as passing (or the defect found is filed as its own task).
```

**3. Portal-Splose-Outlook — Multi Calendar Rules checklist**
```
/opal-feature
Walk the Multi Calendar Rules checklist against the live portal: book a session, confirm the "changes saved
but not synced" indicator, check travel-time calculation, and confirm Portal/Splose match in both directions.
backend/splose-sync-routes.js and calendar-routes.js already pass 240 tests — this is a verification pass,
not a build task. Done means: each checklist item is manually confirmed with no bug found.
```

**4. Employee Personal Page — leave/CPD round-trip test**
```
/opal-critical
Add an integration test (follow the pattern in tests/integration/case-note-approval-edit.itest.js) that
submits a leave request via backend/profile-routes.js as a therapist, approves it as an owner, and asserts
the therapist sees the approved status. Do the same for one CPD item. Done means: the new test file passes.
```

**5. Portal Onboarding Workflow — SharePoint storage for Stage 2**
```
/opal-critical
Re-tick the Stage 1/2 checklists in backend/onboarding-employee-routes.js and onboarding-pack-routes.js
against the running code — most items are further along than the checklist shows — then add SharePoint
storage for Stage 2 documents, confirmed absent by a repo-wide grep. Done means: Stage 2 documents land in
SharePoint and the checklist matches reality.
```

## 5. Ideas without a start
No feature folder was newly created tonight — all 13 have existed since the audit's first nights
(2026-11-14). `clinical-resources/START.md` stays in its two-line *proven* form (built, guarded, fully
tested, E2E-proven, no open task). Every other `START.md` was rewritten tonight with this run's own
fresh file/test detail, but none changed evidence label from the 2026-11-17 audit except where this run's
own methodology check (see Status line) caught and corrected a mislabelling in its own first pass before
finalising — so the net change in labels from last night is zero.

## 6. What changed since last audit
**Since the last audit (2026-11-17 to 2026-11-18): nothing.** Zero commits touched `backend/` or
`frontend/current/` in that window — `develop` is still at the same commit (`9444e23`) the 2026-11-16 and
2026-11-17 audits both checked.

For orientation, the 31 commits that landed between 2026-11-04 and 2026-11-14 (all already accounted for by
the 2026-11-14/15 audits, not new tonight) grouped by subsystem:

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

**Subsystems that changed (back in that window) but have no tracker feature card at all:** Opal Assist /
"Opa" AI chat (a large, actively developed feature with zero presence in the Development Manager),
Flights/Travel (`flight-routes.js`, `flights.js`), and Smart Booking's weekend/no-working-hours change
(`booking-rules.js`, `availability-engine.js`). Still true tonight — worth adding cards for at least the
first two so the tracker reflects what the team is actually building.

## 7. Technical detail
**Commands run** (all from `backend/`, targeted per feature — no complete suite run; this is not a Sunday):

- `node --check` on all 198 `backend/*.js` files — clean, no syntax errors.
- Unit (`npx jest tests/<file>.test.js`): 24 separate batched runs covering every feature's located test
  files, re-run fresh tonight (not copied forward). 1 failure: `tests/onboarding-document-reader.test.js`
  (`@tesseract.js-data/eng` module missing from `node_modules`) — this is the SAME environment/install
  artifact independently confirmed on 2026-11-15, -16 and -17; flagging again for whoever maintains the
  environment's setup script. Every other unit file passed.
- Integration (`DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config
  jest.integration.config.js ... --runInBand`): 6 batched runs across 38 `.itest.js` files, all passed
  (migrations applied cleanly; `therapy_scheduler_audit_test` database created fresh by `globalSetup.js`).
- Tracker fetch: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs
  /tmp/tracker.json` — succeeded, 13 features / 19 tasks.
- Tracker write-back: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs
  /tmp/writeback.json` — run twice tonight (once before the methodology correction, once after). Second,
  corrected run: `post-tracker: 0 features posted, 13 already posted tonight, brief posted`. Verified by
  re-fetching the tracker afterwards: `claude_update`/`next_action` reflect the corrected classifications.

**A real limitation from the methodology correction above:** this audit ran `post-tracker.mjs` once
earlier tonight with six classifications later found to be wrong, before the merge with prior history
surfaced the mistake. `claude_update`/`next_action` are unconditionally refreshed on every run (confirmed
by reading `post-tracker.mjs`), so the corrected values below did get posted. But the script skips posting
a fresh assistant message and activity row for a feature already posted the same `audit_date` — by design,
to stay idempotent per night — so the six affected features' Claude threads may still carry tonight's
earlier, incorrect starter-prompt message until tomorrow night's run posts fresh ones. The two
user-facing summary fields on each feature card are correct; the chat-thread message for six features is
one night stale. Hand-crafting a direct PATCH to fix this was deliberately not done — the hard limits
require `post-tracker.mjs` as the only sanctioned write path.

**Could not locate:**
- Any code for Automated Client Appt Reminders (no SMS/email send path, no 24-hour-before scheduler).
- A snapshot-specific "minimise" implementation matching the Therapist Snapshot checklist's ticked item.
- A frontend tab banner specifically for Assessments or for Report Templates (FCA/Letter/Agreement) — these
  appear to live inside wizards/modals reached from elsewhere rather than their own `TAB` banner.
- `backend/service-agreement-routes.js`, which CLAUDE.md's own repo map names — it does not exist. Service
  agreements are actually handled through `templates-routes.js` + `backend/templates/service-agreement-map.js`.
  This is a documentation mismatch to report to whoever maintains CLAUDE.md, not a functional gap.

**Staleness flag:** `docs/qa/BROWSER_QA_RESULTS.md` is dated 2026-08-01 and predates most of the 2026-11-04
window's work (it still describes the Travel & Flights tab as disabled, which is no longer true). Treat
every citation of that document in this brief and in the feature folders as "a browser check happened once,
a while ago," not as current proof.

**Open questions for the team:**
- Should Opal Assist and Flights get their own tracker cards? Both are substantial, actively developed
  features with zero presence in the Development Manager right now.
- Should "Professional Development" be formally merged into either Resource Hub or My Profile, as its own
  next_action already asks? It has no dedicated code or tab today.

