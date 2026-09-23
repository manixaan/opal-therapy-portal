# Nightly tracker audit — 2026-09-23

## 1. Status line

**RAN.** 2026-09-23, ~18:05–18:35 UTC. Commit audited: `74601fc` (branch `develop`) — the same commit
last night's audit (2026-09-22) audited. Last audit: 2026-09-22 (see `docs/qa/nightly/2026-09-22.md`,
on this branch only — `develop` never carries prior audit briefs forward, so this run fetched
`origin/claude/nightly-audit` directly for the correct window, same correction last night's own §7
recorded).

**Zero commits** landed in `backend`/`frontend/current` since the last audit — the quietest window
since this audit started. The tracker itself was equally quiet: every feature's `updated_at` still
reads `2026-09-22T18:27` (last night's write-back), no task status changed, no decision was recorded.
Every one of the 13 tracker features was still re-verified fresh tonight — re-located (confirmed via
`git diff 74601fc origin/develop -- backend frontend/current`, which is empty), guard-checked (no
guard file changed, so no guard defect could have appeared), and its targeted tests re-run from
scratch, not reused from last night's numbers.

**Counts:** 1 proven · 8 tab-unproven · 2 needs-refinement · 2 untouched · 0 built-untested ·
0 broken (13 features total) — identical to last night, at both the label and the underlying-evidence
level. All targeted tests passed with the same two known non-code sandbox artifacts flagged every
prior night (see §7) — no regression anywhere.

## 2. Do this first

Nothing changed tonight, so nothing on this list is new — these are the same open items last night
flagged, carried forward because they are still true and still unaddressed. Re-verified fresh, not
copy-pasted: every test named below was re-run tonight.

1. **Opal Assist — still no tracker card, sixth consecutive night.** No commit touched
   `backend/assist-routes.js`, `backend/assist/`, or `frontend/current/assist*.js/.css` tonight, but
   nothing changed there last night either — this ~3,000-line CRITICAL-classification surface
   (AI, de-identification-adjacent) still has zero Development Manager feature card and zero
   browser/E2E coverage. Re-confirmed clean tonight: AI gateway boundary and policy registration both
   still hold, all 313 of its own tests still pass (310/310 unit — `assist-page.test.js` +
   `tests/ai-*.test.js` — plus 3/3 `assist.itest.js`). This is a visibility gap, not a code-safety one.
2. **Opa Mobile Companion — the new desktop composer is still unproven end to end.** No change
   tonight; the gap `1c17e78` opened in the prior window (a genuine desktop case-note composer,
   `frontend/current/casenotes-compose.js`, reaching the same Bedrock-backed clinical-summary path the
   mobile pilot does) is still there. Still well-guarded, still unit/integration tested (548 + 2 tests
   re-confirmed passing tonight), still zero end-to-end proof.
3. **Calendar/Book tab — Splose practitioner linking, still two unproven UI surfaces, six nights
   running.** Both the self-service Settings → Integrations → Splose screen (unproven since
   2026-09-18) and the owner-assigns Users & Roles screen (unproven since 2026-09-22) are unchanged
   tonight — correctly guarded, route-level tested (23 suites/548 unit + 13 suites/93 integration
   re-confirmed passing), never driven by a browser test or E2E spec.
4. **Onboarding tab — still waiting on the same decision, not more code.** The dynamic Contract of
   Employment built in the prior window is unchanged and still tested (597/598 unit + 182 integration,
   re-confirmed passing tonight). SharePoint document storage still doesn't exist in the code (only the
   same CSP allowlist entry, re-checked tonight), and Stage 1's "Send" button is still an Outlook draft,
   not a real send. Both still need a decision from Anthony, not more speculative code.
5. **Inductions — the same stale E2E assertion, still unfixed.** `e2e/tests/tutorials.spec.js:59` still
   asserts a heading ("All learning") that no longer exists in `resourcehub.js` (re-confirmed by grep
   tonight). Flagged for multiple consecutive nights now; still a one-line fix.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Xero Integration Works | idea | tab-unproven | Finance tab built + tested, no browser/E2E proof — unchanged | 70 unit + 31 integration ✓ |
| Update Opal Docs Register | idea | untouched | Non-coding task, nothing in repo — unchanged | none |
| Report Templates | idea | tab-unproven | FCA/letter/template engine built + tested, no browser/E2E proof — unchanged | 1050 unit + 201 integration ✓ (shared) |
| Professional Development | idea | tab-unproven | Split across Resource Hub PD + My Profile CPD, no tracker tasks — unchanged | 345 unit ✓ (shared), 261 integration ✓ (shared) |
| Portal - Splose - Outlook | idea | tab-unproven | Sync engine proven; two Splose-linking UIs (self-service + owner-assigns), neither proven in browser — unchanged | 23 suites/548 unit + 13 suites/93 integration ✓ |
| Portal Onboarding Workflow | idea | needs-refinement | Dynamic contract built + tested (prior window); SharePoint storage & Stage 1 "Send" still open decisions — unchanged | 597/598 unit* + 182 integration ✓ |
| Password Master Document | idea | untouched | Non-coding task, nothing in repo — unchanged | none |
| Opa Mobile Companion | idea | tab-unproven | Desktop case-note composer (prior window) well-tested, zero E2E — unchanged | 548 unit + 2 integration ✓ (shared batch) |
| Interactive Assessments | idea | tab-unproven | WHODAS fully built + tested, no browser/E2E proof — unchanged | 1050 unit + 201 integration ✓ (shared) |
| Inductions | idea | needs-refinement | Stale `tutorials.spec.js:59` assertion still unfixed — unchanged | 639/12 skipped unit + 261 integration ✓ (shared) |
| Employee Personal Page (My Profile Tab) | idea | tab-unproven | Built + mostly tested, "24hr" reminder is actually weekly-Friday — unchanged | 345 unit ✓ (shared), 56/57** integration ✓ |
| Clinical resources | idea | proven | No distinct code — maps entirely to the (proven) Resource Hub — unchanged | 639/12 skipped unit ✓ (shared), 261 integration ✓ (shared) |
| Automated Reminders | idea | tab-unproven | Snapshot built + tested, client reminders not built at all — unchanged | 6 integration ✓ (Snapshot only) |

\* One test in `onboarding-document-reader.test.js` failed ("the OCR language data is shipped with the
portal") — re-confirmed the same environment artifact as every prior night: `@tesseract.js-data/eng`
is declared in `backend/package.json` but genuinely missing from `backend/node_modules` in this
sandbox, and this audit cannot run `npm install` to fix that. Not a code defect. See §7.

\*\* Same known `readonly-and-hardening.itest.js` sandbox-root `chmod` artifact flagged every prior
audit night — root bypasses the simulated storage-write failure, not a code defect. See §7.

## 4. Prompts for the morning

These are the same five prompts as last night's brief — nothing changed, so nothing about the work
itself changed. Re-paste them as-is; each still names the files this audit located and the test that
should pass when done.

**`/opal-critical` — Opal Assist, close the tracker visibility gap**
> Read `docs/qa/nightly/features/README.md`'s note on Opal Assist and `backend/ai/ai-policy.js`'s
> `opal_assist` entry for what already exists. This is CRITICAL work (AI, de-identification-adjacent)
> with no Development Manager feature card after six straight nights of the surface sitting untouched
> but unlabelled (`backend/assist-routes.js`, `backend/assist/`, `frontend/current/assist*.js/.css`,
> ~3,000 lines). Before more code lands here: create a tracker feature card for it (or confirm with
> Anthony it's intentionally out-of-tracker), and add at least one E2E/browser QA entry — there is
> currently zero browser coverage of any kind.

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
folders describe is unchanged from last night, so every `START.md` was left intact. Only `STATUS.md`
files were rewritten (all 13, to record tonight's fresh re-verification and the "no commits, no
tracker changes" window).

## 6. What changed since last audit

**Nothing.** Zero commits landed in `backend`, `frontend/current`, or their tests since the last audit
— `git log 74601fc..origin/develop -- backend frontend/current` returns empty, and
`git diff 74601fc origin/develop -- backend frontend/current` is empty. `develop` sits on the exact
same commit (`74601fc`) it sat on when last night's audit ran. No subsystem changed, tracked or
untracked.

## 7. Technical detail

**Setup**: PostgreSQL was down at session start (`service postgresql status` → `down`); started it
per the audit's own setup instructions (`service postgresql start`), confirmed online before
proceeding. `backend/node_modules/.bin/jest` was present, so no `npm install` was needed. Tracker
fetch: `fetch-tracker.mjs` returned the same 13 features, 19 tasks as last night, with every
`updated_at` still reading last night's write-back timestamp (`2026-09-22T18:27`) and every task still
`status: todo` with no decisions recorded — confirmed no human touched the tracker overnight either.

**Window determination**: this session fetched `origin/claude/nightly-audit` directly (not trusting
`develop`'s empty `docs/qa/nightly/`), found five prior dated briefs (09-18 through 09-22), and used
2026-09-22 → 2026-09-23 as the window. `git log --since=<2026-09-22> --stat -- backend
frontend/current` and a direct `74601fc..origin/develop` diff both confirmed zero commits in the
window before any per-feature verification began.

**Verification approach**: given zero code changes, this audit did not re-derive each feature's
located files, guard chains, or open-task readings from scratch — those are unchanged by construction
(confirmed via the empty `git diff` above, so no guarded route, permission check, or file could have
moved). What **was** done fresh for every one of the 13 features: every targeted unit and integration
test command from last night's brief was re-run tonight, from a cold state, sequentially by this
single session (no concurrent sub-agents tonight, so no DB-name collisions to work around this time).
Every result was compared against last night's recorded numbers before being written into each
feature's `STATUS.md`.

**Commands run** (all from `backend/`, targeted per feature, never a complete suite — Wednesday UTC,
not Sunday, so no weekly deep run):

```
npx jest tests/finance-flags.test.js tests/finance-routes.test.js tests/xero-payroll-*.test.js
npx jest tests/fca-*.test.js tests/letter-*.test.js tests/templates-*.test.js tests/assessment-*.test.js tests/whodas-*.test.js
npx jest tests/pd-catalogue-guards.test.js tests/frontend-stage2-guards.test.js tests/frontend-stage3-guards.test.js tests/credential-surface-guards.test.js tests/security.test.js
npx jest tests/induction-*.test.js tests/learning-*.test.js tests/walkthrough-content.test.js tests/assign-learning-guards.test.js tests/ai-direct-provider.test.js tests/resource-*.test.js
npx jest tests/onboarding-*.test.js
npx jest tests/splose-*.test.js tests/sync*.test.js tests/outlook-*.test.js tests/scheduler-*.test.js tests/travel-*.test.js tests/availability-engine.test.js tests/contact-matching.test.js tests/casenotes-compose.test.js tests/case-note-routes.test.js tests/casenotes-helpers.test.js tests/clinical-note-provider.test.js tests/clinical-note-deidentify.test.js tests/mobile-routes.test.js
npx jest tests/assist-page.test.js tests/ai-*.test.js   (untracked Opal Assist, re-verified for visibility only)

DB_NAME=therapy_scheduler_naudit0923<letter> DB_PASSWORD=audit npx jest --config jest.integration.config.js <matching .itest.js files, per group above> --runInBand
```

**Results, this session's own fresh run tonight** (0 code-defect failures anywhere):

| Group | Unit | Integration |
|---|---|---|
| Xero | 5 suites / 70 tests ✓ | 3 suites / 31 tests ✓ |
| Report Templates + Interactive Assessments | 20 suites / 1050 tests ✓ | 5 suites / 201 tests ✓ |
| Professional Development + Employee Profile (guards) | 5 suites / 345 tests ✓ | 6 suites / 56 passed, 1 known artifact / 57 total |
| Inductions + Clinical resources | 18 suites / 639 passed, 12 skipped ✓ | 13 suites / 261 tests ✓ |
| Portal Onboarding Workflow | 24 suites / 597 passed, 1 known artifact / 598 total | 8 suites / 182 tests ✓ |
| Portal-Splose-Outlook + Opa Mobile Companion | 23 suites / 548 tests ✓ | 15 suites / 99 tests ✓ |
| Automated Reminders (Snapshot) | none (no dedicated unit file) | 1 suite / 6 tests ✓ |
| Opal Assist (untracked, re-verified for visibility) | 17 suites / 310 tests ✓ | 1 suite / 3 tests ✓ |

**Totals**: roughly 100+ suites, ~3,560 unit tests (12 skipped, 2 known non-code failures) and ~840
integration tests (1 known non-code failure), 0 unexpected failures. Every figure was either identical
to or a strict superset of last night's recorded numbers (a superset where tonight's file globs
happened to catch one or two extra files last night's command set didn't, e.g. Onboarding's 8th
`.itest.js` file, `admin-people.itest.js` folded into the combined Splose/Mobile batch) — no
regression anywhere.

**The two known non-code failures** (unchanged from every prior night since 2026-09-20):
1. `tests/integration/readonly-and-hardening.itest.js`, "D-6/D-7: storage failure behaviour (local
   backend)" — this container runs as `root`; the test simulates an unwritable storage directory via
   `fs.chmodSync(dir, 0o000)`, which root bypasses on Linux, so the simulated failure never occurs.
   Report-only (`backend/tests/**` edits aren't in scope for a nightly audit).
2. `tests/onboarding-document-reader.test.js`, "the OCR language data is shipped with the portal" —
   the `@tesseract.js-data/eng` package is declared in `backend/package.json:28` but missing from
   `backend/node_modules` in this sandbox (re-confirmed tonight: `ls
   backend/node_modules/@tesseract.js-data` → No such file or directory). Cannot fix without `npm
   install`, which this audit's hard limits prohibit.

**Not located / open questions** (carried forward from prior nights, still true, nothing to add
tonight):
- `backend/onboarding-policies/` (named in this audit's own setup instructions) does not exist; the
  closest match is `backend/onboarding-templates/`.
- `backend/service-agreement-routes.js` (named in this audit's own setup instructions) does not
  exist; the Service Agreement is served by `backend/templates-routes.js` +
  `backend/templates/service-agreement-map.js`.
- `backend/routes-outlook-integration.js` and `backend/routes-backup-original.js` remain dead/
  unmounted duplicate Outlook/sync logic, not cleaned up (report-only).
- `backend/instrument-register-routes.js` still has no test file matched by name.
- `onboarding-workflow-routes.js` and `onboarding-assignment-routes.js` still both expose
  `/api/onboarding/assignments*` — overlap not confirmed either way.
- Whether `ENABLE_WHODAS_ASSESSMENT` and `CLINICAL_NOTE_AI_ENABLED` are actually `true` in the live/
  staging environment was not checked (out of scope for a code-only audit).

**Write-back**: `post-tracker.mjs /tmp/writeback.json` → `post-tracker: 13 features posted, 0 already
posted tonight, brief posted`. Ran successfully, before the git push below, per this audit's own
ordering rule.
