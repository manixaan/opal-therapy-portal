# Nightly tracker audit — 2026-11-19

## 1. Status line
**RAN** · 2026-11-19 18:39 UTC · commit `0f14780` (origin/develop) · proven: 1, built-untested: 2, needs-refinement: 5, broken: 0, untouched: 2, tab-unproven: 3 (13 features total).

Tonight is the first night since 2026-11-14 with real code movement: 10 commits landed in the
calendar/booking/travel/notes/sync subsystem between the last audit (2026-11-18) and tonight, all
feeding the **Portal - Splose - Outlook | Integration Works** tracker card. Every other feature's
located files were untouched, and this audit still re-ran every one of their tests fresh tonight
rather than copying last night's numbers forward — every result below was freshly observed. One
label changed: **Professional Development** moves from `tab-unproven` to `built-untested` after a
fresh grep resolved where its code actually lives (see item 4 below) — a location correction, not a
functional change overnight.

## 2. Do this first
1. **[/opal-feature] Automated Reminders — tracker ahead of the evidence.** The Therapist Snapshot
   task's own checklist still marks "Create minimise function on snapshot" as done, but no matching
   code exists in `frontend/current/reports.js` or anywhere else (only an unrelated minimise on the
   separate Opa AI chat widget) — confirmed again tonight, five nights running.
2. **[/opal-critical] Portal - Splose - Outlook — a big night of new code, same open checklist.**
   Ten commits landed tonight (relocate-before-block booking, server-saved side-panel notes, a fixed
   wrong-event bug, a redesigned three-tab Sync popup with a new outside-events review queue). All
   guarded, all tested (456 unit + 126 integration tests now, up from 240 total two nights ago). The
   one tracker task, Multi Calendar Rules, is still a human checklist against the live portal — none
   of tonight's commits touch it.
3. **[/opal-critical] Opa Mobile Companion — not actually proven.** Don't close its two tracker tasks
   on test counts alone (171 unit + 13 integration backend tests prove the API, not the device
   experience). Run the manual device walkthrough the task itself asks for.
4. **[/opal-critical] Employee Personal Page & Professional Development — the same untested gap,
   possibly the same card.** Neither tracker card has a test proving the leave/CPD approval round
   trip (`/api/profile/leave`, `/api/profile/cpd`). Tonight's audit also resolved Professional
   Development's real home: it lives inside My Profile's CPD section, backed by the exact same
   `backend/profile-routes.js` as Employee Personal Page — these may be the same piece of work
   tracked twice.
5. **[/opal-critical] Portal Onboarding Workflow — the tracker's own checklists are stale against the
   code, five nights running.** Stage 1's Letter-of-Offer flow and Stage 2's dynamic employee
   contract already exist; the one real gap is SharePoint document storage, confirmed absent again by
   a repo-wide grep.

No `broken` feature was found anywhere in this run — no unguarded routes (including the new
`backend/block-review-routes.js` and the new `PATCH /api/events/:dbId/notes` endpoint, both guarded),
no `node --check` failures. The one failing test (`tests/onboarding-document-reader.test.js`, a
missing OCR package) is a five-night-running environment artifact, not a code defect — see Technical
detail.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Xero Integration Works | idea | tab-unproven | Built & tested (144 tests); real Xero sandbox connection never confirmed in a browser. | 7u/81✓, 5i/63✓ |
| Update Opal Docs Register | idea | untouched | Organising/SharePoint task — no code expected. | none |
| Report Templates | idea | tab-unproven | FCA/Letter/Agreement generation built & tested (625 tests); three document flows never hand-checked. | 14u/598✓, 1i/27✓ |
| Password Master Document | idea | untouched | Tracker says to keep this on OneDrive — no portal action. | none |
| Opa Mobile Companion | idea | needs-refinement | AI-governed case-note path built & tested; device walkthrough not yet done. | 5u/171✓, 4i/13✓ |
| Interactive Assessments | idea | tab-unproven | WHODAS 2.0 built & tested (563 tests); no browser proof of the tab. | 6u/482✓, 2i/81✓ |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Built & guarded; no test proves the leave/CPD approval round trip. | 4u/94✓, 0i |
| Automated Reminders | idea | needs-refinement | Appt reminders: no code at all. Snapshot: built & tested but a checklist/code mismatch persists. | 0u, 1i/6✓ |
| Professional Development | idea | **built-untested** (was tab-unproven) | Lives inside My Profile's CPD section; shares Employee Personal Page's code and its untested round trip. | 4u/94✓ (indirect), 0i |
| Inductions | idea | needs-refinement | Learner side proven by E2E; builder/AI-helper/photo-step work still open. | 3u/92✓, 2i/7✓, E2E✓ |
| Clinical resources | idea | proven | Built, guarded, fully tested, E2E-proven, no open task — tracker underclaims this one. | 12u/398✓, 7i/168✓, E2E✓ |
| Portal Onboarding Workflow | idea | needs-refinement | Extensively built/tested (812/813 tests); real gap is SharePoint storage for Stage 2. | 24u pass/1u env-artifact, 8i/208✓ |
| Portal - Splose - Outlook \| Integration Works | idea | needs-refinement | **Addressed tonight** — 10 commits, huge new test growth (456 unit + 126 integration); Multi Calendar Rules task itself still unbuilt-as-checklist. | 19u/456✓, 12i/126✓ |

## 4. Prompts for the morning
**1. Automated Reminders (tracker-ahead disagreement)**
```
/opal-feature
Check whether the Development Manager tracker's "Create minimise function on snapshot" checklist item under
the Therapist Snapshot task (feature 398a0b36-a12f-4190-83e4-b3a8932b3b46) has a real implementation anywhere
in frontend/current/reports.js or its CSS. If it does, note where; if not, either build it or un-tick the
checklist item. Done means: the checklist and the code agree.
```

**2. Portal-Splose-Outlook — Multi Calendar Rules checklist**
```
/opal-critical
Walk the Multi Calendar Rules checklist against the live portal: book a session, confirm the "changes saved
but not synced" indicator, check travel-time calculation, and confirm Portal/Splose match in both directions.
This subsystem grew substantially overnight (relocate-before-block booking, server-saved side-panel notes, a
redesigned three-tab Sync popup with a new outside-events review queue) and now passes 456 unit + 126
integration tests — this is a verification pass against the live portal, not a build task. Done means: each
checklist item is manually confirmed with no bug found.
```

**3. Opa Mobile Companion — device walkthrough**
```
/opal-critical
On the test device, dictate a case note through the Opa Mobile Companion app and confirm it reaches
backend/case-note-routes.js's generateGovernedDraft() (linked by voiceNoteId) and produces a usable draft
linked to the right client. This is a manual walkthrough first — only write code if the walkthrough finds a
real defect. Done means: the walkthrough is recorded as passing (or the defect found is filed as its own task).
```

**4. Employee Personal Page & Professional Development — decide and test the leave/CPD round-trip**
```
/opal-critical
Two Development Manager cards — "Employee Personal Page (My Profile Tab)" (83bb9988-52ba-4f8c-85ba-7b65aca189b2)
and "Professional Development" (37f4e057-ae96-4a9e-a576-5f808b7dc8fb) — point at the same code
(backend/profile-routes.js) and the same untested gap. First, decide in the tracker whether they should merge.
Then add an integration test (follow the pattern in tests/integration/case-note-approval-edit.itest.js) that
submits a leave request via backend/profile-routes.js as a therapist, approves it as an owner, and asserts the
therapist sees the approved status; do the same for one CPD item. Done means: the merge decision is recorded
and the new test file passes.
```

**5. Portal Onboarding Workflow — SharePoint storage for Stage 2**
```
/opal-critical
Re-tick the Stage 1/2 checklists in backend/onboarding-employee-routes.js and onboarding-pack-routes.js
against the running code — most items are further along than the checklist shows — then add SharePoint
storage for Stage 2 documents, confirmed absent by a repo-wide grep for the fifth night running. Done means:
Stage 2 documents land in SharePoint and the checklist matches reality.
```

## 5. Ideas without a start
No feature folder was newly created tonight — all 13 have existed since the audit's first nights
(2026-11-14). `clinical-resources/START.md` stays in its two-line *proven* form. Every other
`START.md` was rewritten tonight with fresh file/test detail; the only one whose evidence label
actually moved is `professional-development/START.md`, now reflecting its resolved location inside
My Profile's CPD section and a suggested merge decision with Employee Personal Page.
`portal-splose-outlook-integration-works/START.md` keeps the same `/opal-critical` verification task
but now lists the new files tonight's commits added.

## 6. What changed since last audit
**Since the last audit (2026-11-18 to 2026-11-19): 10 commits, all in one subsystem.** `develop`
moved from `9444e23` (checked unchanged for four nights, 2026-11-14 through -18) to `0f14780`
tonight. Every commit touched calendar/booking/travel/notes/sync — grouped:

- **Calendar / booking / travel** (10 commits) — Smart Booking can now relocate before a report /
  non-face-to-face / telehealth block and do that work at the client's location instead of pushing
  the session later; an event's day can be changed from the side panel; side-panel event notes now
  save to the server and survive reloads/switches (fixing real data loss found by an end-to-end
  check); the side panel now reliably shows the event that was actually clicked (fixed a roughly
  1-in-3 wrong-event bug); a new booking opens scrolled to the top with every group folded; no more
  unwanted automatic trip-home; no forced 15-minute booking rounding; and the Sync popup was
  redesigned into three tabs (Outlook / Splose / Portal) with a new "outside events" block-review
  queue for Outlook/Splose bookings made outside the portal. Feeds the **Portal - Splose - Outlook
  Integration Works** tracker card directly.

For orientation, the 31 commits that landed between 2026-11-04 and 2026-11-14 (already accounted for
by the 2026-11-14/15 audits, not new tonight, and unchanged in substance from the 2026-11-18 brief)
covered Calendar/booking/travel (flights, weekends bookable, tile redesign), Case notes, Inductions
(content packs), Clinical letter templates, Opal Assist / "Opa" AI chat, Learning, and Walkthroughs.

**Subsystems that changed but have no tracker feature card at all:** Opal Assist / "Opa" AI chat (a
large, actively developed feature with zero presence in the Development Manager) and Flights/Travel
remain without cards, unchanged from the last four nights. The block-review ("outside events") queue
added tonight is new ground within the Portal-Splose-Outlook card's territory, not a new uncarded
subsystem — it is calendar/sync infrastructure.

## 7. Technical detail
**Commands run** (all from `backend/`, targeted per feature — no complete suite run; this is not a
Sunday):

- `node --check` on all 198 top-level `backend/*.js` files plus every file under `backend/billing/`,
  `backend/fca/`, `backend/whodas/`, `backend/assessments/` and other two/three-level subdirectories —
  clean, no syntax errors anywhere.
- This run used five parallel audit passes (one per batch of features) instead of one long serial
  pass, each running its own targeted unit/integration commands against its own throwaway
  integration database (`therapy_scheduler_auditA` through `therapy_scheduler_auditE`, per
  `.claude/rules/tests.md`'s guidance on giving concurrent integration runs separate databases) so
  that batches could run at once without corrupting each other's test data. No complete suite was run
  by any pass.
- Unit tests: every feature's located unit test files were re-run fresh tonight (not copied forward).
  1 failure across the whole run: `tests/onboarding-document-reader.test.js` —
  `Cannot find module '@tesseract.js-data/eng/package.json'`. This is the SAME environment/install
  artifact independently confirmed on 2026-11-15 through -18 (five nights running); the package is
  declared in `backend/package.json` but genuinely absent from `backend/node_modules` in this
  sandbox. Not fixable from inside this audit — the hard limit against `npm install` stands. Every
  other unit file passed, including 300 tests across the 7 files new or changed by tonight's
  commits, and 656 tests confirming tonight's frontend asset `?v=` pin bumps (travel.js, booking-route.js)
  were done correctly.
- Integration tests: 5 batched runs across 38 `.itest.js` files, each against its own fresh
  `therapy_scheduler_auditX_test` database (created by `globalSetup.js`, migrations applied cleanly).
  All passed. One non-fatal background "deadlock detected" WARN surfaced inside
  `resource-ingestion.itest.js` from a deferred preview-generation job; the test itself still passed —
  flagged as environment noise, not a defect.
- Tracker fetch: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs
  /tmp/tracker.json` — succeeded, 13 features / 19 tasks.
- Tracker write-back: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs
  /tmp/writeback.json` — `post-tracker: 13 features posted, 0 already posted tonight, brief posted`. Verified by
  re-fetching the tracker afterwards: `claude_update`/`next_action` on the Portal-Splose-Outlook card read back
  exactly as written, with a fresh `updated_at` timestamp.

**A methodology note for whoever reads this run's history:** this audit initially (correctly) treated
`develop`'s `docs/qa/nightly/` as lacking any dated brief, which is expected — that history lives only
on `origin/claude/nightly-audit`, never merged to `develop`. Unlike the 2026-11-18 run's own
methodology note (which describes nearly force-pushing over that history before catching it), tonight
this was caught immediately: the prior branch's `docs/qa/nightly/` tree was pulled into the working
tree before any brief was written, so the last-audit date (2026-11-18) and all 13 feature folders'
prior-night content were available from the start. No corrective re-run was needed tonight.

**Could not locate (unchanged from recent nights):**
- Any code for Automated Client Appt Reminders (no SMS/email send path, no 24-hour-before scheduler).
- A snapshot-specific "minimise" implementation matching the Therapist Snapshot checklist's ticked item.
- A frontend tab banner specifically for Assessments or for Report Templates (FCA/Letter/Agreement) — these
  appear to live inside wizards/modals reached from elsewhere rather than their own `TAB` banner.
- `backend/service-agreement-routes.js`, which CLAUDE.md's own repo map names — it does not exist. Service
  agreements are actually handled through `templates-routes.js` + `backend/templates/service-agreement-map.js`.
  This is a documentation mismatch to report to whoever maintains CLAUDE.md, not a functional gap.
- A standalone "Professional Development" tab or page — resolved tonight to live inside My Profile's CPD
  section instead of being an open either/or between Resource Hub and My Profile.

**Staleness flag (unchanged):** `docs/qa/BROWSER_QA_RESULTS.md` is dated 2026-08-01 and predates most of the
2026-11-04 window's work (it still describes the Travel & Flights tab as disabled, which has not been true
since 2026-11-14). Treat every citation of that document in this brief and in the feature folders as "a
browser check happened once, a while ago," not as current proof.

**Open questions for the team:**
- Should "Employee Personal Page (My Profile Tab)" and "Professional Development" be merged into one
  tracker card? Tonight's audit found they point at the exact same code (`backend/profile-routes.js`,
  the CPD/leave/credentials routes) and share the exact same untested-round-trip gap.
- Should Opal Assist and Flights get their own tracker cards? Both are substantial, actively developed
  features with zero presence in the Development Manager right now — unchanged from the last four nights.
- Should "Professional Development" still be considered for a merge into Resource Hub, as earlier audits
  suggested? Tonight's evidence points to My Profile/CPD as its real, concrete home instead — Resource Hub
  does not appear to hold any Professional-Development-specific content.
