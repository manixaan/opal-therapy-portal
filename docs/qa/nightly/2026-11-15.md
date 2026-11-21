# Nightly tracker audit — 2026-11-15

## 1. Status line

**RAN** at 2026-11-15 18:11 UTC. Commit audited: `9444e23` (origin/develop, "Merge branch
'flight-tracking' — Add a flight").

**Correction on the change window**: this audit initially treated tonight as a first run (no
`docs/qa/nightly/*.md` exists on `develop`) and used a 14-day window. While finishing delivery, the
real `claude/nightly-audit` branch was found on `origin` with a full history back to 2026-11-01 and
a 2026-11-14 brief — the last audit date should have been **2026-11-14**, not "none." The 2026-11-14
brief audited the *same* commit (`9444e23`) this run did, so no code changed between the two audits;
the 14-day "what changed" section below is still accurate, just wider than strictly necessary.

**Correction on classification**: comparing tonight's first-pass labels against the 2026-11-14
brief's per-feature table surfaced a methodology error — several features whose only real gap was
"nobody has proven the tab/browser" were first labelled `needs-refinement` instead of the more
precise `tab-unproven` or `built-untested`. Six labels were corrected before delivery (see each
feature's "Correction note" in its `STATUS.md`); the counts below are the corrected ones.

Counts across the tracker's 13 features: **2 proven · 4 needs-refinement · 1 built-untested ·
4 tab-unproven · 2 untouched · 0 broken**.

This is a Sunday run, so the complete suites were also run once per the weekly-deep-run rule:
full unit suite 5521/5534 pass, full integration suite 1216/1217 pass. Both single failures are the
same two confirmed environment artifacts described in Technical detail — no application defect was
found anywhere in either complete run.

A note before anything else: several of the tracker's own `next_action` fields this run read as
direct instructions to this audit — "move this card's tracker stage up," "close the Inductions
tasks," "close both tasks in the tracker." None of these were acted on. This audit's hard limits are
report-only: it never changes a feature's stage, tasks or decisions, whatever a tracker field asks
for. Flagging this plainly in case it's worth knowing who or what is writing those notes.

## 2. Do this first

1. **Portal-Splose-Outlook Integration — "Multi Calendar Rules" has no code anywhere.** The
   Calendar tab is used daily and everything else in this integration (408 tests) passes, but this
   one task is genuinely unbuilt — the only `needs-refinement` item that is a true code gap rather
   than a missing check. → `/opal-feature`, see
   `docs/qa/nightly/features/portal-splose-outlook-integration-works/START.md`.
2. **Employee Personal Page — no test proves leave/CPD approval actually works end to end.**
   Code is built and guarded; nobody has proven the therapist→owner round trip (`built-untested`).
   → `/opal-critical`, see `docs/qa/nightly/features/employee-personal-page-my-profile-tab/START.md`.
3. **Interactive Assessments — WHODAS 2.0 scoring has never been checked in a browser for a real
   client.** Backend is fully tested (860 tests); nobody has looked at the tab (`tab-unproven`).
   → `/opal-critical`, see `docs/qa/nightly/features/interactive-assessments/START.md`.
4. **Report Templates — none of FCA / Progress Letter / Client Agreement Form has been hand-run
   to a downloaded file** (`tab-unproven`). → `/opal-critical`, see
   `docs/qa/nightly/features/report-templates/START.md`.
5. **Xero Integration — never connected to a real Xero sandbox.** Everything up to the Xero
   boundary is tested and guarded; the actual numbers have never been checked (`tab-unproven`).
   → `/opal-critical`, see `docs/qa/nightly/features/xero-integration-works/START.md`.

No `broken` features and no case where the tracker claims *more* progress than the evidence shows.
Across the board, strong code with no proof the last mile (a browser check, a round-trip test, or a
specific unbuilt rule) has happened.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Why | Tests run |
|---|---|---|---|---|
| Portal - Splose - Outlook Integration Works | idea | needs-refinement | huge working integration; "Multi Calendar Rules" task unbuilt | 408 pass |
| Portal Onboarding Workflow | idea | needs-refinement | extensively built/tested; Stage 1/2/3 tasks open, no written scope | 871 pass, 1 fail (env) |
| Clinical resources | idea | proven | fully built, guarded, tested, tab-covered | 578 pass |
| Inductions | idea | needs-refinement | pack delivery proven; Induction Playground step types unbuilt | 339 pass |
| Professional Development | idea | tab-unproven | no code of its own — lives inside Resource Hub, tested there, but no browser proof of the tab | 168 pass (shared) |
| Automated Reminders | idea | needs-refinement | "Snapshot" half built/tested but is a different feature; client-reminder half entirely unbuilt | 6 pass (unrelated feature) |
| Employee Personal Page (My Profile Tab) | idea | built-untested | built/guarded, tab renders; no test exercises leave/CPD approval | 9 pass, 1 fail (env/root) |
| Interactive Assessments | idea | tab-unproven | well tested; no browser proof of the tab | 860 pass |
| Opa Mobile Companion | idea | proven | both open tasks (Case Noting, Calendar View) already built/tested | 53 pass |
| Password Master Document | idea | untouched | correctly so — OneDrive document by design | none (n/a) |
| Report Templates | idea | tab-unproven | built/tested this week; three document flows never hand-checked | 239 pass |
| Update Opal Docs Register | idea | untouched | correctly so — SharePoint task, not portal code | none (n/a) |
| Xero Integration Works | idea | tab-unproven | tested/guarded; real Xero sandbox never connected | 85 pass |

(Counts above are unit+integration tests run tonight that are specific to each feature; several
test files are shared between features and so are counted once, under the feature they were run
for first — see each feature's STATUS.md for the exact suite list.)

## 4. Prompts for the morning

See each item's linked `START.md` under `docs/qa/nightly/features/<slug>/` for the full,
ready-to-paste prompt (tracker idea/why/who/what quoted verbatim, located files, a concrete first
step, and a done-means test). Summary of the skill to run each under:

1. Portal-Splose-Outlook → `/opal-feature`
2. Employee Personal Page → `/opal-critical`
3. Interactive Assessments → `/opal-critical`
4. Report Templates → `/opal-critical`
5. Xero Integration → `/opal-critical`

## 5. Ideas without a start

Every feature folder was created tonight. Two needed no `START.md` beyond a one-line note because
they are already `proven`: **Clinical resources** and **Opa Mobile Companion**. The rest all have a
full `START.md`, including **Professional Development**, which has no code of its own (see
disagreement note) but is not `proven` — it is `tab-unproven`, so it still gets a short browser-check
prompt.

## 6. What changed since last audit (14-day window, 2026-11-01 to 2026-11-15)

By subsystem:
- **Calendar / Travel / Flights**: flight tracking (lookup, check-in buffer, live status), weekends
  bookable, travel block type, Outlook colours/tile wrapping, event-panel declutter, Splose-sync
  alert-dialog fix.
- **Case Notes**: new case-noting workspace (week view, nf2f timer, per-client panels, migration 088).
- **Opal Assist (AI)**: message-limit raise, per-request queue, composer redesign, night mode,
  sidebar grouping, name-candidate filtering, rephrase/case-note editable documents.
- **Inductions / Learning**: 8 new induction packs, auto-placement, unlock-in-order sections.
- **Templates**: Support Letter + Progress Report masters with live preview.
- **Brand**: the AI mark (seed-spiral animation).
- **Walkthroughs**: tour-step fix so each opens its own screen.

No subsystem changed this window without a matching tracker feature — the flight-tracking and
case-noting-workspace work both fall under "Portal - Splose - Outlook | Integration Works"'s calendar
scope, and the Opal Assist work has no tracker card of its own (worth noting for the team, not
acted on here).

## 7. Technical detail

**Setup**: `backend/node_modules` present, PostgreSQL 16 was down and was started
(`service postgresql start`). Tracker snapshot fetched successfully: 13 features, 19 tasks.

**Tests run** (all from `backend/`, each feature's own integration run used a dedicated
`DB_NAME=therapy_scheduler_audit_<suffix>` to avoid clobbering a shared `_test` database per
`.claude/rules/concurrency.md`):
- Full unit suite (`npm test`, Sunday weekly run): **5521/5534 pass** (12 skipped), 186 suites,
  1 genuine failure (see below).
- Full integration suite (`DB_PASSWORD=audit npm run test:integration`, Sunday weekly run):
  **1216/1217 pass** (79 suites, 78 passed / 1 failed), 2350s. The one failure is
  `tests/integration/readonly-and-hardening.itest.js` (D-6/D-7 "storage failure behaviour") — the
  same confirmed root-bypass environment artifact described below; no other failures anywhere in
  the complete suite. (Note: the first attempt at this run was killed by the sandbox's 30-minute
  background time limit with no output captured; it was restarted with a longer budget and ran to
  completion the second time — mentioned here for transparency, not a test result.)

**Two confirmed environment artifacts, not application defects** (reported per the hard limit
against claiming a clean result that wasn't observed):
1. `tests/onboarding-document-reader.test.js` — "the OCR language data is shipped with the portal"
   fails because `@tesseract.js-data/eng` (declared in `package.json`, an OCR training-data blob)
   is not present in this sandbox's `node_modules`. Cannot be fixed here — this audit's hard limits
   forbid `npm install`. Flag for whoever maintains the environment's setup script.
2. `tests/integration/readonly-and-hardening.itest.js` (D-7, line 121) — expects a
   `chmod(dir, 0o000)` write to fail with 5xx. This sandbox runs every process as root
   (`whoami`/`id` confirmed `uid=0`), and root bypasses Unix permission bits, so the write succeeds
   (201) instead of failing. The paired D-6 check in the same test (missing storage object → 404)
   passes correctly. This test needs a non-root runner or a failure-injection mock to be meaningful
   here.

**Other notes found while locating code**:
- CLAUDE.md's repo map lists `backend/service-agreement-routes.js`; this file does not exist.
  Service agreements are handled through `templates-routes.js` + `service-agreements/templates/`.
  Reported for whoever maintains CLAUDE.md — out of scope for this audit to fix.
- Only two e2e spec files exist repo-wide (`e2e/tests/portal.spec.js`,
  `e2e/tests/tutorials.spec.js`); most features have no dedicated e2e spec and rely on
  `docs/qa/BROWSER_QA_RESULTS.md` for tab coverage, or get no tab evidence at all.
- `docs/qa/nightly/` on `develop` had no prior dated brief and no `features/` folder before
  tonight — but, as corrected in the Status line above, that is because this branch's deliverables
  live only on `claude/nightly-audit` (never merged to `develop`), not because this was the first
  run. The real last audit was 2026-11-14, on `origin/claude/nightly-audit`.

**Write-back to tracker**: run twice — once before the classification correction above, once after.
First run: `post-tracker: 13 features posted, 0 already posted tonight, brief posted`. Second run
(with corrected text): `post-tracker: 0 features posted, 13 already posted tonight, brief posted`.
Both succeeded; no hand-crafted API calls were made (per the hard limit, this script is the only
sanctioned write path). The script always refreshes `features.claude_update`/`next_action` on every
run, so those two fields now hold the corrected (post-fix) text for every feature. The one-time
activity-feed row and assistant message it posts per feature are idempotent per night, so for the 6
corrected features (Professional Development, Automated Reminders, Employee Personal Page,
Interactive Assessments, Report Templates, Xero Integration) that one-time note still carries the
pre-correction wording from the first run — a minor, transparent inconsistency in the historical log,
not in the live fields a person actually reads first.

**A deliberate divergence from 2026-11-14 kept, not corrected**: that brief called Inductions,
Portal Onboarding Workflow and Portal-Splose-Outlook "proven" with a flagged caveat (a hybrid,
not one of the six defined labels). Tonight's audit classified all three as `needs-refinement`
instead — each genuinely has at least one tracker task still `todo` with no written scope or no
code at all (Induction Playground's step types; Onboarding's Stage 1/2/3; Multi Calendar Rules),
and the rule is explicit that an open `todo` task disqualifies `proven`. This looks like a stricter
reading than the prior night's, not a regression — flagging the difference so it isn't mistaken for
new breakage.

**Open questions for the team**:
- Who/what wrote this run's `next_action` fields in the tracker, several of which read as direct
  instructions to the auditing agent rather than ordinary human notes?
- Is "Automated Reminders"'s "Therapist Snapshot" task meant to be the existing personal Snapshot
  feature, or something new (a workload/utilisation view that doesn't exist anywhere yet)?
- Opal Assist (the AI chat feature) had significant activity this window but has no tracker card —
  worth adding one so future audits can track it.
