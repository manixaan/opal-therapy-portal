# Nightly tracker audit — 14 November 2026

## 1. Status line

**RAN** · 2026-11-14T18:52:43Z · commit audited:
`9444e23866c55e7766cb87b58887c4da5ecd6ee8` (`develop`) · last audit date
found on `claude/nightly-audit`: 2026-11-13, so tonight's change window is
since then.

Counts across 13 tracker features: **5 proven · 4 tab-unproven · 1
built-untested · 1 needs-refinement · 2 untouched · 0 broken.**

These match the 2026-11-13 audit's counts exactly. Every targeted unit and
integration test was independently re-run tonight rather than copied
forward from the prior night's numbers, and every guard was re-confirmed
by direct grep. Only two features had any commit land since 2026-11-13 —
Opa Mobile Companion (`e222a77`, the case-noting workspace) and
Portal-Splose-Outlook (`8edfa9b`, `c1793d1`, flights and weekend booking)
— and neither changed that feature's classification.

## 2. Do this first

1. **Employee Personal Page (My Profile Tab) — still built-untested.**
   Unchanged for multiple nights: the leave and CPD approval round-trip
   this feature's own task asks someone to verify has zero test coverage.
   One test in the surrounding document-upload suite
   (`readonly-and-hardening.itest.js` D-7) fails on this sandbox for a
   known, recurring reason — it runs as `root`, which defeats the test's
   simulated disk-permission failure — and is not treated as a fresh
   `broken` finding.
2. **Professional Development is still genuinely ambiguous.** Two
   unrelated, real, built subsystems could be meant: the admin PD-events
   catalogue (`backend/resource-hub-r2-routes.js`) or the employee's own
   CPD section of My Profile (`backend/profile-routes.js`). Under either
   reading, no browser proof exists that the page renders. Worth a
   two-minute clarification in the tracker.
3. **Xero Integration Works and Report Templates remain tab-unproven on
   owner-facing, high-risk surfaces.** Both are fully built and tested
   against mocked data (Xero) or entirely at the API layer (FCA/Letter/
   Service Agreement), but neither has real browser or live-sandbox proof.
4. **Interactive Assessments — the tracker's own notes undersell what's
   built.** The tracker's framing (only WHODAS 2.0 is configured) misses
   that FCA and the Progress Report/Support Letter templates are equally
   built and tested — worth telling the team before the "Assessment
   Review" keep/remove triage treats a finished thing as pending.
5. **Portal-Splose-Outlook's Travel block booking type still has no
   browser/E2E proof**, and the feature's own task explicitly asks for a
   live, real-world stress test against real Splose/Outlook accounts that
   no automated suite can substitute for. The base sync machinery itself
   is `proven` (guarded, tested, boundary-verified in a real browser).

No `broken` findings tonight — every located route is guarded, and every
targeted test that could run passed (the known test artifacts above are
explained in Technical detail, not new regressions).

## 3. Every feature

| Feature | Tracker stage | Evidence | Why | Tests |
|---|---|---|---|---|
| Xero Integration Works | idea | tab-unproven | Finance dashboard + payroll-Xero sync built & tested against mocks; no real Xero sandbox or browser check | 81 unit + 63 integration pass |
| Update Opal Docs Register | idea | untouched | Organising job against an external Excel register — not a coding task | none (n/a) |
| Report Templates | idea | tab-unproven | FCA/Letter/Service Agreement engine built & tested; no browser proof of any composer page | 626 unit + 123 integration pass |
| Password Master Document | idea | untouched | OneDrive document, not a portal feature — correctly has no code | none (n/a) |
| Opa Mobile Companion | idea | proven | Mobile Today/Calendar + governed AI case-noting pilot, self-scoped, all tests pass | 123 unit + 10 unit (AI) + 13 integration pass |
| Interactive Assessments | idea | tab-unproven | WHODAS 2.0, FCA and letter templates all built & tested; no browser proof of any | 481 unit + 81 integration pass |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Routes guarded and tab renders; leave/CPD approval round-trip has zero test coverage | 4/5 pass (readonly-and-hardening.itest.js — 1 known sandbox artifact, see below) |
| Automated Reminders | idea | needs-refinement | Therapist Snapshot built & tested; the card's actual idea (client appt reminders) is entirely unbuilt | 6/6 integration pass (Snapshot only) |
| Professional Development | idea | tab-unproven | Two candidate subsystems, both real and built; no browser proof of either | 46 unit pass (admin catalogue); 0 tests (profile CPD) |
| Inductions | idea | proven | Built, guarded, tested, and proven by an existing E2E spec (owner + learner views, Splose content) | 271 unit + 68 integration pass; E2E spec exists |
| Clinical resources | idea | proven | Built, guarded, tested, and proven live on staging (Browser QA flow G) | 398 unit + 168 integration pass; browser QA on record |
| Portal Onboarding Workflow | idea | proven (Stages 1-2); Stage 3 has no scope | Letter of Offer + dynamic contract built & tested, proven live on staging (Browser QA flow C); Stage 3 is an empty task | 646/647 unit (1 missing optional dependency) + 208 integration pass |
| Portal - Splose - Outlook \| Integration Works | idea | proven, 1 flagged gap | Sync-rule engine built, tested, and boundary-verified live (Browser QA rows D/E/F); Travel block booking type and a live real-world stress test remain open | 533 unit + 83 integration pass |

## 4. Prompts for the morning

**1. Employee Personal Page (My Profile Tab) — `/opal-critical`**
> Write an integration test for `/api/profile/leave` and
> `/api/profile/cpd` approve/reject, following the pattern already used
> for `/api/profile/documents` in
> `tests/integration/readonly-and-hardening.itest.js`: a therapist
> submits, an owner approves and sees it reflected, an owner rejects a
> different one with a reason and the therapist sees it. Files:
> `backend/profile-routes.js`. Done when the round trip is proven.

**2. Professional Development — tracker clarification, `/opal-fast-change`
once answered**
> Two different, real, built subsystems could be what this card means:
> the admin PD-events catalogue (`backend/resource-hub-r2-routes.js`,
> `/api/rh2/pd` and `/api/rh2/cpd`) or the employee's own CPD section of
> My Profile (`backend/profile-routes.js`, `/api/profile/cpd`). Pick one
> in the tracker, or merge this card with "Employee Personal Page" if it
> means the CPD section specifically.

**3. Xero Integration Works — `/opal-critical`**
> Connect a real Xero developer sandbox using the OAuth flow already in
> `backend/xero-payroll-connection.js`, sign in as an owner, and confirm
> the Finance tab's dashboard populates with real income/expense/invoice
> figures rather than mocks. Files: `backend/finance-routes.js`,
> `frontend/current/finance.js`. Done when
> `tests/integration/finance-routes.itest.js`'s shape matches a real
> response and a browser check is recorded.

**4. Report Templates — `/opal-feature`**
> As a therapist, open a client record and run all three document flows —
> FCA, Progress Letter, Service Agreement — through to a downloaded file,
> and write (or extend) a Playwright spec under `e2e/tests/` for them,
> following `e2e/tests/tutorials.spec.js`'s house style. Files:
> `backend/templates-routes.js`, `frontend/current/fca.js`,
> `letter.js`, `templates.js`. Done when the new spec passes.

**5. Portal-Splose-Outlook — `/opal-critical`**
> Book a real session as a therapist against live Splose and Outlook
> accounts, confirm it lands correctly in both, pick "Travel block" in
> Smart Booking and confirm it renders correctly on the calendar, then
> edit the booking in Outlook and confirm the drift-detection alert in
> `backend/splose-sync-routes.js` fires correctly. Write up the result.
> Done when a real-world verification session is recorded.

## 5. Ideas without a start

None tonight — every feature folder already existed from prior nights,
and no feature newly reached `proven` tonight (Opa Mobile Companion and
Portal-Splose-Outlook were already `proven` as of 2026-11-13; the latter's
START.md already carried the two-line proven format).

## 6. What changed since last audit

7 commits touched `backend/` or `frontend/current/` since the 2026-11-13
audit, all dated 2026-11-14:

- `9444e23` Merge branch 'flight-tracking' — Add a flight
- `e222a77` feat(casenotes): case-noting workspace — a week's blocks, one
  note per client *(Opa Mobile Companion — shares `case-note-routes.js`)*
- `8edfa9b` feat(calendar): Add a flight — lookup, check-in buffer, drives
  either side, live status *(touches `booking-rules.js` —
  Portal-Splose-Outlook)*
- `c1793d1` feat(booking): weekends bookable, no preset working hours
  *(touches `booking-rules.js`, `scheduler-routes.js` —
  Portal-Splose-Outlook)*
- `e9f1d6b` feat(assist): raise Opal Assist's message limit from 12,000 to
  30,000 characters
- `5120f6d` feat(calendar): declutter the event panel; Allocate billing
  takes a time or a %
- `3a494c7` feat(calendar): Outlook colours, name-first wrapping tiles,
  recolourable legend

**Subsystems that changed but have no tracker feature at all:** Opal
Assist (message limits), the Calendar UI refresh (event panel, tile
colours, billing allocation). Flights/travel tracking is new tonight and
also has no tracker card — it extends `booking-rules.js`, which the
Portal-Splose-Outlook feature already covers, but "Add a flight" itself
is a standalone capability with no card of its own.

## 7. Technical detail

**Environment.** PostgreSQL was not running at start (`service postgresql
status` → down); started manually. `backend/node_modules/.bin/jest` was
present. Tracker fetch via `fetch-tracker.mjs` succeeded: 13 features, 19
tasks.

**Static checks.** All 198 backend modules and all 48 `frontend/current/`
JS files pass `node --check` — zero syntax errors anywhere. No TODO/FIXME
found in any of the 25+ located route files.

**Could not run / dependency gap.** `tests/onboarding-document-reader.test.js`
has one assertion that requires the optional package
`@tesseract.js-data/eng`, which is absent from `backend/node_modules` in
this sandbox (confirmed with `ls`). This was not installed, per the
audit's hard limit against `npm install`/`npm ci`. The other 646 tests in
that run passed; this one could not be evaluated either way.

**Known, recurring sandbox artifact, not a defect.**
`tests/integration/readonly-and-hardening.itest.js`'s D-7 subtest expects
an upload to a `chmod 0o000` directory to fail with `>=500`. This
container runs as `root` (`whoami` → `root`), and root ignores Unix
permission bits, so the simulated write failure never actually happens
here. Confirmed identical and identically explained on multiple prior
nightly audits. Not reported as a fresh `broken` finding (see Employee
Personal Page).

**Self-inflicted concurrency incident during this run, corrected before
reporting.** Partway through tonight's run, an integration suite for
Clinical resources and a separate one for Portal Onboarding Workflow were
briefly pointed at `DB_NAME=therapy_scheduler_audit` at the same time.
Postgres reported a deadlock during table truncation, and the onboarding
suite showed 7 failures that did not reproduce. Both suites were re-run
cleanly, serialised, with no other integration process running — the
clean results (168/168 and 208/208) are what this brief and the feature
STATUS.md files report. No feature classification in this brief rests on
the corrupted run. Lesson recorded for future nightly runs: never start a
second `DB_NAME=therapy_scheduler_audit` integration command while one is
still running — wait for completion first.

**Branch-history correction, made before delivery.** This run initially
drafted every feature folder as if this were the audit's first run (no
prior `docs/qa/nightly/` dates existed on the `nightly-audit-work` branch,
which was checked out from `develop` — `develop` carries no dated briefs
at all, by design; they live only on `claude/nightly-audit`). Before
pushing, a denied force-push surfaced that `origin/claude/nightly-audit`
already holds 13 nights of audit history (2026-11-01 through 2026-11-13).
Every feature's "addressed in window" field, the change-window commit
list, and three features' classifications (Employee Personal Page,
Professional Development, Portal-Splose-Outlook) were corrected against
that real history before this brief and the write-back were finalised.
The tracker write-back (`post-tracker.mjs`) was re-run after these
corrections so the live tracker reflects the corrected findings, not the
draft ones.

**Weekly deep run.** Not applicable tonight (2026-11-14 is a Saturday in
UTC, not Sunday).

**Write-back to the tracker.** `post-tracker.mjs` ran twice tonight: once
before the branch-history correction above (`post-tracker: 13 features
posted, 0 already posted tonight, brief posted`), then again after
correcting the three affected features' wording
(`post-tracker: 0 features posted, 13 already posted tonight, brief
posted`). The script always refreshes each feature's `claude_update`/
`next_action` fields regardless of the "already posted" count, so the
live tracker cards show the corrected wording; the per-feature
`feature_messages` thread (the assistant message carrying the starter
prompt) was only written once, on the first call, since the script is
idempotent per night for that part. The three corrected features (Employee
Personal Page, Professional Development, Portal-Splose-Outlook) therefore
have an accurate card summary but a first-draft starter-prompt message in
their Claude thread tonight — their STATUS.md/START.md files in this
commit are the accurate version.

**Open questions for the team.**
- Should "Automated Reminders" be split into two tracker cards? Its two
  tasks (Therapist Snapshot, built; Client Appt Reminders, unbuilt) are at
  completely different stages, and averaging them into one card hides
  that. (Carried forward from prior nights.)
- "Professional Development" — which subsystem does this card mean? See
  "Do this first" #2.
- "stage 3" of Portal Onboarding Workflow has no title detail, why, or
  technical notes at all — worth filling in or archiving.
- Opal Assist and the Calendar/flights UI work are actively developed
  with no tracker card at all. Worth deciding whether they should get
  one.
