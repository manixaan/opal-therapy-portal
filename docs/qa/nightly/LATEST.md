# Nightly tracker audit — 2026-11-17

## 1. Status line

**RAN** — 2026-11-17 18:11 UTC, commit `9444e23` (origin/develop, same commit the 2026-11-16 audit
checked — zero commits have touched `backend/` or `frontend/current/` since).

Counts across the tracker's 13 features: **1 proven · 1 built-untested · 5 needs-refinement ·
0 broken · 2 untouched (by design, not portal code) · 4 tab-unproven.**

**A methodology note, repeating one this audit has hit before** (see commit `fce7347` on this
branch, 2026-11-15): `docs/qa/nightly/` is never merged to `develop`, so its real history — three
prior nights, 2026-11-14 through 2026-11-16 — only exists on `origin/claude/nightly-audit`. Tonight's
run initially missed it and nearly force-pushed over that history while treating this as a "first
run." It wasn't; this is caught before anything was lost, and tonight's work is built on top of the
2026-11-16 audit rather than replacing it.

**Twelve of thirteen classifications independently confirm the 2026-11-16 audit exactly** (every test
named below was re-run fresh tonight across ten parallel audit passes, each with its own throwaway
database — not copied forward). **One correction**: *Opa Mobile Companion* moves from `proven`
(2026-11-15 and 2026-11-16) to `needs-refinement`. Both of its tracker tasks are still `status: todo`,
and — just like Interactive Assessments, Report Templates and Xero Integration elsewhere in this same
tracker — the open task is asking for a real-world/manual check (dictation accuracy and AI-summary
quality on the actual device) that no automated test can substitute for. The prior "proven" call
leaned on the tracker's own `next_action` ("close both tasks"), which was itself this audit's own
write-back from an earlier night — effectively reading the audit's own prior output back as
independent confirmation. See `docs/qa/nightly/features/opa-mobile-companion/STATUS.md` for the full
reasoning. The corrected `claude_update`/`next_action` has been posted back to the tracker tonight.

## 2. Do this first

1. **Opa Mobile Companion — not actually proven.** Don't close its two tracker tasks on test counts
   alone (435 unit + 3 integration passing proves the API, not the device experience). Run the
   manual device walkthrough the task itself asks for. → `/opal-critical`, see
   `docs/qa/nightly/features/opa-mobile-companion/START.md`.
2. **Portal-Splose-Outlook Integration — "Multi Calendar Rules" has no code anywhere.** Everything
   else in this integration passes (350/350 unit, 103/103 integration tonight); this one task is
   genuinely unbuilt — a confirm-and-sign-off checklist against the live portal, not new code.
   → `/opal-feature`, see `docs/qa/nightly/features/portal-splose-outlook-integration-works/START.md`.
3. **Employee Personal Page — no test proves leave/CPD approval actually works end to end.** Code is
   built, guarded and used by real people; nobody has proven the therapist→owner round trip
   (`built-untested`). → `/opal-critical`, see
   `docs/qa/nightly/features/employee-personal-page-my-profile-tab/START.md`.
4. **Portal Onboarding Workflow — the tracker's own checklists are stale against the code.** Stage
   1's Letter-of-Offer preview/PDF/send and Stage 2's dynamic employee contract already exist; the
   one real gap is SharePoint document storage, confirmed absent by a repo-wide grep. → `/opal-critical`,
   see `docs/qa/nightly/features/portal-onboarding-workflow/START.md`.
5. **Xero Integration — the tracker understates this one.** Financial Dashboard and Payroll
   Automation are both substantially built, owner-guarded and tested (144 passing tests), though
   every checklist item still reads as undone; the one thing never done is a real Xero sandbox
   connection check. → `/opal-critical`, see
   `docs/qa/nightly/features/xero-integration-works/START.md`.

No `broken` feature was found anywhere in this run — no unguarded routes, no `node --check`
failures, no live TODO/FIXME markers.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Why | Tests run tonight |
|---|---|---|---|---|
| Portal - Splose - Outlook \| Integration Works | idea | needs-refinement | huge working integration; "Multi Calendar Rules" task unbuilt | 350 unit + 103 integration pass |
| Portal Onboarding Workflow | idea | needs-refinement | extensively built/tested; checklists stale — real gap is SharePoint storage | 653/654 unit (1 env artifact) + 218 integration pass |
| Clinical resources | idea | proven | fully built, guarded, tested, tab-covered | 410 unit (398 pass/12 skip) + 168 integration pass |
| Inductions | idea | needs-refinement | pack delivery proven; Induction Playground step types + inline AI helper unbuilt | 271 unit + 68 integration pass |
| Professional Development | idea | tab-unproven | no code of its own — lives inside Resource Hub, tested there, no browser proof | covered inside Resource Hub's suite; no dedicated test |
| Automated Reminders | idea | needs-refinement | "Snapshot" half built/partly tested but is a different feature; client-reminder half entirely unbuilt | 6 integration pass (unrelated feature); no unit test |
| Employee Personal Page (My Profile Tab) | idea | built-untested | built/guarded, tab renders; no test exercises leave/CPD approval | 70 unit pass, 41/42 integration pass (1 env artifact) |
| Interactive Assessments | idea | tab-unproven | well tested; no browser proof of the tab | 738 unit + 122 integration pass |
| Opa Mobile Companion | idea | **needs-refinement** (corrected — was `proven`) | both tasks still open; automated tests prove the API, not the real-device experience | 435 unit + 3 integration pass |
| Password Master Document | idea | untouched | correctly so — OneDrive document by design | none (n/a) |
| Report Templates | idea | tab-unproven | built/tested; three document flows never hand-checked | 235 unit + 27 integration pass |
| Update Opal Docs Register | idea | untouched | correctly so — SharePoint task, not portal code | none (n/a) |
| Xero Integration Works | idea | tab-unproven | substantially built/tested (144 tests), understated by its own checklists; real Xero sandbox never connected | 81 unit + 63 integration pass |

## 4. Prompts for the morning

See each item's linked `START.md` under `docs/qa/nightly/features/<slug>/` for the full,
ready-to-paste prompt. Summary of the skill to run each under:

1. Opa Mobile Companion → `/opal-critical`
2. Portal-Splose-Outlook → `/opal-feature`
3. Employee Personal Page → `/opal-critical`
4. Portal Onboarding Workflow → `/opal-critical`
5. Xero Integration → `/opal-critical`

## 5. Ideas without a start

No feature folder was newly created tonight — all 13 have existed since the audit's first nights.
One `START.md` changed materially: **opa-mobile-companion**, because its evidence label changed
(see the correction above) and its starter prompt now reflects "run the manual device walkthrough"
rather than "close both tasks." Several other `STATUS.md` files gained additional, more specific
detail tonight (named below) without changing their label: Portal Onboarding Workflow (the
SharePoint-storage gap is now pinpointed), Xero Integration Works (a wider, more specific file/test
set — 144 tests, not 85), Report Templates (the underlying `backend/templates/` engine structure),
and Automated Reminders (the Snapshot panel's frontend file).

## 6. What changed since last audit (2026-11-16 to 2026-11-17)

Nothing. Zero commits touched `backend/` or `frontend/current/` in this window — develop is still at
the same commit (`9444e23`) the 2026-11-16 audit checked. The tracker's fetched content
(idea/why/who/what/outcome/tasks/decisions) for all 13 features is unchanged apart from the
`claude_update`/`next_action` fields, which carry this and prior audits' own write-back.

For reference, the last *code* change in any of these subsystems landed on 2026-11-14 (the
flight-tracking / calendar-declutter / Outlook-colours / weekends-bookable / Travel-block commits,
plus the desktop case-noting workspace commit `e222a77` whose `nf2f_event_id` addition is shared
with Opa Mobile Companion's backend) — already covered by the 2026-11-15 audit, not new.

## 7. Technical detail

**Setup**: `backend/node_modules` present; PostgreSQL 16 was down and was started
(`service postgresql start`) before any test ran. Tracker snapshot fetched successfully: 13
features, 19 tasks, fetched at 2026-11-17T18:11:24Z. Not a Sunday UTC run (today is Tuesday), so no
complete suite was run anywhere — all testing was file-targeted per the FAST/FEATURE rules.

**Isolation**: ten parallel verification passes, one per subsystem group, each using its own
throwaway integration database (`therapy_scheduler_audit_a_test` through `_j_test`) rather than a
single shared name, specifically to avoid two integration-test processes truncating the same shared
tables concurrently (the documented risk in `.claude/rules/tests.md`'s "Concurrent sessions"
section) — several passes ran at the same time tonight. One accidental concurrent re-run of
`resource-library.itest.js` within a single pass produced two transient false failures; the
duplicate process was stopped and the file re-run alone, cleanly.

**Git history near-miss**: this run initially treated the task as a first-ever audit (no
`docs/qa/nightly/YYYY-MM-DD.md` exists on `develop`, since that path is never merged there) and
built a disconnected commit on top of `origin/develop` instead of `origin/claude/nightly-audit`. The
push was blocked by this environment's own destructive-action safeguard before anything was lost. The
branch was reset to the real `origin/claude/nightly-audit` history, and tonight's findings were
reconciled onto it rather than replacing it (see "Do this first" item 1 and each feature's `STATUS.md`
for where tonight's independent findings added detail or, in one case, corrected a label).

**Test-count drift**: several features' freshly measured test counts differ slightly from the
2026-11-16 audit's own numbers (e.g. Portal-Splose-Outlook 350+103 vs 261+135 quoted; Portal
Onboarding 218 vs 232 integration quoted; Clinical Resources 410 vs 456 quoted). This lineage's own
prior nights have already established that this kind of drift comes from independently-built file
selections (not copied forward), not from a regression — every file run tonight passed either way.
Not investigated further.

**Known non-defects, not reported as `broken`** (same two the 2026-11-15/16 audits found, re-observed
tonight, not assumed):
- `tests/onboarding-document-reader.test.js` fails on `Cannot find module '@tesseract.js-data/eng/package.json'`
  — an OCR training-data package missing from this sandbox's `node_modules`, not a code defect. This
  audit's hard limits forbid `npm install`, so it cannot be fixed from here.
- `tests/integration/readonly-and-hardening.itest.js` case D-7 ("unwritable storage → 5xx") fails in
  this sandbox because the test runs as root, and root's own `chmod 0o000` doesn't block its own
  write. The paired D-6 check in the same test (missing storage object → 404) passes correctly.

**Open questions for the team** (unchanged from prior nights plus one new item): Report Templates'
"FCA" task and Interactive Assessments' FCA report flow both use an `fca` identifier in different
parts of the codebase — unclear whether they're meant to be the same deliverable. CLAUDE.md's repo
map lists `backend/service-agreement-routes.js`, which does not exist; service agreements are
actually handled through `templates-routes.js` + `backend/service-agreements/templates/` (carried
forward from the 2026-11-15 audit, still true tonight, out of scope for this audit to fix).

**Weekly deep run**: not applicable tonight (next Sunday UTC).

**Write-back**: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json` →
```
post-tracker: 13 features posted, 0 already posted tonight, brief posted
```
