# Nightly tracker audit — 2026-09-25

## 1. Status line

**RAN.** 2026-09-25, ~18:07–18:35 UTC. Commit audited: `74601fc` (branch `develop`) — the same commit
the last three audits (2026-09-22, 2026-09-23, 2026-09-24) audited, now the **fourth night running**.
Last audit: 2026-09-24 (`docs/qa/nightly/2026-09-24.md`, found on `origin/claude/nightly-audit` —
`develop` never carries prior audit briefs forward, so this run fetched that branch directly to get the
correct window, same correction every prior audit night has made).

**Zero commits** landed in `backend`/`frontend/current` since the last audit for the fourth night
running — the tracker itself was equally quiet: every feature's `updated_at` still reads
`2026-09-24T18:33`–`18:34`ish (the 2026-09-24 write-back), no task status changed, no decision was
recorded. Every one of the 13 tracker features was re-verified fresh tonight — this session ran every
matching unit test file itself (six clusters, sequentially) and every matching integration test file
itself (five batches, sequentially, against a single database) — not reused from last night's numbers.

**Counts:** 1 proven · 8 tab-unproven · 2 needs-refinement · 2 untouched · 0 built-untested ·
0 broken (13 features total) — identical to the last three nights, at both the label and the
underlying-evidence level. All targeted tests passed with the same two known non-code sandbox
artifacts flagged every night since 2026-09-20 (see §7) — no regression anywhere. One nightly
variance worth noting: `fca-wizard-behaviour.test.js`, which showed two CPU-contention timing flakes
last night, ran clean tonight with no flakes at all (58/58, first pass).

## 2. Do this first

Nothing changed tonight, so nothing on this list is new — these are the same open items the last
three nights flagged, carried forward because they are still true and still unaddressed. Re-verified
fresh, not copy-pasted: every test named below was re-run tonight.

1. **Opal Assist — still no tracker card, eighth consecutive night.** No commit touched
   `backend/assist-routes.js`, `backend/assist/`, or `frontend/current/assist*.js/.css` tonight, and
   nothing changed there the three nights before either — this ~3,000-line CRITICAL-classification
   surface (AI, de-identification-adjacent) still has zero Development Manager feature card and zero
   browser/E2E coverage. Re-confirmed clean tonight: AI gateway boundary and policy registration both
   still hold; this session's own fresh run of the Assist + AI-gateway unit suite passed 352/352
   (21 suites), and `assist.itest.js` passed 3/3. This is a visibility gap, not a code-safety one.
2. **Opa Mobile Companion — the desktop composer is still unproven end to end.** No change tonight;
   the gap `1c17e78` opened four windows ago (a genuine desktop case-note composer,
   `frontend/current/casenotes-compose.js`, reaching the same Bedrock-backed clinical-summary path the
   mobile pilot does) is still there. Still well-guarded, still unit/integration tested (re-confirmed
   passing tonight — 197 case-note/mobile unit tests + 100 AI-gateway unit tests + 2 integration
   tests), still zero end-to-end proof.
3. **Calendar/Book tab — Splose practitioner linking, still two unproven UI surfaces, eight nights
   running.** Both the self-service Settings → Integrations → Splose screen (unproven since
   2026-09-18) and the owner-assigns Users & Roles screen (unproven since 2026-09-22) are unchanged
   tonight — correctly guarded, route-level tested (17 core Splose/sync suites / 388 tests, plus a
   clean 79-test integration batch including `admin-people.itest.js`), never driven by a browser test
   or E2E spec.
4. **Onboarding tab — still waiting on the same decision, not more code.** The dynamic Contract of
   Employment is unchanged and still tested (597/598 unit + 168 integration re-confirmed tonight, one
   known non-code failure — see §7). SharePoint document storage still doesn't exist in the code (only
   the same unrelated CSP allowlist entry, re-checked tonight), and Stage 1's "Send" button is still an
   Outlook draft, not a real send. Both still need a decision from the team, not more speculative code.
5. **Inductions — the same stale E2E assertion, still unfixed.** `e2e/tests/tutorials.spec.js:59` still
   asserts a heading (`'All learning'`) that no longer exists in `resourcehub.js` (re-confirmed by grep
   tonight, and by tracing the exact commit — `56f3aaa`, 2026-09-17 — that removed it). Flagged for
   eight consecutive nights now (2026-09-17 → 2026-09-25); still a one-line fix.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Xero Integration Works | idea | tab-unproven | Finance tab built + tested; no browser/E2E proof; Payroll Automation's own "send" ambition isn't built, only a read-only overview — unchanged | 26 suites/1127 unit ✓ (shared cluster), part of 232 integration ✓ (shared batch) |
| Update Opal Docs Register | idea | untouched | Non-coding task, nothing in repo — unchanged | none |
| Report Templates | idea | tab-unproven | FCA/letter/template engine built + tested, no browser/E2E proof — unchanged | part of 26-suite/1127-test unit cluster ✓ (no flake tonight), part of 232 integration ✓ (shared batch) |
| Professional Development | idea | tab-unproven | Split across Resource Hub PD + My Profile CPD, no tracker tasks — unchanged | part of 17-suite/761-test guard/resource-hub batch ✓ (shared) |
| Portal - Splose - Outlook | idea | tab-unproven | Sync engine proven; two Splose-linking UIs (self-service + owner-assigns), neither proven in browser — unchanged | 17 suites/388 unit ✓ (shared cluster), part of 79 integration ✓ (shared) |
| Portal Onboarding Workflow | idea | needs-refinement | Dynamic contract built + tested; SharePoint storage & Stage 1 "Send" still open decisions — unchanged | 597/598 unit* + 168 integration ✓ |
| Password Master Document | idea | untouched | Non-coding task, nothing in repo — unchanged | none |
| Opa Mobile Companion | idea | tab-unproven | Desktop case-note composer well-tested, zero E2E — unchanged | 197+100 unit ✓, 2 integration ✓ (shared) |
| Interactive Assessments | idea | tab-unproven | WHODAS fully built + tested, no browser/E2E proof — unchanged | part of 26-suite/1127-test unit cluster ✓, part of 232 integration ✓ (shared batch) |
| Inductions | idea | needs-refinement | Stale `tutorials.spec.js:59` assertion still unfixed — unchanged | 18 suites/518 unit ✓ (shared cluster), part of 176 integration ✓ (shared) |
| Employee Personal Page (My Profile Tab) | idea | tab-unproven | Built + mostly tested; "24hr" reminder is actually weekly-Friday; row I browser evidence is render-only, not full-flow proof — unchanged | part of 176 integration** ✓ (shared) |
| Clinical resources | idea | proven | No distinct code — maps entirely to the (proven) Resource Hub — unchanged | 10 suites/382 unit (370 pass/12 skip) ✓, part of 176 integration ✓ (shared) |
| Automated Reminders | idea | tab-unproven | Snapshot built + tested, client reminders not built at all — unchanged | part of 79 integration ✓ (Snapshot, shared batch) |

\* One test in `onboarding-document-reader.test.js` failed ("the OCR language data is shipped with the
portal"): re-confirmed the same environment artifact as every prior night since 2026-09-20 —
`@tesseract.js-data/eng` is declared in `backend/package.json` but genuinely missing from
`backend/node_modules` in this sandbox, and this audit cannot run `npm install` to fix that. Not a
code defect. See §7.

\*\* Same known `readonly-and-hardening.itest.js` sandbox-root `chmod` artifact flagged every prior
audit night since 2026-09-20 — root bypasses the simulated storage-write failure, not a code defect.
See §7.

## 4. Prompts for the morning

Same five prompts as the last three nights — nothing changed, so nothing about the work itself
changed. Re-paste as-is; each names the files this audit located and the test that should pass when
done.

**`/opal-critical` — Opal Assist, close the tracker visibility gap**
> Read `docs/qa/nightly/features/README.md`'s note on Opal Assist and `backend/ai/ai-policy.js`'s
> `opal_assist` entry for what already exists. This is CRITICAL work (AI, de-identification-adjacent)
> with no Development Manager feature card after eight straight nights of the surface sitting untouched
> but unlabelled (`backend/assist-routes.js`, `backend/assist/`, `frontend/current/assist*.js/.css`,
> ~3,000 lines). Before more code lands here: create a tracker feature card for it (or confirm it's
> intentionally out-of-tracker), and add at least one E2E/browser QA entry — there is currently zero
> browser coverage of any kind.

**`/opal-critical` — Opa Mobile Companion, prove the desktop composer end to end**
> Read `docs/qa/nightly/features/opa-mobile-companion/START.md` for full context.
> `frontend/current/casenotes-compose.js` lets a therapist dictate and generate a case note directly
> in the portal, reusing the mobile pilot's Bedrock-backed `/api/mobile/case-note-drafts/*` endpoints.
> Add `e2e/tests/case-notes-compose.spec.js`, following `portal.spec.js`'s login/tab pattern: log in
> as a therapist, open Case Notes → "New case note," pick a caseload client, type a transcript
> (dictation isn't reliably automatable in CI), complete the names check, generate a draft, and assert
> it lands in the review surface linked to the right client. Also fix
> `docs/mobile/CASE_NOTE_AI_PRIVACY.md` — it still says this feature needs `ANTHROPIC_API_KEY`; the
> code (both the mobile pilot and this desktop composer) routes exclusively through AWS Bedrock.

**`/opal-feature` — Portal-Splose-Outlook, prove both Splose-linking UIs**
> Read `docs/qa/nightly/features/portal-splose-outlook-integration-works/START.md`. Extend
> `e2e/tests/portal.spec.js` with a describe block that: opens Settings → Users & Roles
> (`frontend/current/people.js`), exercises the owner-assigns-practitioner dropdown for a seeded user
> (success + already-claimed-practitioner-disabled cases), and separately exercises the pre-existing
> self-service Settings → Integrations → Splose screen as both an owner and a therapist. One spec
> covering both closes a gap that's been open since 2026-09-18.

**`/opal-critical` — Portal Onboarding Workflow, decide SharePoint and Stage 1 Send**
> Read `docs/qa/nightly/features/portal-onboarding-workflow/START.md`. The dynamic Contract of
> Employment is built and tested (`backend/onboarding-contract-docx.js`,
> `backend/onboarding-document-reader.js`) — no code needed there. What's left needs a decision, not a
> build: is SharePoint storage for onboarding documents still wanted, given documents already persist
> reliably in Postgres today? And is Stage 1's Outlook-draft "Send" (confirmed intentional and QA'd)
> still the final design, or is a real send path still wanted? Record both decisions in the tracker
> (feature `32b768b1-8bf3-40a6-9669-a8908922aa21`) before any further code lands on either.

**`/opal-fast-change` — Inductions, fix the stale e2e assertion**
> `e2e/tests/tutorials.spec.js:59` asserts
> `page.getByRole('heading', { name: 'All learning' })` — that heading text no longer exists in
> `frontend/current/resourcehub.js`; the Owner's Assign Learning view now shows
> `<h1 class="rh2-h1">Assign Learning</h1>` with three tabs. Replace the assertion with the current
> heading text and confirm the spec passes.

## 5. Ideas without a start

No feature folder was created or had its `START.md` substantively rewritten tonight — every gap the
folders describe is unchanged from the last three nights, so every `START.md` was carried forward
as-is. Only `STATUS.md` files were rewritten (all 13, to record tonight's fresh re-verification and the
"no commits, no tracker changes" window).

## 6. What changed since last audit

**Nothing.** Zero commits landed in `backend`, `frontend/current`, or their tests since the last audit
— `git log --oneline 74601fc..origin/develop -- backend frontend/current` is empty. `develop` sits on
the exact same commit (`74601fc`) it has sat on for four consecutive audit nights. No subsystem
changed, tracked or untracked. The tracker's own `updated_at` timestamps confirm no human touched any
feature, task, or decision since the 2026-09-24 write-back either.

## 7. Technical detail

**Setup**: bootstrap checked out `nightly-audit-work` from `origin/develop` per the task's own
instructions, then — as every prior audit night has also had to do — fetched `origin/claude/nightly-audit`
directly to recover the five-plus prior nightly briefs and feature folders, since `develop` never
carries them forward. Rebased this session's work onto that branch's history before writing anything.
PostgreSQL was **down** at session start tonight (unlike prior nights) — started it with
`service postgresql start` before proceeding; `backend/node_modules/.bin/jest` was present, so no
`npm install` was needed.

**Window determination**: `docs/qa/nightly/2026-09-24.md` was the newest dated brief; used
2026-09-24 → 2026-09-25 as the window. `git log --oneline 74601fc..origin/develop -- backend
frontend/current` confirmed zero commits in the window before any per-feature verification began.
Tracker fetch (`fetch-tracker.mjs`) returned the same 13 features, 19 tasks as last night, every
`updated_at` still reading last night's write-back timestamp and every task still `status: todo` —
confirmed no human touched the tracker overnight either.

**Verification approach**: this session re-located every feature directly against last night's
`STATUS.md` files (locate/guard-check output does not change when zero commits land), then ran every
matching test file itself, fresh, in six unit clusters and five integration batches, sequentially
against a single database (`DB_NAME=therapy_scheduler_audit`), to avoid the concurrent-database-
truncation hazard `tests.md` warns about. A handful of guard claims (`finance-routes.js`,
`snapshot-routes.js`, `whodas-routes.js`, `resources-routes.js`) and every "not located"/artifact claim
from prior nights were independently re-grepped tonight rather than only re-read from the prior
`STATUS.md` files.

**Commands run** (all from `backend/`, targeted per feature, never a complete suite — Friday UTC,
not Sunday, so no weekly deep run):

Unit, six clusters:
```
# Xero/Finance + Report Templates + Assessments
npx jest tests/finance-flags.test.js tests/finance-routes.test.js tests/xero-payroll-api.test.js \
  tests/xero-payroll-mapping.test.js tests/xero-payroll-sync.test.js tests/onboarding-payroll.test.js \
  tests/fca-docx-engine.test.js tests/fca-frontend-helpers.test.js tests/fca-preview-lifecycle.test.js \
  tests/fca-preview-pages.test.js tests/fca-resolve-scalars.test.js tests/fca-wizard-behaviour.test.js \
  tests/letter-docx-engine.test.js tests/letter-frontend-helpers.test.js tests/letter-template-map.test.js \
  tests/templates-appendices.test.js tests/templates-export-boundary.test.js \
  tests/templates-frontend-guards.test.js tests/templates-routes.test.js \
  tests/templates-service-agreement-map.test.js tests/assessment-catalogue.test.js \
  tests/assessment-surface-guards.test.js tests/whodas-scoring.test.js tests/whodas-templates.test.js \
  tests/whodas-frontend-guards.test.js tests/whodas-external-completion.test.js
  → 26 suites / 1127 tests, 0 failures (no repeat of last night's fca-wizard-behaviour flake)

# Inductions + Interactive Assessments + Opa Mobile Companion + AI gateway core
npx jest tests/induction-assistant.test.js tests/induction-registry.test.js \
  tests/learning-admin-routes.test.js tests/learning-content.test.js tests/learning-routes.test.js \
  tests/walkthrough-content.test.js tests/assign-learning-guards.test.js tests/mobile-routes.test.js \
  tests/case-note-routes.test.js tests/casenotes-compose.test.js tests/casenotes-helpers.test.js \
  tests/clinical-note-provider.test.js tests/clinical-note-deidentify.test.js tests/ai-gateway.test.js \
  tests/ai-gateway-boundary.test.js tests/ai-single-gateway-guards.test.js tests/ai-deidentify.test.js \
  tests/ai-deidentification-gate.test.js
  → 18 suites / 518 tests, 0 failures

# Onboarding
npx jest tests/onboarding-*.test.js
  → 24 suites, 23 passed / 1 failed (597/598 tests) — known tesseract-data artifact

# Splose/Outlook sync
npx jest tests/splose-link-routes.test.js tests/splose-api-queue.test.js tests/splose-credentials.test.js \
  tests/splose-poller.test.js tests/splose-draft-sync.test.js tests/sync.test.js tests/sync-safety.test.js \
  tests/sync-status-route.test.js tests/outlook-mirror.test.js tests/outlook-delta-preserve.test.js \
  tests/scheduler-geo.test.js tests/scheduler-helpers.test.js tests/scheduler-matrix.test.js \
  tests/travel-cascade.test.js tests/travel-feasibility.test.js tests/availability-engine.test.js \
  tests/contact-matching.test.js
  → 17 suites / 388 tests, 0 failures

# Guard suites + PD + Resource Hub
npx jest tests/frontend-stage2-guards.test.js tests/frontend-stage3-guards.test.js \
  tests/frontend-undo-guards.test.js tests/frontend-xss-guards.test.js \
  tests/credential-surface-guards.test.js tests/security.test.js tests/pd-catalogue-guards.test.js \
  tests/resource-file-delivery.test.js tests/resource-file-quality.test.js tests/resource-governance.test.js \
  tests/resource-hub-badge-guards.test.js tests/resource-hub-final.test.js tests/resource-ingestion.test.js \
  tests/resource-library-frontend-guards.test.js tests/resource-privacy-scan.test.js \
  tests/resource-seed-guards.test.js tests/resource-source-scan.test.js
  → 17 suites / 761 tests (749 passed, 12 skipped), 0 failures

# Opal Assist (untracked, visibility check) + remaining AI gateway
npx jest tests/assist-deidentify.test.js tests/assist-entra-auth.test.js tests/assist-office-auth.test.js \
  tests/assist-page.test.js tests/assist-routes.test.js tests/ai-audit-finalise.test.js \
  tests/ai-aws-federation.test.js tests/ai-bedrock-guardrail.test.js tests/ai-bedrock-input-tagging.test.js \
  tests/ai-bedrock-success-path.test.js tests/ai-diagnostic-leak-proof.test.js tests/ai-direct-provider.test.js \
  tests/ai-model-tier-and-usage.test.js tests/ai-operational-readiness.test.js tests/ai-streaming.test.js \
  tests/ai-warmup.test.js
  → 16 suites / 252 tests, 0 failures
```

Integration (`DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit`, sequential, 5 batches):
```
tests/integration/accounting-phase2.itest.js tests/integration/accounting-routes.itest.js \
  tests/integration/finance-routes.itest.js tests/integration/assessments.itest.js \
  tests/integration/fca-reports.itest.js tests/integration/progress-note-letters.itest.js \
  tests/integration/templates.itest.js tests/integration/whodas.itest.js --runInBand
  → 8 suites / 232 tests, 0 failures

tests/integration/resource-hub-r2.itest.js tests/integration/documents.itest.js \
  tests/integration/credential-scans.itest.js tests/integration/readonly-and-hardening.itest.js \
  tests/integration/audit.itest.js tests/integration/stage2-pilot-readiness.itest.js \
  tests/integration/onboarding-returns.itest.js tests/integration/induction-assistant.itest.js \
  tests/integration/learning-admin.itest.js tests/integration/learning.itest.js \
  tests/integration/onboarding-induction.itest.js tests/integration/tutorial-progress.itest.js --runInBand
  → 12 suites / 176 tests, 1 failed (readonly-and-hardening, known artifact — see below), 175 pass

tests/integration/onboarding-defaults.itest.js tests/integration/onboarding-journey.itest.js \
  tests/integration/onboarding-pack.itest.js tests/integration/onboarding-payroll-xero.itest.js \
  tests/integration/onboarding-workflow.itest.js tests/integration/onboarding.itest.js --runInBand
  → 6 suites / 168 tests, 0 failures

tests/integration/splose-connection.itest.js tests/integration/splose-draft-sync.itest.js \
  tests/integration/case-note-client-link.itest.js tests/integration/case-note-deidentification.itest.js \
  tests/integration/opa.itest.js tests/integration/admin-people.itest.js \
  tests/integration/routes-users.itest.js tests/integration/users.itest.js \
  tests/integration/snapshot.itest.js --runInBand
  → 9 suites / 79 tests, 0 failures

tests/integration/assist.itest.js --runInBand
  → 1 suite / 3 tests, 0 failures (untracked Opal Assist, re-verified for visibility only)
```

**Totals, this session's own fresh runs tonight**: unit — 118 suites / 3644 tests, 3631 passing, 1
known non-code failure, 12 skipped; integration — 36 suites / 658 tests, 657 passing, 1 known
non-code failure. Every figure is consistent with the last three nights' recorded numbers — no
regression anywhere.

**The two known non-code failures** (unchanged from every prior night since 2026-09-20):
1. `tests/integration/readonly-and-hardening.itest.js`, "D-6/D-7: storage failure behaviour (local
   backend)" — this container runs as `root`; the test simulates an unwritable storage directory via
   `fs.chmodSync(dir, 0o000)`, which root bypasses on Linux, so the simulated failure never occurs
   (confirmed tonight: expected `>= 500`, got `201`). Report-only (`backend/tests/**` edits aren't in
   scope for a nightly audit).
2. `tests/onboarding-document-reader.test.js`, "the OCR language data is shipped with the portal" —
   the `@tesseract.js-data/eng` package is declared in `backend/package.json` but missing from
   `backend/node_modules` in this sandbox (re-confirmed tonight: `ls
   backend/node_modules/@tesseract.js-data` → No such file or directory). Cannot fix without `npm
   install`, which this audit's hard limits prohibit.

**Not located / open questions** (carried forward from prior nights, re-confirmed tonight, still
true, nothing new to add):
- `backend/onboarding-policies/` (named in this audit's own setup instructions and in CLAUDE.md's
  repo map) does not exist; the closest match is `backend/onboarding-templates/`.
- `backend/service-agreement-routes.js` (named in this audit's own setup instructions) does not
  exist; the Service Agreement is served by `backend/templates-routes.js` +
  `backend/templates/service-agreement-map.js`.
- `backend/routes-outlook-integration.js` and `backend/routes-backup-original.js` remain dead/
  unmounted duplicate Outlook/sync logic, confirmed still never `require()`d anywhere, not cleaned up
  (report-only).
- `backend/instrument-register-routes.js` still has no test file matched by name.
- Whether `ENABLE_WHODAS_ASSESSMENT` and `CLINICAL_NOTE_AI_ENABLED` are actually `true` in the live/
  staging environment was not checked (out of scope for a code-only audit).

**Write-back**: `post-tracker.mjs /tmp/writeback.json` → `post-tracker: 13 features posted, 0 already
posted tonight, brief posted`. Ran successfully, before the git push below, per this audit's own
ordering rule.
