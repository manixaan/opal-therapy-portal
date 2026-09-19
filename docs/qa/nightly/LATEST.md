# Nightly tracker audit — 2026-09-18

## 1. Status line

**RAN** · 2026-09-18T19:20Z UTC · commit `0726dde` (origin/develop) · this is the busiest night on record for this audit — 44 commits landed in the ~24 hours since the last audit (2026-09-17T18:21Z UTC, commit `b6a8ad4`), the heaviest single-night change volume since the audit started.

Counts across the tracker's 13 features: **broken 0 · proven 1 · tab-unproven 7 · needs-refinement 1 · built-untested 1 · untouched 3**. For comparison, last night was broken 3 · proven 4 · tab-unproven 4 · untouched 2 · built-untested 0. The zero-`broken` count is genuine progress (see item 1 below), but several labels moved to a more conservative, more consistent standard tonight rather than getting worse in the code itself — see "Do this first" and each feature's Disagreement section for why.

## 2. Do this first

1. **Report Templates — three FCA layout commits shipped with zero test coverage of the visual result.** Commits `05b4376` (footer table geometry), `c09883c` (Opal logo into the running header) and `c4f124b` (Anti-Bribery-and-Corruption-Standard physical sizing — fonts, margins, table widths) changed only the binary Word master and `template-map.js`, with no matching test file change. Everything else in this 15-commit FCA rework is asserted at real document-XML level and passes (563 unit + 120 integration tests, all green) — these three are the exception, and they're exactly the kind of change (visual layout of a clinical document) where "it built and nothing crashed" isn't the same as "it looks right." Nobody has opened a generated FCA report in Word since these landed.
2. **The tracker itself is still stuck on "idea" for all 13 cards, three audits running.** Tonight's evidence: 1 proven, 7 tab-unproven (all past "idea" — built, guarded, tested, just missing a fresh browser pass), 1 needs-refinement, 1 built-untested, and only 3 genuinely untouched (2 of which aren't code at all). This has been flagged every night since the audit started; it's not the code's fault, it's a tracker-hygiene gap, and it keeps this report's "disagreement" section restating the same thing.
3. **Good news: Portal Onboarding Workflow's two standing regressions are fixed.** Commit `4c174b5` fixed both the package-defaults 500 and the payroll-status stall flagged on the last two audits — confirmed tonight with fresh, full unit (573/573) and integration (176/176) runs, not just the two specific regression tests. What's left is a browser/E2E proof of the exact fixed flow (package defaults + payroll readiness screen), since the only browser QA on file predates the fix by six weeks and doesn't cover it.
4. **Portal-Splose-Outlook Integration's brand-new Settings UI has zero browser proof.** Tonight added self-service practitioner linking and practice-wide API-key management under Settings → Integrations → Splose — well guarded and tested at the API level (24+138+184 unit, 3+55 integration, all green), but nothing has opened that screen in a real browser. This is credential-management UI or its adjacent controls, used by owners/admins, not a cosmetic screen.
5. **Opa Mobile Companion's Case Noting SQL has never touched a real database.** The one existing test suite (41/41 passing) mocks `database.js` entirely, so the Splose-client-linking logic in voice-note drafts — the part of "Case Noting" most likely to have a real bug — has never run against real Postgres. Corrected tonight from last night's "broken" (the guard was actually fine, self-scoped by design) to the more accurate `built-untested`.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Portal Onboarding Workflow | idea | tab-unproven | both known regressions fixed and reproducibly re-verified; no fresh browser proof of the fixed flow | 573 unit ✓, 176 integration ✓ |
| Xero Integration Works | idea | tab-unproven | new Finance tab is a better match for both tracker tasks than Accounting; well tested, zero browser proof of either tab | 70 unit ✓, 39 integration ✓ |
| Portal - Splose - Outlook \| Integration Works | idea | tab-unproven | new Settings→Splose UI (practitioner link, API key) untested in a browser; core sync engine strong and green | 346 unit ✓, 58 integration ✓ |
| Automated Reminders | idea | untouched | "Therapist Snapshot" is real and tested but answers a different question than the tracker's stated goal (client-facing reminders); zero code exists for the actual idea | 0 unit, 6 integration ✓ (Snapshot only) |
| Opa Mobile Companion | idea | built-untested | guard corrected to self-scoped-by-design (not broken); Case Noting's SQL has zero integration proof | 41 unit ✓, 0 integration |
| Inductions | idea | needs-refinement | heaviest churn of the night (16 commits); 2 of 3 tracker tasks built and heavily tested, all 3 tasks still `todo` in the tracker | 366 unit ✓, 163 integration ✓, 1 stale E2E assertion found |
| Report Templates | idea | tab-unproven | 3 of 15 FCA layout commits have zero test coverage of the visual result; everything else thoroughly tested | 563 unit ✓, 120 integration ✓ |
| Interactive Assessments | idea | tab-unproven | core untouched tonight; now also feeds Report Templates' new appendix feature; no browser proof of the assessment page | 481 unit ✓, 81 integration ✓ |
| Clinical resources | idea | proven | Resource Hub untouched by tonight's induction-library churn in the same file; browser QA stale (48 days) but still valid | 370 unit ✓ (12 skipped), 133 integration ✓ |
| Professional Development | idea | tab-unproven | found a second real implementation tonight (PD events + CPD tracker) alongside the known profile page; both tested, neither browser-proven | 33 integration ✓ (dedicated PD blocks) |
| Employee Personal Page (My Profile Tab) | idea | tab-unproven | ambiguous target unchanged; backend tested incidentally, no browser proof | pin test only, part of 82/82 guard suite |
| Password Master Document | idea | untouched | not a code feature — a OneDrive document | none |
| Update Opal Docs Register | idea | untouched | not a code feature — a spreadsheet | none |

## 4. Prompts for the morning

**1 — Report Templates: verify three untested FCA layout changes (CRITICAL)**
```
/opal-critical
Three commits changed the FCA Word master's visual layout with no test
coverage of the result: 05b4376 (footer table geometry), c09883c (Opal
logo moved into the running header band), c4f124b (Anti-Bribery-and-
Corruption-Standard physical sizing — fonts, margins, table column
widths). Generate one real FCA report through the wizard (#fca-root,
backend/fca-routes.js) and open it in Word. Confirm: the logo sits
correctly in the header band, the footer table doesn't overrun the
header's 1in text column, and body/heading/table font sizes match the
intended standard. fca-preview-pages.test.js deliberately disables
header rendering in its test harness (jsdom can't read the logo's Blob
URL), so this can only be checked by hand or a real-browser/PDF-render
check right now — consider whether that harness limitation itself is
worth fixing.
Done when: a human or automated visual check confirms all three changes
render correctly, recorded in docs/qa/BROWSER_QA_RESULTS.md or a new
e2e/tests/*.spec.js.
```

**2 — Tracker stage sweep (disagreement, not a code task)**
```
No Claude Code session needed. In the Development Manager, move Portal
Onboarding Workflow, Xero Integration Works, Portal-Splose-Outlook
Integration, Report Templates, Interactive Assessments, Clinical
resources and Professional Development off "idea" — all seven are
built, guarded and passing every targeted test, three audits running.
Clinical resources in particular has had nothing left to fix for three
consecutive nights.
```

**3 — Portal Onboarding Workflow: prove the fixed flow in a browser**
```
/opal-feature
Commit 4c174b5 fixed both regressions flagged on the last two audits
(package-defaults 500, payroll status stall) — confirmed tonight by a
full, fresh unit (573/573) and integration (176/176) run, not just the
two regression tests. Walk through Edit Onboarding's package defaults
view and the Payroll Setup screen (all rows ready → status reaches
"Ready for review") as an admin, using a scratch employee record.
Record it as a new docs/qa/BROWSER_QA_RESULTS.md entry or an
e2e/tests/*.spec.js.
Done when: a fresh browser/E2E proof exists for both screens.
```

**4 — Portal-Splose-Outlook: browser-prove the new Settings UI**
```
/opal-feature
Tonight's commits (494bd86, 41a9e27, 22ce321) added self-service
Splose-practitioner linking and practice-wide API-key management under
Settings → Integrations → Splose (mockup_v3.html around line 6541). It's
guarded and tested at the API level (24+138+184 unit, 3+55 integration,
all green) but nobody has opened this screen in a browser. Walk through:
an owner connecting/disconnecting a practice API key, and a therapist
linking their own Splose practitioner identity.
Done when: a fresh docs/qa/BROWSER_QA_RESULTS.md entry or E2E spec
covers both flows.
```

**5 — Opa Mobile Companion: add a real-database integration test**
```
/opal-critical
backend/mobile-routes.js has 41 passing unit tests, but tests/mobile-
routes.test.js fully mocks database.js — no query in this file has ever
run against real Postgres. The Case Noting task specifically depends on
correctly linking a Splose client to a voice-note draft
(GET /api/mobile/clients, the voice-notes CRUD). Add
backend/tests/integration/mobile.itest.js modelled on
backend/tests/integration/opa.itest.js, covering the Calendar View diary
read and a Case Notes draft linked to a real Splose client against a
real database.
Done when: mobile.itest.js exists and passes against a real database.
```

## 5. Ideas without a start

None. Every one of the 13 folders already existed from a prior audit; tonight rewrote every STATUS.md and, where the label wasn't `proven`, every START.md. Clinical resources is the only feature whose START.md stays a two-line "proven" pointer — unchanged for the third consecutive night, since nothing has moved there.

## 6. What changed since last audit

Since the last audit (2026-09-17T18:21Z UTC, commit `b6a8ad4`), 44 commits touched `backend/` or `frontend/current/` — by far the largest single-night window this audit has covered. Grouped by subsystem:

- **Onboarding** (1 commit, `4c174b5`) → Portal Onboarding Workflow. Fixed both standing regressions.
- **FCA / report templates** (11 commits, `dc18d66`…`07ac56e`) → Report Templates (and, via the new appendices feature, a data link into Interactive Assessments). See "Do this first" #1 for the coverage gap.
- **Splose identity/credentials** (3 commits: `22ce321`, `494bd86`, `41a9e27`) → Portal-Splose-Outlook Integration.
- **Calendar/sync performance** (2 commits: `9092bc7`, `3ca64ca`) → Portal-Splose-Outlook Integration.
- **Finance tab** (1 commit, `427a063`) → Xero Integration Works (new tab, see feature detail).
- **Learning / workshop / induction assistant** (16 commits, `22fddf1`…`ee052e1`, including `ab55bbc`) → Inductions. The heaviest cluster of the night.
- **Therapist Snapshot UI polish** (2 commits: `f0b622e`, `9ae5fbe`) → Automated Reminders (Snapshot task only — cosmetic, no behaviour change).
- **Guard/pin maintenance** (1 commit, `1f1e9ed`) → test-only, re-pins several features' asset versions to what already shipped; verified `node scripts/check-asset-pins.js` reports every pin clean tonight.
- **Dependency maintenance** (1 commit, `61fa50e`) → nodemailer patch bump, within its declared range, unrelated to any feature's behaviour.
- **Theme / day-night mode** (2 commits: `8c264e9`, `0726dde`) → **no tracker feature**. A portal-wide light/dark theme switch (auto by clock, manual override) — genuinely new, cross-cutting UI work with nothing in the Development Manager describing it.
- **Opal Assist** (5 commits: `5e281ab`, `3734669`, `f883a8f`, `9639fa0`, `f4a8297`) → **no tracker feature**. A new practice-wide AI assistant (Word/Excel/Outlook task panes plus a web page) with practice-wide de-identification before any model call, guarded chat, and 30-day tokenised retention. Well tested (42 unit + 8 integration, all green) and, separately, independently verified tonight to sit correctly inside the AI gateway boundary (see below) — but it's a substantial new feature with no tracker card at all.

**AI gateway note (verified directly, not delegated):** commit `ab55bbc` adds a deliberately narrow, owner-approved exception letting the induction assistant use a direct vendor API under a documented data-residency waiver, instead of the usual Bedrock path. It is implemented entirely inside `backend/ai/`, is refused to any policy that can touch clinical data, and all 267 tests in `tests/ai-*.test.js` — including the gateway-boundary guards — pass. Not a violation of the AI boundary rule; a correctly gated, documented exception.

**No subsystem changed without a matching tracker feature, except Theme/day-night mode and Opal Assist, both new tonight.**

## 7. Technical detail

**Setup**
- PostgreSQL was down at session start (`service postgresql status` → `down`); started with `service postgresql start`, confirmed online. `backend/node_modules` was already installed; `npm ci`/`npm install` were not run.
- Tracker fetch succeeded on the first attempt: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json` → 13 features, 19 tasks.
- Last-audit baseline read from `origin/claude/nightly-audit:docs/qa/nightly/2026-09-17.md` and its `features/` folder (this branch is force-pushed fresh from `develop` every run, so `docs/qa/nightly/` on `develop` never accumulates dated briefs). Change window computed as `git log b6a8ad4..HEAD -- backend frontend/current` (44 commits), matching the prior brief's documented cutoff commit.

**Work split:** this audit's own onboarding verification and the AI-gateway/Opal-Assist check were run directly; the remaining ten features were split across four parallel investigation passes (Xero/Reminders/Profile; Splose/Mobile; Inductions/Professional-Development; Report-Templates/Assessments/Clinical-Resources), each independently locating code, checking guards, and running targeted tests, then cross-checked and, in two cases, adjusted for consistency before this brief was written (see below).

**Consistency adjustments made after the four passes reported back:** two features were independently classified `proven` on the reasoning that their older, stale-but-still-somewhat-relevant browser QA was "good enough," while this audit judged a brand-new, entirely unproven UI surface within the same feature should hold the label back. Portal-Splose-Outlook Integration was moved from `proven` to `tab-unproven` (new Settings→Splose UI has zero browser proof, same standard as Onboarding). This mirrors the standard already applied directly to Portal Onboarding Workflow. No test result was changed — only the top-line label and its stated rationale.

**Commands run** — all from `backend/`, all targeted, no complete suite (today is Friday, not the Sunday-UTC deep-run day): full breakdown of files and counts is in each feature's own STATUS.md. Grand total across all 13 features tonight: unit ≈ 3,644 tests passed (12 intentionally skipped), 0 failed; integration ≈ 900+ tests passed once run against uncontended databases, 0 failed.

**Infrastructure finding — concurrent audit passes sharing one test database:** the four parallel investigation passes all initially followed this prompt's literal example (`DB_NAME=therapy_scheduler_audit`) and, running concurrently, repeatedly truncated/reseeded each other's data mid-run — symptoms included non-reproducible failure counts on identical re-runs, foreign-key violations, and spurious 401s/500s. Every pass caught this via `pg_stat_activity`/`ps aux` showing concurrent connections, re-ran against a session-private `DB_NAME`, and got a clean result each time; no failure from the contended runs was written up as a real defect. **This prompt's own example command should probably stop naming a single shared `DB_NAME` for a multi-pass audit** — recommend each pass mint its own name (as `.claude/rules/tests.md`'s existing concurrent-sessions guidance already prescribes) rather than relying on passes to notice contention themselves.

**New test-debt finding:** `e2e/tests/tutorials.spec.js:59` asserts a heading ("All learning") that no longer exists after tonight's course-builder redesign replaced it with Inductions/Assignments/Staff-progress tabs — this spec would fail that one assertion if actually run, though the rest of its selectors still match. Not fixed (report-only); worth a one-line update next time someone touches that spec.

**Could not locate**
- "Induction Playground" (Inductions task) — re-checked against all 16 of tonight's learning/workshop commits; still no match anywhere.
- "Assessment Review" (Interactive Assessments task) — still no literal match.
- "Client Agreement Form" (Report Templates task) — the codebase still calls this "Service Agreement."
- "Automated Client Appt Reminders" (Automated Reminders' own stated idea) — still nothing in the codebase sends a client-facing appointment reminder; checked all 44 of tonight's commits.
- A single, unambiguous target for "Employee Personal Page (My Profile Tab)" — still two real candidate surfaces.

**Open questions for the team**
- Whether the induction assistant's direct-vendor-API exception (`ab55bbc`) should get an entry in whatever document tracks approved AI-governance exceptions, beyond the code's own self-check — it's correctly implemented, this is a documentation/traceability question, not a code defect.
- Whether Theme/day-night mode and Opal Assist should get tracker cards of their own, given their size.
- Repeated from prior audits: whether `requireAuth`-only (self-scoped, no `requirePermission` tier) is meant to stay the accepted pattern for personal-data routes (`snapshot-routes.js`, `mobile-routes.js`) — this audit continues to treat it as an accepted exception per the rubric, but it has never been confirmed as a deliberate team decision rather than an audit-invented allowance.

**Tracker write-back**: `post-tracker.mjs` reported `13 features posted, 0 already posted tonight, brief posted` on the first attempt — every feature's `claude_update`/`next_action`/activity row and the workspace brief summary went in cleanly.
