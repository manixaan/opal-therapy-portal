# Opal nightly tracker audit — 2026-11-12

## 1. Status line

**RAN** — 2026-11-12T18:41Z UTC onward, commit `40669e7` on `develop`.

Counts: **proven 5** · **tab-unproven 4** · **built-untested 1** ·
**needs-refinement 1** · **untouched 2** · **broken 0** (13 features total).

Zero commits landed on `develop` since the 2026-11-11 audit — `develop` is
still at `40669e7`, the exact commit audited for the last several nights.
There is nothing new to re-verify against, but every feature was
independently re-observed anyway: every targeted unit and integration test
file was actually re-run tonight (not copied from last night's numbers),
and every guard was re-confirmed by direct grep of the handler bodies. All
results matched the prior night's exactly, and this run found a small
number of new, specific findings that prior nights hadn't recorded — see
"Do this first" items 2 and 4, and the Technical detail section.

(Note on this branch's own history: the last audit date was found from
`claude/nightly-audit`'s `docs/qa/nightly/` — newest was `2026-11-11.md` —
not from `develop`, which carries no dated briefs at all. `develop` only
ever receives code commits; this branch is where the nightly docs
accumulate, exactly as `docs/qa/nightly/README.md` describes.)

## 2. Do this first

1. **Travel block booking type still has no browser/E2E proof.**
   Unchanged from prior nights: the booking-rules/travel-block layer
   passes fresh unit/jsdom runs tonight, but nothing proves a real user
   can pick "Travel block" in Smart Booking and see it land correctly on
   the calendar in an actual browser.
2. **Portal Onboarding Workflow — Stage 2's SharePoint storage confirmed
   missing (new finding).** This audit searched `backend/` directly for
   `sharepoint`/`graph.microsoft`/`drives/` usage and found none — Graph
   usage elsewhere is M365 identity/mail only. The overall card stays
   `proven` (Stage 1's Letter of Offer is solid), but Stage 2's SharePoint
   piece is a real, verified gap, not just a stale tracker checkbox.
3. **"Professional Development" is still genuinely ambiguous.** Unchanged
   — two unrelated subsystems could be meant (the admin PD-events
   catalogue, or the employee's own CPD section of My Profile); worth a
   two-minute clarification in the tracker. Under either reading, no
   browser proof exists that the page renders.
4. **Interactive Assessments — the tracker's own notes are now out of
   date (new finding).** The tracker says only WHODAS 2.0 is configured;
   this audit directly confirmed FCA and the new Progress Report/Support
   Letter templates are equally built and tested (1107 unit tests across
   all three). Worth telling Ann before the "Assessment Review" keep/remove
   triage accidentally treats a finished thing as pending.
5. **Employee Personal Page (My Profile Tab) — still zero automated
   backend tests for `profile-routes.js` itself.** Unchanged: the only
   test touching it is a narrow, unrelated work-schedule check. Also new
   this audit: the tracker's "work locations for the next 24 hours"
   doesn't match the live UI's "next week" banner (`mockup_v3.html:4325`)
   — worth a decision on which is correct.

No `broken` findings tonight — every located route is guarded and every
targeted test that was run passed (two unrelated, non-code test artifacts
are explained in Technical detail).

## 3. Every feature

| Feature | Tracker stage | Evidence | Reason | Tests run |
|---|---|---|---|---|
| Portal - Splose - Outlook \| Integration Works | idea | proven | Guarded; e2e + browser QA confirm the tab's existing boundaries; the new Travel block type itself is only unit-proven | 27 unit (444✓) + 15 integration (133✓) |
| Portal Onboarding Workflow | idea | proven | Permission-gated, browser QA proves the chain; Stage 1 (LOO) fully built; Stage 2 SharePoint storage confirmed genuinely missing | 27 unit (653✓/1 env-gap) + 10 integration (218✓) |
| Clinical resources | idea | proven | Resource Hub — built, guarded, tested, e2e-covered | 12 unit (398✓) + 7 integration (part of 234✓) + e2e |
| Inductions | idea | proven | Guarded, e2e proves the full learner flow; AI co-author built & governed; no visual authoring-builder UI found | 7 unit (271✓) + 4 integration (part of 234✓) + e2e |
| Professional Development | idea | tab-unproven | Card ambiguous between two real, built subsystems; no browser proof under either reading | 3 unit (87✓) + integration (part of 234/245✓) |
| Automated Reminders | idea | needs-refinement | Client-reminder idea entirely unbuilt; bundled "Therapist Snapshot" task is a separate, already-built feature | integration (part of 245✓) |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Guarded, renders per browser QA; no dedicated `profile-routes` test exists; tracker/UI wording mismatch found | 3 unit (87✓) + integration (244✓/1 env-artifact) |
| Interactive Assessments | idea | tab-unproven | Guarded, heavily tested (best coverage in this audit); tracker's WHODAS-only note confirmed out of date; no browser proof | 21 unit (1107✓) + 4 integration (part of 245✓) |
| Opa Mobile Companion | idea | proven | Self-scoped guards re-verified by direct grep; AI properly walled off; app itself isn't in this repo so no in-repo tab to e2e-test | 4 unit (163✓) + 3 integration (part of 41✓) |
| Password Master Document | idea | untouched | External OneDrive document; nothing to locate | none applicable |
| Report Templates | idea | tab-unproven | All 3 sub-tasks built & tested; no browser proof; CLAUDE.md's repo-map entry for this area confirmed stale | unit/integration shared with Interactive Assessments |
| Update Opal Docs Register | idea | untouched | External Excel/SharePoint document task; nothing to locate | none applicable |
| Xero Integration Works | idea | tab-unproven | Built & tested against mocks; no real-Xero sandbox or browser verification ever done | 6 unit (77✓) + integration (41✓ + onboarding batch) |

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
only — direct search confirms there is no SharePoint upload anywhere in
backend/. Add SharePoint storage for onboarding documents, reusing the
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
feature (fresh test runs, fresh guard checks), and `START.md` was only
rewritten where the evidence label actually changed or a genuinely new
finding warranted an update (Portal – Splose – Outlook, Portal Onboarding
Workflow, Inductions, Opa Mobile Companion — all reaffirmed `proven` with
updated two-line notes; Professional Development and Employee Personal
Page — updated in place with the new findings above).

## 6. What changed since last audit

**Zero commits** on `develop` since the 2026-11-11 audit. `develop` is
unchanged at `40669e7`. No subsystem moved tonight.

**Still true, and still worth a decision:** this repository's actively-developed
"Opal Assist" subsystem (`backend/assist-routes.js`, `backend/assist/*`,
its own migrations `084`-`086`, `block-review`, `booking-rules`, a
dedicated PWA) has no tracker card describing it at all, despite being one
of the largest areas of recent development (visible across the last two
weeks of commit history). It is correctly routed through `ai-gateway.js`.
Recommend the team add a tracker card for it so future audits test it
against actual intent rather than inferring scope from commit messages.

## 7. Technical detail

**Setup**: `backend/node_modules` present (`ls backend/node_modules/.bin/jest`
succeeded). PostgreSQL was already running (`service postgresql status` →
`16/main (port 5432): online`). Tracker snapshot fetched successfully:
`NODE_USE_ENV_PROXY=1 SUPABASE_URL=... node ../scripts/nightly-audit/fetch-tracker.mjs
/tmp/tracker.json` → "13 features, 19 tasks". Last audit date found from
the `claude/nightly-audit` branch's `docs/qa/nightly/` (newest:
`2026-11-11.md`, commit `40669e7`); change window = empty (zero commits),
confirmed with `git log --since="2026-11-11" --oneline -- backend frontend/current`.

**Commands run tonight** (all targeted — no complete suite; today is
Thursday UTC, not Sunday, so the weekly deep run does not apply):
- 8 grouped `npx jest <files>` unit runs covering every located unit test
  file across all 13 features (file lists and pass counts are in each
  feature's `STATUS.md`).
- 5 grouped `npx jest --config jest.integration.config.js <files>
  --runInBand` integration runs (`DB_NAME=therapy_scheduler_audit
  DB_PASSWORD=audit`), covering every located integration test file.
- `node ../scripts/nightly-audit/fetch-tracker.mjs` and
  `node ../scripts/nightly-audit/post-tracker.mjs` — both succeeded (see
  Write-back below).

**Known, non-code test artifacts (not defects), found and confirmed
tonight:**
1. `backend/tests/onboarding-document-reader.test.js` — one test fails
   because the optional OCR data package `@tesseract.js-data/eng` (listed
   in `package.json`) is missing from this sandbox's `node_modules`. This
   audit did not run `npm ci`/`npm install` (out of scope, and blocked by
   this repo's own permission settings for an unattended session). Not a
   code regression.
2. `backend/tests/integration/readonly-and-hardening.itest.js` — the
   "D-6/D-7: storage failure behaviour" test expects a `chmod 0o000`'d
   directory to cause a write failure (expects status ≥500, got 201).
   Confirmed directly tonight: this sandbox runs as `root` (`whoami` →
   `root`), and Linux's DAC permission checks are bypassed for root, so
   the chmod-based failure injection cannot work here regardless of real
   app behaviour. Needs a non-root sandbox to be meaningful — outside this
   audit's control.

**New findings this audit** (beyond the prior nights' standing list):
- Onboarding Stage 2's SharePoint document storage confirmed missing by a
  direct, targeted search of `backend/` (see "Do this first" #2).
- Interactive Assessments: FCA and the Progress Report/Support Letter
  templates confirmed as built and tested as WHODAS — the tracker's own
  notes are out of date (see "Do this first" #4).
- Employee Personal Page: the tracker's "work locations for the next 24
  hours" doesn't match the live UI's "next week" banner
  (`mockup_v3.html:4325`).
- CLAUDE.md §2's repository map lists `backend/service-agreement-routes.js`
  as the home of service agreements. That file does not exist — the logic
  lives in `backend/templates-routes.js` + `templates/service-agreement-map.js`.
  Report-only; not changed by this audit.
- No standalone `ASSESSMENT TAB` banner exists in `mockup_v3.html` — the
  FCA/letter/template builders render as entry points inside the Resource
  Hub's Library → Templates collection instead (confirmed directly at
  `mockup_v3.html:5325-5339`).

**Could not locate / open questions**:
- Should "Therapist Snapshot" be split out of the "Automated Reminders"
  card into its own tracker entry? It's unrelated and already built.
- Which subsystem does "Professional Development" actually mean (see
  "Do this first" #3)?
- Should "Opal Assist" get its own tracker card (see §6)?
- Tracker vs UI wording for Employee Personal Page (see above) — which is
  right?

**Weekly deep run**: not applicable — tonight (2026-11-12) is a Thursday
UTC, not Sunday.

**Write-back**: this ran twice tonight, and the second run left a known
inconsistency worth recording plainly rather than hiding.

This audit initially classified five features (Portal – Splose – Outlook,
Portal Onboarding Workflow, Inductions, Professional Development, Employee
Personal Page) more conservatively than the established multi-night
baseline on `claude/nightly-audit` warranted, before discovering that
branch's accumulated history (see the note under §1). The first
`post-tracker.mjs` run posted those preliminary labels. After reconciling
with the baseline and correcting five labels back in line with it (see §1
and each feature's `STATUS.md`), `post-tracker.mjs` was run a second time
with the corrected payload: `post-tracker: 0 features posted, 13 already
posted tonight, brief posted`.

Reading the script: the `claude_update`/`next_action` PATCH on each
feature runs unconditionally on every invocation, so **the corrected text
is what's live on every feature card now** — confirmed by inspecting
`scripts/nightly-audit/post-tracker.mjs` directly. The per-feature
assistant message and activity-feed row, however, are gated by a
per-`audit_date` idempotency check (deliberately, so a feature's chat
thread doesn't get spammed by a re-run) and were only posted on the first
call — so tonight's `feature_messages` entry and `activity` row for those
five features still carry the superseded, preliminary wording, not the
corrected one. The script is the only sanctioned write path and a third
hand-crafted call was not made, per the agent prompt's explicit
instruction. The feature cards' own summary fields, this brief, and the
`STATUS.md`/`START.md` files in this commit are the authoritative record
of tonight's (corrected) findings.

Ran before the `git push` below, per the rule.
