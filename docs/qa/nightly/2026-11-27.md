# Nightly tracker audit — 2026-11-27

## 1. Status line

**RAN** · 2026-11-27T18:48Z UTC · commit audited: `f5fc28d` (tip of `origin/develop`) ·
first-ever run of this audit — no prior brief existed, so the change window is the last 14
days (since 2026-11-13).

**13 features reviewed.** Proven: **1** · Needs refinement: **4** · Built but untested: **2** ·
Tab/page unproven: **4** · Untouched (nothing to build in the portal): **2** · Broken: **0**.

## 2. Do this first

1. **Employee Personal Page (My Profile Tab)** — the leave and professional-development
   approval workflow (an employee submits, the owner approves or rejects) has **no automated
   test anywhere**, even though the rest of the tab is well guarded and partly tested. This is
   employment-sensitive data.
2. **Xero Integration Works** — every test passes, but only against a mocked Xero client. A
   real Xero sandbox connection has still never been confirmed live, in a browser, with a real
   account — twelfth night running, now independently confirmed by this audit.
3. **Interactive Assessments** — WHODAS 2.0 is fully built and heavily tested (484 unit tests),
   but nobody has opened the Assessment tab as a therapist with a real client and confirmed it
   renders and works.
4. **Professional Development** and **Employee Personal Page** point at the exact same
   untested gap (CPD approval) under two different tracker cards. Worth merging them or
   deciding which one owns it, before more work goes into either.
5. **Opa Mobile Companion** — the case-noting AI pathway (dictation → AI clinical summary →
   save) passes all 204 of its automated tests, but the only thing that can prove the pilot
   actually works is a person testing it on the physical device, which the tracker's own task
   already asks for and which hasn't happened yet.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Why | Tests run |
|---|---|---|---|---|
| Opa Mobile Companion | idea | tab-unproven | API fully tested; no device walkthrough recorded | unit 170/170, int 34/34 |
| Portal - Splose - Outlook \| Integration Works | idea | needs-refinement | Code+tests+partial browser proof solid; "Multi Calendar Rules" human confirmation checklist still open | unit 598/598, int 79/79 |
| Automated Reminders | idea | built-untested | Client reminders: zero code. Snapshot: real, working code (incl. a minimise animation the tracker correctly marks done) with no dedicated test | unit: none specific, int 2/2 (snapshot) |
| Portal Onboarding Workflow | idea | needs-refinement | Stage 1 solid; Stage 2's SharePoint storage confirmed missing; Stage 3 empty | unit 653/654*, int 169/169 |
| Clinical resources | idea | **proven** | Guarded, fully tested, real E2E + browser-QA proof, no open task | unit 398/398, int 232/232 (shared) |
| Inductions | idea | needs-refinement | Learner side E2E-proven; owner-side builder/AI-helper checklist almost entirely open | unit 271/271, int 232/232 (shared) |
| Professional Development | idea | needs-refinement | Self-tracked CPD log fully proven; shares an untested owner-approval gap with Employee Personal Page | unit 398/398 (shared), int 232/232 (shared) |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Guarded and partly tested; the leave/CPD approval round trip has zero test coverage | unit 399/399 (guard-only), int 20/21** |
| Interactive Assessments | idea | tab-unproven | WHODAS 2.0 fully tested; tab never proven to render for a therapist | unit 484/484, int 2/2 |
| Password Master Document | idea | untouched | Explicitly a OneDrive document task, correctly has no code | none applicable |
| Report Templates | idea | tab-unproven | All 3 document types generate correctly under test; no hand-check of a downloaded file | unit 626/626, int 2/2 |
| Update Opal Docs Register | idea | untouched | Explicitly an Excel/SharePoint task, correctly has no code | none applicable |
| Xero Integration Works | idea | tab-unproven | Heavily tested against a mocked Xero client; real sandbox connection never confirmed live | unit 146/146, int 5/5 |

\* The one onboarding failure (`onboarding-document-reader.test.js`) is a missing OCR model
file in this sandbox, not a code defect.
\** The one failure (`readonly-and-hardening.itest.js`, one test) is this sandbox running as
`root`, which ignores the Unix permission bits the test relies on — not a code defect.

## 4. Prompts for the morning

**1 — Employee Personal Page**
```
/opal-critical
Open backend/profile-routes.js and find the leave approve/reject and CPD approve/reject
routes. Add an integration test, following the pattern in
tests/integration/stage2-pilot-readiness.itest.js, that: submits a leave request as a
therapist, approves it as the owner, and confirms the therapist's view shows the updated
status — then do the same for a CPD credential/document submission.
Done means: new integration tests exercise /api/profile/leave/:id/approve, /reject,
/api/profile/cpd/:id/approve and /reject end to end and pass.
Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2 (see docs/qa/nightly/features/employee-personal-page-my-profile-tab/START.md)
```

**2 — Xero Integration Works**
```
/opal-critical
This is CRITICAL-level work (accounting/Xero, owner-only financial data). Open the Accounting
tab as the owner in a real browser against staging, and attempt the OAuth connect flow with a
genuine Xero developer sandbox account. Record whatever happens — success, or the specific
error — in docs/qa/BROWSER_QA_RESULTS.md. Every automated test so far mocks Xero.
Done means: a real Xero sandbox OAuth attempt is recorded in docs/qa/BROWSER_QA_RESULTS.md.
Tracker: 3d5da727-ee76-4195-8954-2a6486844d77 (see docs/qa/nightly/features/xero-integration-works/START.md)
```

**3 — Interactive Assessments**
```
/opal-feature
Open the Assessment tab as a therapist with a client that has no prior WHODAS record, start a
new assessment, complete it, and record the result in docs/qa/BROWSER_QA_RESULTS.md.
Done means: a browser check of the WHODAS 2.0 flow is recorded, moving this card from
tab-unproven to proven.
Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371 (see docs/qa/nightly/features/interactive-assessments/START.md)
```

**4 — Professional Development / Employee Personal Page**
```
/opal-critical
Confirm with Anthony/Ann which system the "Professional Development" tracker card is actually
about: the self-tracked CPD log (backend/resource-hub-r2-routes.js, already fully tested) or
the owner-approved CPD workflow (backend/profile-routes.js, which "Employee Personal Page"
already tracks as untested). Either merge the two cards or re-scope this one explicitly.
Done means: the card's scope is settled, and if it's the approval workflow, it's merged with
Employee Personal Page's work item above rather than duplicated.
Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb (see docs/qa/nightly/features/professional-development/START.md)
```

**5 — Opa Mobile Companion**
```
/opal-critical
All API-level unit (170) and integration (34) tests pass. On the physical test device, walk
the tracker's own "Case Noting" checklist: dictate a note, check the AI summary follows the
clinical pathway, confirm it saves against the right client, and tick each checklist item as
pass/fail (no written report needed, just tick the boxes).
Done means: the physical-device checklist is walked and each item ticked, or a defect is filed
for any step that fails.
Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613 (see docs/qa/nightly/features/opa-mobile-companion/START.md)
```

## 5. Ideas without a start

All 13 feature folders under `docs/qa/nightly/features/` were created tonight — this is the
first run of this audit, so every folder and every `START.md` is new. From the next run
onward, this section will only list folders that actually changed.

## 6. What changed since last audit

124 commits touched `backend/` or `frontend/current/` in the last 14 days (since 2026-11-13,
the first-run window). By subsystem:

- **Calendar / booking / travel / Splose / Outlook sync** (~95 commits: `fix(calendar)` ×36,
  `fix(travel)` ×11, `feat(calendar)` ×10, `fix(booking)` ×7, plus sync/nav/settings/header/
  tabs/static/boot/security/notes polish) — all under **Portal - Splose - Outlook | Integration
  Works**.
- **Billing / invoicing** (`feat(billing)` ×5, `feat(invoicing)` ×3, `fix(invoicing)` ×1,
  `fix(billing)` ×1) — under **Xero Integration Works**.
- **Mobile** (`feat(mobile)` ×4) and **case notes** (`feat(casenotes)` ×1) — under **Opa
  Mobile Companion**.
- **Snapshot/reports** (`feat(snapshot)` ×1, `fix(reports)` ×2, `feat(reports)` ×1) — under
  **Automated Reminders** (Therapist Snapshot task).

**Subsystem with real activity and no tracker feature at all: "Opal Assist"** — 4 commits
(`feat(assist)`: a client-file lookup inside the chat, picture attachments read by the
portal's own OCR, downloading a reply as Word/PowerPoint, and raising the message limit from
12,000 to 30,000 characters). It is correctly registered in the AI gateway
(`opal_assist` in `backend/ai/ai-policy.js`, with de-identification in
`backend/assist/assist-deidentify.js`) — not a governance bypass — but there is no tracker
card tracking a feature that is clearly under active, real development. Worth adding one.

A handful of general shell-polish commits (`feat(ui): Settings gear icon`, `fix(nav): tab
strip`, `style(header)`, `fix(tabs)`, `fix(settings)` ×2) don't belong to any single tracker
feature — ordinary cross-cutting UI maintenance, not flagged as a gap.

## 7. Technical detail

**Setup**: `backend/node_modules` and PostgreSQL (password `audit`) were pre-installed; no
`npm ci`/`npm install` was run. Tracker snapshot fetched via
`NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs`
→ 13 features, 19 tasks.

**Unit commands run** (from `backend/`, all passed except the one noted environment artifact):
`npx jest mobile-calendar.test.js mobile-event-edit.test.js mobile-move.test.js
mobile-routes.test.js case-note-routes.test.js` (170/170) ·
`npx jest calendar- outlook- splose- travel-` (598/598) ·
`npx jest onboarding-` (653/654, 1 environment artifact) ·
`npx jest resource- induction- learning- assign-learning` (669/681, 12 skipped) ·
`npx jest credential-surface-guards.test.js frontend-stage2-guards.test.js
frontend-stage3-guards.test.js onboarding-security.test.js security.test.js
smart-route-backend.test.js` (399/399) ·
`npx jest whodas- assessment-` (484/484) · `npx jest fca- letter- templates-` (626/626) ·
`npx jest finance- xero- invoicing- accounting- payroll-` (74/74) · `npx jest billing-`
(72/72).

**Integration commands run** (`DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit`, all
`--runInBand`, all passed except the one noted environment artifact):
mobile/case-note batch (34/34) · calendar/outlook/splose/travel batch (79/79) · onboarding
batch (169/169) · resource/learning/induction-assistant batch (232/232) · a 16-file batch
covering whodas/assessments/fca-reports/progress-note-letters/finance/accounting/invoicing/
snapshot/profile-functional tests (314/315 — the one failure is the `readonly-and-hardening`
root/chmod artifact described above).

**Weekly deep run**: not applicable tonight — 2026-11-27 UTC is a Friday, not a Sunday.

**Audit-process note, for transparency**: this run's locate step for "Automated Reminders"
initially missed `frontend/current/reports.js` (it only found the backend
`snapshot-routes.js`/`billing/snapshot-hours.js`) and, on that incomplete basis, wrongly
flagged the tracker's "Create minimise function on snapshot" checklist item as false. A second
pass, triggered by noticing three `fix(reports)`/`feat(reports)` commits in the window that
didn't map to any already-located file, found `reports.js` and the real, working
`reportPanelGenie` animation — the checklist item is accurate, and the STATUS.md was corrected
before this brief was written. No other feature's commit list showed a similar unmapped
file, but this is a first run, so treat that as reasonable confidence, not certainty.

**Worth a decision from the team**:
- Should "Opal Assist" get its own tracker card?
- Should "Professional Development" merge into "Employee Personal Page"?
- Is `ONBOARDING_ENCRYPTION_KEY` actually provisioned as its own secret in staging/production
  (not just falling back to `TOKEN_ENCRYPTION_KEY`), given it protects stored tax/bank data?
  This fired as a warning during tonight's onboarding integration tests; it was not possible to
  check the real secret store from this sandbox.

**Write-back**: ran
`NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json`
from `backend/`. Output: `post-tracker: 13 features posted, 0 already posted tonight, brief
posted`.
