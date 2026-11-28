# Nightly tracker audit — 2026-11-27

## 1. Status line

**RAN** · 2026-11-27T18:48Z UTC · commit audited: `f5fc28d` (tip of `origin/develop`) — the
same commit the 2026-11-26 audit saw; nothing landed in `backend/` or `frontend/current/`
between that audit and tonight's.

**13 features reviewed.** Proven: **1** · Needs refinement: **4** · Built but untested: **3** ·
Tab/page unproven: **3** · Untouched (nothing to build in the portal): **2** · Broken: **0**.

## 2. Do this first

1. **Correcting a 9-night-old error in the audit trail itself.** Every night from 2026-11-18
   through 2026-11-26, this audit reported that the tracker's "Create minimise function on
   snapshot" checklist item (under Automated Reminders → Therapist Snapshot) was false — "no
   matching code was found." It was wrong every one of those nights. `reportPanelGenie` has
   existed in `frontend/current/reports.js` since September (commit `2e3414c`, 2026-09-11) and
   is correctly wired into the snapshot panel's open/close. The checklist is accurate; there
   never was a disagreement here. (This audit's own first pass repeated the same mistake before
   a second look caught it — see §7.) No code action needed; the live tracker's `claude_update`
   text is corrected in tonight's write-back.
2. **"Opal Assist" has no tracker card, and it keeps growing.** This has been flagged
   repeatedly since 2026-11-15 (per this branch's own prior briefs) — an AI
   chat feature with its own client-data read path ("Client file" — a practitioner's case
   notes/sessions/Splose summary pulled into a chat), picture OCR, and document export, all
   correctly registered in the AI gateway (`opal_assist` in `ai-policy.js`), but with no card
   in the 13-feature Development Manager tracker to track it. Nothing changed on it tonight,
   but it remains unresolved. Done means: a human decision on whether it gets its own card.
3. **Employee Personal Page (My Profile Tab)** — the leave and professional-development
   approval workflow has **no automated test anywhere**, even though the rest of the tab is
   guarded and partly tested. Employment-sensitive data; unchanged for many nights running.
4. **Xero Integration Works** — every test passes, but only against a mocked Xero client. A
   real Xero sandbox connection has still never been confirmed live, in a browser, with a real
   account.
5. **Interactive Assessments** — WHODAS 2.0 is fully built and heavily tested (484 unit tests),
   but nobody has opened the Assessment tab as a therapist with a real client and confirmed it
   renders and works.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Why | Tests run |
|---|---|---|---|---|
| Opa Mobile Companion | idea | needs-refinement | API fully tested; Case Noting task still open and the required device walkthrough hasn't happened | unit 170/170, int 34/34 |
| Portal - Splose - Outlook \| Integration Works | idea | needs-refinement | Code+tests+partial browser proof solid; "Multi Calendar Rules" human confirmation checklist still open | unit 912/912 (52 files), int 79/79 (10 files) |
| Automated Reminders | idea | built-untested | Client reminders: zero code. Snapshot: real, working code (its minimise animation genuinely works, see §2.1) with no dedicated test | unit: none dedicated, int 2/2 |
| Portal Onboarding Workflow | idea | needs-refinement | Stage 1 solid; Stage 2's SharePoint storage confirmed missing; Stage 3 empty | unit 653/654*, int 169/169 |
| Clinical resources | idea | **proven** | Guarded, fully tested, real E2E + browser-QA proof, no open task | unit 398/410 (12 skipped), int 232/232 (shared) |
| Inductions | idea | needs-refinement | Learner side E2E-proven; owner-side builder/AI-helper checklist almost entirely open | unit 271/271, int 232/232 (shared) |
| Professional Development | idea | built-untested | Shares Employee Personal Page's code and its untested CPD-approval round trip | unit 398/410 (shared), int 232/232 (shared) |
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

**1 — Opal Assist's tracker card**
```
/opal-feature
Opal Assist (backend/assist-routes.js, frontend Opal Assist widget) has grown a real client-
data read path (Client file, picture OCR, document export) with no card anywhere in the
13-feature Development Manager tracker, flagged every night since 2026-11-15. Decide whether
it needs its own card given how clinically sensitive it now is, and if so create it with the
team's own words for idea/why/who/what/outcome.
Done means: a tracker decision is made and recorded.
```

**2 — Employee Personal Page**
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

**3 — Xero Integration Works**
```
/opal-critical
This is CRITICAL-level work (accounting/Xero, owner-only financial data). Open the Accounting
tab as the owner in a real browser against staging, and attempt the OAuth connect flow with a
genuine Xero developer sandbox account. Record whatever happens — success, or the specific
error — in docs/qa/BROWSER_QA_RESULTS.md. Every automated test so far mocks Xero.
Done means: a real Xero sandbox OAuth attempt is recorded in docs/qa/BROWSER_QA_RESULTS.md.
Tracker: 3d5da727-ee76-4195-8954-2a6486844d77 (see docs/qa/nightly/features/xero-integration-works/START.md)
```

**4 — Interactive Assessments**
```
/opal-feature
Open the Assessment tab as a therapist with a client that has no prior WHODAS record, start a
new assessment, complete it, and record the result in docs/qa/BROWSER_QA_RESULTS.md.
Done means: a browser check of the WHODAS 2.0 flow is recorded, moving this card from
tab-unproven to proven.
Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371 (see docs/qa/nightly/features/interactive-assessments/START.md)
```

**5 — Professional Development / Employee Personal Page**
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

## 5. Ideas without a start

Every `STATUS.md` was rewritten tonight (as it is every night); `START.md` changed for three
cards whose evidence label changed from last night's: **Opa Mobile Companion**
(tab-unproven → needs-refinement — it's a native app, not a `mockup_v3.html` tab, so the
tab-unproven criterion doesn't cleanly fit; needs-refinement matches every other night's call
on this card) and **Professional Development** (needs-refinement → built-untested, to stay
consistent with "Employee Personal Page" sharing the same gap). **Automated Reminders**' label
is unchanged (built-untested) but its `START.md`/`STATUS.md` text changed substantially after
correcting the minimise-function error described in §2.1.

## 6. What changed since last audit

**Nothing.** `origin/develop` sat at commit `f5fc28d` for both the 2026-11-26 audit and
tonight's — zero commits touched `backend/` or `frontend/current/` in between. Every evidence
label above was independently re-verified against the current code and tests tonight rather
than carried forward unchecked, which is how the long-standing minimise-checklist error
(§2.1) was finally caught.

The only thing worth restating from prior nights, since it's still true and still
unaddressed: **"Opal Assist"** (`backend/assist-routes.js`) has real, growing functionality —
client-file lookup, picture OCR, document export, all correctly AI-gateway-governed — and
still no tracker card of its own, flagged repeatedly since 2026-11-15 (see §2.2).

## 7. Technical detail

**Setup**: `backend/node_modules` and PostgreSQL (password `audit`) were pre-installed; no
`npm ci`/`npm install` was run. Tracker snapshot fetched via
`NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs`
→ 13 features, 19 tasks.

**A process note on the audit window, for whoever reads this next**: this run's bootstrap
checked `docs/qa/nightly/` on `origin/develop` for the last audit date, found only `README.md`
there (no dated briefs — they only ever land on the unmerged `claude/nightly-audit` branch,
never on `develop`), and wrongly treated this as a first run, using a 14-day window. It was
not a first run — `claude/nightly-audit` already carried briefs back to 2026-11-15. This was
caught at push time (the remote branch had 662 commits this session's local branch didn't),
corrected by merging that history forward rather than force-overwriting it, and the window was
recalculated correctly (since 2026-11-26, the real last-audit date) before this brief was
finalised. **Next run: check the last audit date from `claude/nightly-audit`'s own history
(e.g. `git log origin/claude/nightly-audit -- docs/qa/nightly/*.md`), not from `develop`.**

**Unit commands run** (from `backend/`, all passed except the one noted environment artifact):
`npx jest mobile-calendar.test.js mobile-event-edit.test.js mobile-move.test.js
mobile-routes.test.js case-note-routes.test.js` (170/170) ·
`npx jest calendar- outlook- splose- travel-` (598/598) plus a second, wider sweep
`npx jest booking- sync- nav- event- drag-` found 11 more relevant files (314/314) —
combined, 912/912 across 52 files for the Splose/Outlook/Calendar feature ·
`npx jest onboarding-` (653/654, 1 environment artifact) ·
`npx jest resource- induction- learning- assign-learning` (669/681, 12 skipped) ·
`npx jest credential-surface-guards.test.js frontend-stage2-guards.test.js
frontend-stage3-guards.test.js onboarding-security.test.js security.test.js
smart-route-backend.test.js` (399/399) ·
`npx jest whodas- assessment-` (484/484) · `npx jest fca- letter- templates-` (626/626) ·
`npx jest finance- xero- invoicing- accounting- payroll-` (74/74) · `npx jest billing-`
(72/72).

**Integration commands run** (`DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit`, all
`--runInBand`, run serially to protect the shared test database, all passed except the one
noted environment artifact): mobile/case-note batch (34/34) · calendar/outlook/splose/travel
batch (79/79) · onboarding batch (169/169) · resource/learning/induction-assistant batch
(232/232) · a 16-file batch covering whodas/assessments/fca-reports/progress-note-letters/
finance/accounting/invoicing/snapshot/profile-functional tests (314/315 — the one failure is
`readonly-and-hardening.itest.js`'s D-6/D-7 test, which `chmod`s a directory to `0o755`
expecting a subsequent write to fail; this sandbox runs as `root`, which ignores Unix
permission bits, so the write succeeds where it would fail for a real non-root deployment —
confirmed environment artifact, not a code defect).

**Weekly deep run**: not applicable tonight — 2026-11-27 UTC is a Friday, not a Sunday.

**Worth a decision from the team**:
- Should "Opal Assist" get its own tracker card? (Asked repeatedly since 2026-11-15.)
- Should "Professional Development" merge into "Employee Personal Page"?
- Is `ONBOARDING_ENCRYPTION_KEY` actually provisioned as its own secret in staging/production
  (not just falling back to `TOKEN_ENCRYPTION_KEY`), given it protects stored tax/bank data?
  This fired as a warning during tonight's onboarding integration tests; it was not possible to
  check the real secret store from this sandbox.

**Write-back**: ran
`NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json`
from `backend/`. Output: `post-tracker: 13 features posted, 0 already posted tonight, brief
posted`.
