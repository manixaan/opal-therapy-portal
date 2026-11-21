# Nightly tracker audit — 2026-11-21

## 1. Status line

**RAN** · 2026-11-21 18:36 UTC · commit `aa8200f` (origin/develop) · proven: 1, built-untested: 2,
needs-refinement: 5, broken: 0, untouched: 2, tab-unproven: 3 (13 features total).

**A very active day** — 77 commits landed in `backend/` and `frontend/current/` since the last audit
(2026-11-20 18:52 UTC): a large calendar/booking/travel/Splose-Outlook-sync landing (~70 commits —
accessibility, gesture and rendering polish, a redesigned one-button Sync popup, an Outlook-text
security fix) and a new NDIS travel-billing rule book feeding invoicing/Xero (~14 commits — batch
invoice sending, one-Xero-copy-per-invoice, a payer directory). Every targeted unit and integration
test for every one of the 13 features was re-run fresh tonight: **101 unit test files (unchanged
feature counts carried, two heavily-touched features' counts rose sharply) and 41 integration test
files**, all green except the one known environment artifact below. No classification changed from
last night. No disagreement was resolved; two disagreements (Portal - Splose - Outlook, Xero
Integration Works) are now backed by substantially more evidence.

## 2. Do this first

1. **[/opal-feature] Automated Reminders — tracker ahead of the evidence, 7 nights running.** The
   Therapist Snapshot task's own checklist still marks "Create minimise function on snapshot" as
   done, but no matching code exists in `frontend/current/reports.js` or anywhere else — only a
   narrower "Completed" sub-list collapse (`swCompletedCollapsed()`) and an unrelated minimise on the
   separate Opa AI chat widget. Confirmed again tonight, 2026-11-15 through 2026-11-21.
2. **[/opal-critical] Portal - Splose - Outlook — a large subsystem grew hugely again overnight, one
   checklist item still open.** ~70 of tonight's 77 commits landed here (calendar a11y/gesture
   polish, booking panel, travel-leg display, NF2F timer, a redesigned Sync popup). Guards and all
   2,290 unit + 133 integration tests pass fresh. The one tracker task, Multi Calendar Rules, remains
   a human checklist against the live portal; nothing tonight touched it.
3. **[/opal-critical] Xero Integration Works — substantial new invoicing/billing work, still never
   confirmed against a real Xero sandbox.** 14 commits built a new NDIS travel-billing rule book,
   batch invoice sending and a payer directory (215 unit + 90 integration tests, all passing — every
   one of them against a mocked Xero client). The live-sandbox-in-a-browser gap is unchanged.
4. **[/opal-critical] Opa Mobile Companion — not actually proven.** Don't close its two tracker tasks
   on test counts alone (171 unit + 13 integration backend tests prove the API, not the device
   experience). Run the manual device walkthrough the task itself asks for.
5. **[/opal-critical] Employee Personal Page & Professional Development — the same untested gap,
   possibly the same card.** Neither tracker card has a test proving the leave/CPD approval round
   trip (`/api/profile/leave`, `/api/profile/cpd`). These two cards point at the exact same
   `backend/profile-routes.js` and the same test gap — worth deciding whether they are the same piece
   of work tracked twice.

No `broken` feature was found anywhere in this run — no unguarded routes, no `node --check` failures.
The one failing test (`tests/onboarding-document-reader.test.js`, a missing OCR package) is a
seven-night-running environment artifact, not a code defect — see Technical detail.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Xero Integration Works | idea | tab-unproven | A new NDIS travel-billing rule book, batch invoice send and a payer directory landed tonight (215 unit + 90 integration tests) — but every Xero call in every test is mocked; a real sandbox connection is still never confirmed live. | 12u/215✓, 6i/90✓ |
| Update Opal Docs Register | idea | untouched | Organising/SharePoint task — no code expected. | none |
| Report Templates | idea | tab-unproven | FCA/Letter/Agreement generation built & tested (625 tests); three document flows never hand-checked. A cosmetic 2-line change to reports.js tonight (unrelated time-format consolidation) has no effect. | 14u/598✓, 1i/27✓ |
| Password Master Document | idea | untouched | Tracker says to keep this on OneDrive — no portal action. | none |
| Opa Mobile Companion | idea | needs-refinement | AI-governed case-note path built & tested; device walkthrough not yet done. | 5u/171✓, 4i/13✓ |
| Interactive Assessments | idea | tab-unproven | WHODAS 2.0 built & tested (565 tests); no browser proof of the tab. | 6u/484✓, 2i/81✓ |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Built & guarded; no test proves the leave/CPD approval round trip. | 4u/94✓, 0i |
| Automated Reminders | idea | needs-refinement | Appt reminders: no code at all. Snapshot: built & tested but a checklist/code mismatch persists (only a narrower "Completed"-list collapse exists, not a whole-panel minimise). | 0u, 1i/6✓ |
| Professional Development | idea | built-untested | Lives inside My Profile's CPD section; shares Employee Personal Page's code and its untested round trip. | 4u/94✓ (indirect), 0i |
| Inductions | idea | needs-refinement | Learner side proven by E2E; builder/AI-helper/photo-step work still open. | 3u/92✓, 2i/7✓, E2E✓ |
| Clinical resources | idea | proven | Built, guarded, fully tested, E2E-proven, no open task — tracker underclaims this one. | 12u/398✓, 7i/168✓, E2E✓ |
| Portal Onboarding Workflow | idea | needs-refinement | Extensively built/tested (812/813 tests); real gap is SharePoint storage for Stage 2. | 24u pass/1u env-artifact, 8i/208✓ |
| Portal - Splose - Outlook \| Integration Works | idea | needs-refinement | ~70 of tonight's 77 commits landed here (calendar, booking, travel, NF2F, Sync popup redesign) — guards and a much larger test suite all pass; the one open item is the Multi Calendar Rules human checklist. | 63u/2290✓, 15i/133✓ |

## 4. Prompts for the morning

**1. Automated Reminders (tracker-ahead disagreement)**
```
/opal-feature
Check whether the Development Manager tracker's "Create minimise function on snapshot" checklist item under
the Therapist Snapshot task (feature 398a0b36-a12f-4190-83e4-b3a8932b3b46) has a real whole-panel implementation
anywhere in frontend/current/reports.js or its CSS. A narrower "Completed" sub-list collapse already exists
(swCompletedCollapsed()/swToggleCompleted()) but nothing minimises the whole Snapshot widget. Either build the
whole-panel minimise or un-tick the checklist item to match what exists. Done means: the checklist and the code
agree.
```

**2. Portal-Splose-Outlook — Multi Calendar Rules checklist**
```
/opal-critical
Walk the Multi Calendar Rules checklist against the live portal: book a session, confirm the "changes saved
but not synced" indicator, check travel-time calculation, and confirm Portal/Splose match in both directions.
This subsystem grew hugely again overnight (calendar accessibility/gesture polish, booking panel, travel-leg
display, NF2F timer, a redesigned one-button Sync popup) — 2,290 unit + 133 integration tests all re-confirmed
passing. This is a verification pass against the live portal, not a build task. Done means: each checklist
item is manually confirmed with no bug found.
```

**3. Xero Integration Works — confirm a real sandbox connection**
```
/opal-critical
Confirm a real Xero sandbox connection live in a browser and record it in docs/qa/BROWSER_QA_RESULTS.md.
Tonight landed a new NDIS travel-billing rule book, batch invoice sending and a payer directory
(backend/billing/travel-billing.js, backend/billing/invoice-lifecycle.js, backend/billing/payer-directory.js) —
215 unit + 90 integration tests all pass, but every one of them mocks the Xero client
(backend/xero-api.js, backend/xero-payroll-connection.js). No test here can prove a real Xero call works; only
a browser session against a sandbox tenant can. Done means: a sandbox connection is confirmed working and
recorded.
```

**4. Opa Mobile Companion — device walkthrough**
```
/opal-critical
On the test device, dictate a case note through the Opa Mobile Companion app and confirm it reaches
backend/case-note-routes.js's generateGovernedDraft() (linked by voiceNoteId) and produces a usable draft
linked to the right client. This is a manual walkthrough first — only write code if the walkthrough finds a
real defect. Done means: the walkthrough is recorded as passing (or the defect found is filed as its own task).
```

**5. Employee Personal Page & Professional Development — decide and test the leave/CPD round-trip**
```
/opal-critical
Two Development Manager cards — "Employee Personal Page (My Profile Tab)" (83bb9988-52ba-4f8c-85ba-7b65aca189b2)
and "Professional Development" (37f4e057-ae96-4a9e-a576-5f808b7dc8fb) — point at the same code
(backend/profile-routes.js) and the same untested gap. First, decide in the tracker whether they should merge.
Then add an integration test exercising /api/profile/leave and /api/profile/cpd end to end (approve and
reject paths). Done means: the round trip has a passing integration test; evidence label moves off
built-untested.
```

## 5. Ideas without a start

- **Xero Integration Works** — START.md's "Where it lives today" and "Start here" were rewritten tonight to
  reflect the new travel-billing/payer-directory work and the bigger test counts; the next step (confirm a
  real sandbox connection) is unchanged.
- **Portal - Splose - Outlook | Integration Works** — same: START.md's file list and test counts were
  rewritten to reflect tonight's ~70-commit landing; the next step (walk the Multi Calendar Rules checklist)
  is unchanged.

No other feature's START.md changed tonight — none of the other 11 crossed into or out of `proven`, and none
had a location correction.

## 6. What changed since last audit

77 commits landed in `backend/` and `frontend/current/` between 18:52 UTC 2026-11-20 and tonight, in two main
groups:

- **Calendar / booking / travel / NF2F / Splose-Outlook sync (~70 commits)** — accessibility and keyboard
  focus fixes, gesture-cancel and drag-resize polish, a now-line and time-range consolidation, short-tile and
  overlap fixes, a redesigned one-button Sync popup with a "To check" outside-events tab, server-saved
  side-panel notes, travel-leg rendering and routing fixes (Splose-address suburb parsing, Outlook-mirror
  safety, a failing-route backoff), an Outlook-event-text escaping security fix
  (`775aa2a frontend-xss-guards`), and a block of generic calendar tech-debt/performance items tagged
  P-05 through P-09, U-09, U-11, U-15, U-18, Q-07, Q-09, T-04, T-05, T-08, C-06, C-08 and C-19 in commit
  subjects. **These tech-debt/polish commits have no dedicated tracker card** — they fall under the general
  "Portal - Splose - Outlook" subsystem by file location, but the tracker has no card for calendar
  accessibility/performance work specifically; worth a card if the team wants it tracked on its own.
- **Billing / invoicing / Xero (~14 commits)** — a new NDIS travel-billing rule book (direct-vs-detour,
  mixed-zone days, trip travel hours), batch invoice sending, one-Xero-copy-per-invoice numbering, a new payer
  directory, and a follow-up closing "the Xero and email gaps found in review". All under "Xero Integration
  Works".

Five new migrations landed this window (`082`, `083`, `089`–`093`) — all applied cleanly inside each
integration-test worker's isolated schema setup; none were run standalone by this audit, per the hard limits.

## 7. Technical detail

**Setup.** PostgreSQL was down at the start of this run (`service postgresql status` → `down`) and was started
successfully (`service postgresql start`). `backend/node_modules/.bin/jest` was present — no install needed.
Tracker snapshot pulled via `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node
../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json` → `fetch-tracker: 13 features, 19 tasks ->
/tmp/tracker.json`. Window start taken from the 2026-11-20 brief's own status line (RAN 18:52 UTC), not just
the filename date.

**Verification approach.** Given the volume of change, verification was split across four parallel workers
(background sub-agents sharing this session's context): one each for Portal - Splose - Outlook and Xero
Integration Works (the two heavily-touched features), and two more covering the remaining nine
untouched-this-window features. Every worker re-ran its features' targeted tests fresh rather than carrying
forward prior counts.

**Cross-worker database collision (environment issue, not a code defect).** Multiple workers' integration
suites ran concurrently against the literal `DB_NAME=therapy_scheduler_audit` named in `PROMPT.md` step 3,
causing `deadlock detected` errors on `TRUNCATE` and one run of spurious 401s/107 failures. Every worker that
hit this re-ran against an isolated database name (e.g. `therapy_scheduler_audit_calsync`,
`_invoicing`, `_auditb`) and got a clean pass; the numbers reported in section 3 and in each feature's
STATUS.md are from the clean, isolated runs. **Recommendation for tomorrow's bootstrap: give each parallel
verification worker its own `DB_NAME` suffix from the start**, rather than discovering the collision mid-run.

**Known environment artifact, confirmed again (7 nights running).** `tests/onboarding-document-reader.test.js`
fails with "Cannot find module '@tesseract.js-data/eng/package.json'". `@tesseract.js-data/eng` is declared in
`backend/package.json` but genuinely absent from `backend/node_modules` in this sandbox (checked directly
tonight). Not fixable from inside this audit — no `npm install` is permitted. First seen 2026-11-15.

**Documentation mismatch (not a functional gap).** `CLAUDE.md`'s repository map names
`backend/service-agreement-routes.js`; that file does not exist in this checkout. Service agreements are
actually generated through `backend/templates-routes.js` + `backend/templates/service-agreement-map.js`
(confirmed again tonight under Report Templates).

**Nothing could not be located this run** beyond the two items already called out above (Automated Client
Appt Reminders has no code; the mobile app's own frontend is outside this repository).

**Write-back.** `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs
/tmp/writeback.json` → `post-tracker: 13 features posted, 0 already posted tonight, brief posted`.

**Open question for the team:** should "Employee Personal Page (My Profile Tab)" and "Professional
Development" be merged into one tracker card? Both point at the same code and the same test gap, confirmed
again tonight.
