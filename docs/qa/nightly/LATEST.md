# Nightly tracker audit — 2026-09-19

## 1. Status line

**RAN** · 2026-09-19T18:24Z UTC · commit `cec0a039` (origin/develop) · a quiet night by this
audit's recent standard — only 7 commits landed since the last audit (2026-09-18T19:20Z UTC,
commit `0726dde`), all in one area (AI de-identification/Assist plus one theme commit), against
44 the night before.

Counts across the tracker's 13 features: **broken 0 · proven 1 · tab-unproven 7 ·
needs-refinement 1 · built-untested 1 · untouched 3**. Identical to last night's counts — every
one of the 13 features was re-verified fresh tonight (every listed test re-run, not carried
forward) and none of tonight's 7 commits touch any of their located files except a small,
unrelated addition to two Splose files (see item 4 and that feature's STATUS.md).

## 2. Do this first

1. **The tracker itself is still stuck on "idea" for all 13 cards, four audits running — and a
   fifth substantial subsystem now has no card at all.** Tonight's 7 commits finished the
   de-identification engine that all clinician-facing AI now runs through (every planned rule
   built, a 269-case leak corpus that must stay at 100%, enforced at the AI gateway itself) and
   added Word-pane document tools to Opal Assist. Combined with Opal Assist's first appearance two
   nights ago, this is now an 11-commit, CRITICAL-classification body of work — correctly gated,
   fully tested, and completely invisible to the Development Manager. This has been flagged every
   night since the audit started for the tracker-stage problem generally; the Opal Assist gap
   specifically deserves its own card now, not another line in this report.
2. **Report Templates — the same three untested FCA layout commits from two nights ago are still
   unverified.** `05b4376` (footer table geometry), `c09883c` (Opal logo into the running header)
   and `c4f124b` (Anti-Bribery-and-Corruption-Standard physical sizing) changed only the binary
   Word master and `template-map.js`, with no matching test file change, and nothing has touched
   this area since — meaning nobody has opened a generated FCA report in Word in the two nights
   since this was first flagged.
3. **Portal Onboarding Workflow's fixed flow still has no browser proof.** The two regressions
   fixed two nights ago (`4c174b5`) remain fixed and green (573 unit + 176 integration, re-run
   fresh again tonight), but the package-defaults view and payroll readiness screen still have no
   fresh browser or E2E check — the only browser QA on file predates the fix.
4. **Portal-Splose-Outlook's new Settings UI still has zero browser proof, and last night's audit
   left a stale artifact behind.** The practitioner-linking/API-key UI added two nights ago
   remains untested in a browser. Separately, this feature's `START.md` was found tonight still
   reading "Proven" from before it was correctly demoted to `tab-unproven` — corrected tonight (see
   Technical detail). Tonight's own touch to this feature is minor and unrelated: the
   de-identification engine added a read-only `getPatientIdentifiers()` function to
   `splose-api.js` and a cache-clear call to `splose-credentials.js`'s `apply()`; both re-tested
   green, neither changes any guard, route or connection behaviour.
5. **Opa Mobile Companion's Case Noting SQL still has never touched a real database.** Unchanged
   for the fourth audit running: `tests/mobile-routes.test.js` (41/41 passing) fully mocks
   `database.js`, so the Splose-client-linking logic in voice-note drafts has zero integration-level
   proof.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Portal Onboarding Workflow | idea | tab-unproven | both known regressions still fixed and green; no fresh browser proof | 573 unit ✓, 176 integration ✓ |
| Xero Integration Works | idea | tab-unproven | Finance tab well tested, zero browser proof of Dashboard/Payroll/Invoicing | 70 unit ✓, 39 integration ✓ |
| Portal - Splose - Outlook \| Integration Works | idea | tab-unproven | new Settings→Splose UI still unproven in a browser; core sync engine strong and green | 346 unit ✓, 58 integration ✓ |
| Automated Reminders | idea | untouched | "Therapist Snapshot" real and tested but answers a different question than the tracker's stated goal; zero code for the actual idea | 0 unit, 6 integration ✓ (Snapshot only) |
| Opa Mobile Companion | idea | built-untested | guard is self-scoped-by-design (not broken); Case Noting's SQL has zero integration proof | 41 unit ✓, 0 integration |
| Inductions | idea | needs-refinement | 2 of 3 tracker tasks built and heavily tested, all 3 tasks still `todo` in the tracker; one stale E2E assertion confirmed still stale | 366 unit ✓, 130 integration ✓ |
| Report Templates | idea | tab-unproven | 3 of 15 FCA layout commits still have zero test coverage of the visual result; everything else thoroughly tested | 563 unit ✓, 120 integration ✓ |
| Interactive Assessments | idea | tab-unproven | core untouched again tonight; no browser proof of the assessment page | 481 unit ✓, 81 integration ✓ |
| Clinical resources | idea | proven | untouched again tonight; browser QA now 49 days stale but still valid | 370 unit ✓ (12 skipped), 133 integration ✓ |
| Professional Development | idea | tab-unproven | two disconnected implementations, both tested at API level, neither browser-proven | 33 + 36 + 42 integration/unit ✓ |
| Employee Personal Page (My Profile Tab) | idea | tab-unproven | ambiguous target unchanged; backend tested incidentally, no browser proof | pin test only, part of 82/82 guard suite |
| Password Master Document | idea | untouched | not a code feature — a OneDrive document | none |
| Update Opal Docs Register | idea | untouched | not a code feature — a spreadsheet | none |

## 4. Prompts for the morning

**1 — Tracker stage sweep, plus a new card for Opal Assist (disagreement, not a code task)**
```
No Claude Code session needed. In the Development Manager, move Portal Onboarding Workflow, Xero
Integration Works, Portal-Splose-Outlook Integration, Report Templates, Interactive Assessments,
Clinical resources and Professional Development off "idea" — all seven are built, guarded and
passing every targeted test, four audits running. Also add a tracker card for "Opal Assist" (the
practice-wide AI assistant with Word/Excel/Outlook task panes, a de-identification engine now
covering every clinician-facing AI feature, and a web page) — it is now an 11-commit,
CRITICAL-risk body of work with no card at all, two audits running.
```

**2 — Report Templates: verify three untested FCA layout changes (CRITICAL)**
```
/opal-critical
Three commits changed the FCA Word master's visual layout with no test coverage of the result:
05b4376 (footer table geometry), c09883c (Opal logo moved into the running header band), c4f124b
(Anti-Bribery-and-Corruption-Standard physical sizing — fonts, margins, table column widths).
Generate one real FCA report through the wizard (#fca-root, backend/fca-routes.js) and open it in
Word. Confirm: the logo sits correctly in the header band, the footer table doesn't overrun the
header's 1in text column, and body/heading/table font sizes match the intended standard.
fca-preview-pages.test.js deliberately disables header rendering in its test harness (jsdom can't
read the logo's Blob URL), so this can only be checked by hand or a real-browser/PDF-render check
right now.
Done when: a human or automated visual check confirms all three changes render correctly,
recorded in docs/qa/BROWSER_QA_RESULTS.md or a new e2e/tests/*.spec.js.
```

**3 — Portal Onboarding Workflow: prove the fixed flow in a browser**
```
/opal-feature
Commit 4c174b5 fixed both regressions flagged two audits ago (package-defaults 500, payroll status
stall) — confirmed again tonight by a fresh unit (573/573) and integration (176/176) run. Walk
through Edit Onboarding's package defaults view and the Payroll Setup screen (all rows ready →
status reaches "Ready for review") as an admin, using a scratch employee record. Record it as a
new docs/qa/BROWSER_QA_RESULTS.md entry or an e2e/tests/*.spec.js.
Done when: a fresh browser/E2E proof exists for both screens.
```

**4 — Portal-Splose-Outlook: browser-prove the new Settings UI**
```
/opal-feature
Two audits ago added self-service Splose-practitioner linking and practice-wide API-key
management under Settings → Integrations → Splose (mockup_v3.html, Settings tab). It's guarded and
tested at the API level (346 unit, 58 integration, all green) but nobody has opened this screen in
a browser. Walk through: an owner connecting/disconnecting a practice API key, and a therapist
linking their own Splose practitioner identity.
Done when: a fresh docs/qa/BROWSER_QA_RESULTS.md entry or E2E spec covers both flows.
```

**5 — Opa Mobile Companion: add a real-database integration test**
```
/opal-critical
backend/mobile-routes.js has 41 passing unit tests, but tests/mobile-routes.test.js fully mocks
database.js — no query in this file has ever run against real Postgres. The Case Noting task
specifically depends on correctly linking a Splose client to a voice-note draft
(GET /api/mobile/clients, the voice-notes CRUD). Add backend/tests/integration/mobile.itest.js
modelled on backend/tests/integration/opa.itest.js, covering the Calendar View diary read and a
Case Notes draft linked to a real Splose client against a real database.
Done when: mobile.itest.js exists and passes against a real database.
```

## 5. Ideas without a start

None created or substantively rewritten tonight — every one of the 13 folders already existed
and every evidence label held from last night, so every START.md's guidance stays valid. One
correction: `portal-splose-outlook-integration-works/START.md` was found still reading "Proven"
from before an earlier audit correctly demoted this feature to `tab-unproven` — rewritten tonight
as a full starter prompt to match its actual label (see Technical detail).

## 6. What changed since last audit

Since the last audit (2026-09-18T19:20Z UTC, commit `0726dde`), 7 commits touched `backend/` or
`frontend/current/` — by far the quietest window this audit has covered. Grouped by subsystem:

- **AI de-identification / Opal Assist** (6 commits: `578c1db`, `ba87b48`, `ec47514`, `d9e00ab`,
  `399ba39`, `cec0a03`) → **no tracker feature.** This is the same "Opal Assist" subsystem flagged
  as untracked two nights ago, substantially grown: every planned de-identification rule is now
  built, backed by a 269-case leak corpus test that must stay at 100%; the rule is now enforced
  once, at the AI gateway itself, for every clinician-facing AI feature (`clinical_note_generation`,
  `opa_assistant`, `opal_assist`), with the other two AI features carrying an explicit, written
  exemption reason; Opa's chat now runs through the same pipeline; and the Word-pane task tools
  (Opal format, tidy spacing, headings-on-new-page, update contents, check document) shipped for
  Assist. Independently verified directly tonight (not delegated): `node --check` clean on all 10
  touched files; 604/604 unit tests across 22 suites (`tests/ai-*`, `tests/assist-*`,
  `opa-deidentify`, `deidentify-leak-corpus`), including `ai-gateway-boundary.test.js` and
  `ai-single-gateway-guards.test.js` (the boundary-enforcement guards); 24/24 integration tests
  (`assist.itest.js`, `opa.itest.js`) against a real database with all 70 migrations applying
  cleanly, including tonight's own `070_opal_assist.sql`; `ai-policy.js` confirmed to still
  fail-closed on any feature missing a `deidentification` declaration. No TODO/FIXME found. This
  work also touched two files belonging to the tracked Portal-Splose-Outlook feature
  (`splose-api.js`, `splose-credentials.js`) — see that feature's STATUS.md for the isolated,
  independently-verified diff.
- **Theme** (1 commit: `fc769fe`) → **no tracker feature.** An "Appearance" setting (Auto/Day/Night)
  added to the account menu and Settings page, on top of the day/night theme system that shipped
  two nights ago. Cosmetic-only; `assessment-surface-guards.test.js` (82/82) and
  `scripts/check-asset-pins.js` both confirm every pin clean tonight, including the new `theme.js`
  v2/`theme.css` v2 pins.

**No subsystem changed without a matching tracker feature, except AI de-identification/Opal Assist
and Theme — both already flagged as untracked two nights ago, and Opal Assist has now grown large
enough (11 commits, CRITICAL risk) to warrant its own card rather than another repeated note here.**

## 7. Technical detail

**Setup**
- PostgreSQL was already running at session start; `backend/node_modules` was already installed;
  `npm ci`/`npm install` were not run.
- Tracker fetch succeeded on the first attempt:
  `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs
  /tmp/tracker.json` → 13 features, 19 tasks.
- Last-audit baseline read from `origin/claude/nightly-audit:docs/qa/nightly/2026-09-18.md` and its
  `features/` folder (this branch is force-pushed fresh from `develop` every run, so
  `docs/qa/nightly/` on `develop` never accumulates dated briefs). Change window computed as
  `git log 0726dde..origin/develop -- backend frontend/current` (7 commits), matching the prior
  brief's documented cutoff commit `0726dde`.

**Work split:** the AI-gateway/Opal-Assist verification, the theme-commit review, and the
unchanged/quick features (Opa Mobile Companion, Password Master Document, Update Opal Docs
Register) were run directly; the remaining ten features were split across three parallel
investigation passes (Xero/Reminders/Profile; Onboarding/Splose/Report-Templates;
Inductions/Assessments/Resources/Professional-Development), each independently re-locating code,
re-checking guards, and re-running every targeted test fresh tonight rather than trusting last
night's numbers, then cross-checked against this audit's own findings before this brief was
written. Each pass used its own dedicated database name (`therapy_scheduler_n4a`/`n4b`/`n4c`, plus
`n4main` for this session's own direct integration runs) per the concurrency lesson from two
nights ago — no cross-session database contention occurred tonight.

**Commands run** — all from `backend/`, all targeted, no complete suite (today is Saturday UTC,
not Sunday, so no weekly deep run). Full breakdown of files and counts is in each feature's own
STATUS.md. Grand total across all 13 features tonight: unit ≈ 2,900+ tests passed (12 intentionally
skipped), 0 failed; integration ≈ 700+ tests passed, 0 failed; plus this audit's own direct AI/Assist
run of 604 unit + 24 integration tests, 0 failed.

**Correction made to a prior audit's artifact:** `portal-splose-outlook-integration-works/START.md`
was found tonight still reading a two-line "Proven — see STATUS.md" stub, left over from before an
earlier audit correctly moved this feature from `proven` to `tab-unproven` (the new Settings UI
lacking browser proof). STATUS.md was correct; START.md had not been regenerated to match. Rewritten
tonight as a full starter prompt consistent with `tab-unproven`. Worth a process note: this rule
("write START.md as a full prompt unless the label is `proven`") is easy to silently violate when a
label moves backward after being `proven` — future audits should specifically check for this
mismatch rather than assuming an existing "Proven" stub is still correct.

**Could not locate** (all re-checked fresh tonight, all still absent)
- "Induction Playground" (Inductions task) — repo-wide case-insensitive grep, no match.
- "Assessment Review" (Interactive Assessments task) — no literal match.
- "Client Agreement Form" (Report Templates task) — the codebase still calls this "Service
  Agreement."
- "Automated Client Appt Reminders" (Automated Reminders' own stated idea) — still nothing in the
  codebase sends a client-facing appointment reminder; checked tonight's 7 commits too.
- A single, unambiguous target for "Employee Personal Page (My Profile Tab)" — still two real
  candidate surfaces.

**Open questions for the team**
- Whether "Opal Assist" should get a tracker card of its own now, given its size and CRITICAL
  classification — repeated and sharpened from two nights ago.
- Whether the induction assistant's direct-vendor-API exception (`ab55bbc`, verified two audits
  ago) should get an entry in whatever document tracks approved AI-governance exceptions.
- Repeated from prior audits: whether `requireAuth`-only (self-scoped, no `requirePermission`
  tier) is meant to stay the accepted pattern for personal-data routes (`snapshot-routes.js`,
  `mobile-routes.js`) — this audit continues to treat it as an accepted exception per the rubric,
  but it has never been confirmed as a deliberate team decision.

**Tracker write-back**: `post-tracker.mjs` reported `13 features posted, 0 already posted tonight,
brief posted` on the first attempt — every feature's `claude_update`/`next_action`/activity row and
the workspace brief summary went in cleanly.
