# Opal nightly tracker audit — 2026-11-13

## 1. Status line

**RAN** — 2026-11-13T18:14Z UTC onward, commit `40669e7` on `develop`.

Counts: **proven 5** · **tab-unproven 4** · **built-untested 1** ·
**needs-refinement 1** · **untouched 2** · **broken 0** (13 features total).

Zero commits landed on `develop` since the 2026-11-12 audit — `develop` is
still at `40669e7`, the same commit audited for the last five nights
running. Every feature was independently re-verified anyway, not copied
from last night's numbers: every targeted unit and integration test file
was actually re-run tonight, and every guard was re-confirmed by direct
grep of the handler bodies. All results matched the prior night's exactly.
The only new observation tonight was a single transient test flake under
parallel-worker load (not a regression — see "Technical detail").

(Note on this branch's own history, carried forward from prior nights:
the last audit date is found from `claude/nightly-audit`'s
`docs/qa/nightly/` — newest was `2026-11-12.md` — not from `develop`,
which carries no dated briefs at all.)

## 2. Do this first

1. **Travel block booking type still has no browser/E2E proof.**
   Unchanged for five nights: the booking-rules/travel-block layer passes
   fresh unit/jsdom runs tonight, but nothing proves a real user can pick
   "Travel block" in Smart Booking and see it land correctly on the
   calendar in an actual browser.
2. **Portal Onboarding Workflow — Stage 2's SharePoint storage is
   confirmed missing again tonight.** A fresh, direct search of `backend/`
   for `sharepoint`/`graph.microsoft`/`drives/` again found no real
   SharePoint document-storage API — Graph usage elsewhere is M365
   identity/mail only. The overall card stays `proven` (Stage 1's Letter
   of Offer is solid), but Stage 2's SharePoint piece is a real, standing
   gap.
3. **"Professional Development" is still genuinely ambiguous.**
   Unchanged — two unrelated, real, built subsystems could be meant (the
   admin PD-events catalogue, or the employee's own CPD section of My
   Profile); worth a two-minute clarification in the tracker. Under
   either reading, no browser proof exists that the page renders.
4. **Interactive Assessments — the tracker's own notes are still out of
   date.** Unchanged: the tracker says only WHODAS 2.0 is configured;
   this audit again directly confirmed FCA and the Progress Report/
   Support Letter templates are equally built and tested (1107 unit tests
   across all three, re-run tonight). Worth telling Ann before the
   "Assessment Review" keep/remove triage accidentally treats a finished
   thing as pending.
5. **Employee Personal Page (My Profile Tab) — still zero automated
   backend tests for `profile-routes.js` itself.** Unchanged: the only
   test touching it is a narrow, unrelated work-schedule check. Also
   unchanged: the tracker's "work locations for the next 24 hours"
   doesn't match the live UI's "next week" banner (`mockup_v3.html:4325`)
   — worth a decision on which is correct.

No `broken` findings tonight — every located route is guarded and every
targeted test that was run passed (three known, non-code test artifacts
are explained in Technical detail — one is new tonight, a transient flake,
not a defect).

## 3. Every feature

| Feature | Tracker stage | Evidence | Reason | Tests run |
|---|---|---|---|---|
| Portal - Splose - Outlook \| Integration Works | idea | proven | Guarded; e2e + browser QA confirm the tab's existing boundaries; the Travel block type itself is only unit-proven | 37 unit (part of 684✓) + 15 integration (133✓) |
| Portal Onboarding Workflow | idea | proven | Permission-gated, browser QA proves the chain; Stage 1 (LOO) fully built; Stage 2 SharePoint storage confirmed missing again | 25 unit (604✓/1 env-gap) + 10 integration (218✓) |
| Clinical resources | idea | proven | Resource Hub — built, guarded, tested, e2e-covered | 12 unit (398✓) + 10 integration (233✓/1 intentional) |
| Inductions | idea | proven | Guarded, e2e proves the full learner flow; AI co-author built & governed; no visual authoring-builder UI found | 7 unit (271✓) + integration (part of 234✓) + e2e |
| Professional Development | idea | tab-unproven | Card ambiguous between two real, built subsystems; no browser proof under either reading | 3 unit (part of 810✓) + integration (part of 239✓) |
| Automated Reminders | idea | needs-refinement | Client-reminder idea entirely unbuilt; bundled "Therapist Snapshot" task is a separate, already-built feature | integration (snapshot.itest.js, part of 47✓) |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Guarded, renders per browser QA; no dedicated `profile-routes` test exists; tracker/UI wording mismatch stands | 3 unit (part of 810✓) + integration (part of 239✓/1 env-artifact) |
| Interactive Assessments | idea | tab-unproven | Guarded, heavily tested (best coverage in this audit); tracker's WHODAS-only note confirmed out of date; no browser proof | 21 unit (1107✓, 1 transient flake not reproduced) + 4 integration (part of 239✓) |
| Opa Mobile Companion | idea | proven | Self-scoped guards re-verified by direct grep; AI properly walled off; app itself isn't in this repo so no in-repo tab to e2e-test | 4 unit (part of 684✓) + 3 integration (part of 47✓) |
| Password Master Document | idea | untouched | External OneDrive document; nothing to locate | none applicable |
| Report Templates | idea | tab-unproven | All 3 sub-tasks built & tested; no browser proof; CLAUDE.md's repo-map entry for this area confirmed stale again | unit/integration shared with Interactive Assessments |
| Update Opal Docs Register | idea | untouched | External Excel/SharePoint document task; nothing to locate | none applicable |
| Xero Integration Works | idea | tab-unproven | Built & tested against mocks; no real-Xero sandbox or browser verification ever done | 6 unit (77✓) + 3 integration (part of 47✓) + 1 (part of 218✓) |

## 4. Prompts for the morning

**1 — Portal – Splose – Outlook (Travel block e2e)**
```
/opal-feature
Add an e2e/tests/portal.spec.js scenario (or a docs/qa/BROWSER_QA_RESULTS.md
entry) that books a Travel block via Smart Booking, confirms the Google
Maps route renders, and checks the resulting calendar tile. Follow the
UI-selector patterns already used in backend/tests/travel-block-frontend.test.js.
Files: backend/travel-routes.js, backend/calendar-routes.js,
frontend/current/mockup_v3.html (CALENDAR TAB, TRAVEL & FLIGHTS TAB).
Done when: the new spec or QA entry proves a Travel block can be booked
end to end in a real browser.
```

**2 — Portal Onboarding Workflow (Stage 2 SharePoint storage)**
```
/opal-feature
backend/onboarding-package-docs-routes.js and backend/onboarding-lifecycle.js
currently store finished onboarding documents in Postgres/local storage
only — direct search confirms there is still no SharePoint upload anywhere
in backend/. Add SharePoint storage for onboarding documents, reusing the
existing Microsoft Graph auth pattern in backend/graph-identity.js and
backend/graph-mail.js rather than building new auth. Start with a single
document type (DOC_CONTRACT_TEMPLATE) end to end. Done when: a new
integration test (pattern: backend/tests/integration/onboarding-pack.itest.js)
proves a document lands in SharePoint alongside its portal-side row.
```

**3 — Professional Development (clarify scope, then prove the tab)**
```
/opal-fast-change
This card is ambiguous between two real subsystems: the Resource Hub's
"Professional development" catalogue (frontend/current/resourcehub.js) and
the Profile tab's CPD section (backend/profile-routes.js, likely the same
thing "Employee Personal Page" already covers). First, in the Development
Manager, clarify which this card means, or merge it with "Employee
Personal Page" if it's the CPD reading. Then add a Playwright spec or
docs/qa/BROWSER_QA_RESULTS.md entry proving the relevant page renders —
copy the login/navigation pattern from e2e/tests/portal.spec.js's Resource
Hub test. Done when: the tracker scope is clarified AND a browser check
passes.
```

**4 — Interactive Assessments (browser proof + tell Ann)**
```
/opal-feature
backend/fca-routes.js, letter-routes.js and whodas-routes.js are all built
and heavily tested (1107 unit tests), contradicting the tracker's note that
"only WHODAS 2.0 is configured" — FCA and the Progress Report/Support
Letter templates are equally built. Add a Playwright spec that opens a
client's Assessment Review overlay, completes an instrument (start with
WHODAS), and asserts it saves. Record it in docs/qa/BROWSER_QA_RESULTS.md.
Also flag to Ann directly that the "Assessment Review" keep/remove task
should treat FCA and the letter templates as done, not pending. Done when:
the spec passes and is recorded.
```

**5 — Employee Personal Page (test coverage + wording check)**
```
/opal-critical
Add backend/tests/profile-routes.test.js (supertest against the mounted
router, the pattern in case-note-routes.test.js) covering the leave/CPD/
credential guard boundaries on backend/profile-routes.js — only a narrow,
unrelated work-schedule test exists today (backend/tests/smart-route-backend.test.js).
Cover a therapist managing only their own data (403 on someone else's) and
an owner approving/rejecting correctly. Separately, flag to the team: the
tracker says "set your work locations for the next 24 hours" but
frontend/current/mockup_v3.html:4325's actual banner reads "next week" —
confirm which is correct before changing either. Done when: the new test
file exists and passes, covering the guard boundaries (a browser/E2E
check is still needed beyond that for full "proven").
```

## 5. Ideas without a start

None tonight. Every feature folder under `docs/qa/nightly/features/`
already existed from prior nights; `STATUS.md` was rewritten for every
feature (fresh test runs, fresh guard checks, fresh grep re-checks of
every standing finding). No `START.md` was rewritten tonight — no
evidence label changed and no genuinely new finding about any feature's
own evidence emerged (the one new observation, a transient test flake
under worker contention, is a test-infrastructure note, not a finding
about the feature itself — see Technical detail).

## 6. What changed since last audit

**Zero commits** on `develop` since the 2026-11-12 audit. `develop` is
unchanged at `40669e7`. No subsystem moved tonight — this is the fifth
consecutive night at this same commit.

**Still true, and still worth a decision:** this repository's actively-developed
"Opal Assist" subsystem (`backend/assist-routes.js`, `backend/assist/*`,
its own migrations `084`-`086`, `block-review`, `booking-rules`, a
dedicated PWA) still has no tracker card describing it at all, despite
being one of the largest areas of recent development. It is correctly
routed through `ai-gateway.js` (re-confirmed tonight via
`backend/assist/assist-provider.js`). Recommend the team add a tracker
card for it.

## 7. Technical detail

**Setup**: `backend/node_modules` present (`ls backend/node_modules/.bin/jest`
succeeded). PostgreSQL was down at the start of this run
(`service postgresql status` → `16/main (port 5432): down`) and was
started per the agent prompt's instructions
(`service postgresql start` → `16/main (port 5432): online`). Tracker
snapshot fetched successfully:
`NODE_USE_ENV_PROXY=1 SUPABASE_URL=... node ../scripts/nightly-audit/fetch-tracker.mjs
/tmp/tracker.json` → "13 features, 19 tasks". Last audit date found from
the `claude/nightly-audit` branch's `docs/qa/nightly/` (newest:
`2026-11-12.md`, commit `40669e7`); change window = empty (zero commits),
confirmed with `git log --since="2026-11-12" --oneline -- backend frontend/current`.

Branch mechanics: `claude/nightly-audit` was rebuilt from the current
`develop`-based working branch (bringing its code tree up to date with
`40669e7`, correcting a one-commit lag that had crept into the prior
night's branch state), then the prior branch's `docs/qa/nightly/` history
was merged in with `-s ours` (recording the merge without touching any
code file) before this night's docs were written on top — the same
pattern visible in this branch's own git history ("merge: incorporate
prior claude/nightly-audit history").

**Commands run tonight** (all targeted — no complete suite; today,
2026-11-13, is a Friday UTC, not Sunday, so the weekly deep run does not
apply):
- 4 grouped `npx jest <files>` unit runs covering every located unit test
  file across all 13 features: 23 suites/810 tests (798✓/12 skipped), 21
  suites/1107 tests (1107✓, with one transient re-run flake — see below),
  37 suites/684 tests (684✓), 25 suites/605 tests (604✓/1 known
  env-gap).
- 5 grouped `npx jest --config jest.integration.config.js <files>
  --runInBand` integration runs (`DB_NAME=therapy_scheduler_audit
  DB_PASSWORD=audit`): 10 suites/234 tests (233✓/1 intentional
  failure-path test), 9 suites/239 tests (238✓/1 known sandbox artifact),
  10 suites/218 tests (218✓), 15 suites/133 tests (133✓), 7 suites/47
  tests (47✓).
- `node --check` on every located route file touched by tonight's guard
  review — clean on all.
- `node ../scripts/nightly-audit/fetch-tracker.mjs` and
  `node ../scripts/nightly-audit/post-tracker.mjs` — see Write-back below.

**Known, non-code test artifacts (not defects), re-confirmed tonight:**
1. `backend/tests/onboarding-document-reader.test.js` — one test fails
   because the optional OCR language-data package `@tesseract.js-data/eng`
   (listed in `package.json`) is missing from this sandbox's
   `node_modules`. This audit did not run `npm ci`/`npm install` (out of
   scope for an unattended session). Not a code regression.
2. `backend/tests/integration/readonly-and-hardening.itest.js` — the
   "D-6/D-7: storage failure behaviour" test expects a `chmod 0o000`'d
   directory to cause a write failure (expects status ≥500, got 201).
   Re-confirmed tonight: this sandbox runs as `root` (`whoami` → `root`),
   so Linux's DAC permission checks are bypassed and the chmod-based
   failure injection cannot work here. Sandbox limitation, outside this
   audit's control.
3. **New tonight**: `backend/tests/fca-wizard-behaviour.test.js` failed a
   single `toBeCloseTo` scroll-offset assertion (1106/1107) on one run of
   the full 21-file Interactive Assessments/Report Templates unit group
   under parallel jest workers. Running that file alone (58/58 pass), and
   re-running the full 21-file group twice more (1107/1107 both times),
   did not reproduce it. This reads as a timing-sensitive flake under
   worker contention, not a code regression — logged for transparency,
   not scored as `broken`, and not treated as a "genuinely new finding"
   warranting a `START.md` rewrite.

**Re-confirmed standing findings (unchanged from 2026-11-12, independently
re-checked tonight rather than assumed):**
- Onboarding Stage 2's SharePoint document storage: still missing, by a
  fresh direct search of `backend/`.
- Interactive Assessments: FCA and the Progress Report/Support Letter
  templates still confirmed as built and tested as WHODAS.
- Employee Personal Page: the tracker's "next 24 hours" vs. the live UI's
  "next week" (`mockup_v3.html:4325`) mismatch still stands.
- CLAUDE.md §2's repository map still lists `backend/service-agreement-routes.js`
  as the home of service agreements; that file still does not exist.
- No standalone `ASSESSMENT TAB` banner still exists in `mockup_v3.html`.
- No tracker card for "Opal Assist" still exists (see §6).

**Could not locate / open questions** (unchanged):
- Should "Therapist Snapshot" be split out of the "Automated Reminders"
  card into its own tracker entry?
- Which subsystem does "Professional Development" actually mean?
- Should "Opal Assist" get its own tracker card?
- Tracker vs UI wording for Employee Personal Page — which is right?

**Weekly deep run**: not applicable — tonight (2026-11-13) is a Friday
UTC, not Sunday.

**Write-back**: `NODE_USE_ENV_PROXY=1 SUPABASE_URL=... node
../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json` was run
once from `backend/`, covering all 13 features and the workspace-level
brief summary. Output: `post-tracker: 13 features posted, 0 already
posted tonight, brief posted`. Run before the `git push` below, per the
rule.
