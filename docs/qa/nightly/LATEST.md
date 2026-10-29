# Nightly tracker audit — 2026-10-29

## 1. Status line

**RAN** · 2026-10-29 18:13–18:41 UTC · commit audited: `15acf0c` (branch `develop`) · **this is the same commit last night's audit (2026-10-28) audited — develop has not moved. Tonight's true window is empty (0 commits).** Every feature was independently re-verified from scratch tonight anyway (locate, guard check, targeted tests re-run), per this audit's standing practice of re-checking even a narrow window.

*(Correction: this agent's own bootstrap only checked `docs/qa/nightly/` on a fresh `develop`-based checkout, which never carries previous nights' briefs since this branch is never merged — so it initially treated tonight as a first-ever run and gathered a 14-day commit history for context. That 14-day list is used below as background/historical colour, but every "addressed since the last audit" judgement in this brief and in each feature's STATUS.md correctly reflects the real, empty 1-night window once the existing `claude/nightly-audit` branch history came into view.)*

Counts across the tracker's 13 features: **broken 2** · **tab-unproven 5** · **needs-refinement 4** · **untouched 2** · proven 0 · built-untested 0 (several features have a *sub-part* that is fully proven — see "Every feature" below and each feature's STATUS.md).

## 2. Do this first

1. **[broken]** `GET /api/outlook/categories` returns a 500, not a clean response, when a user hasn't connected Outlook (`backend/routes.js:1487`). No test covers it. — *Portal - Splose - Outlook | Integration Works*
2. **[broken]** Returned-document OCR reading fails on a missing `@tesseract.js-data/eng` package in this sandbox; must be confirmed present (or added) in the real deployment. — *Portal Onboarding Workflow*
3. **[disagreement — tracker was ahead of the evidence]** Last night's tracker update called **Payroll Automation** "proven." Tonight's independent check found a real, untested UI panel (`payrollConfigForm` in `onboarding-journey.js`) with no browser or E2E proof — it should read `tab-unproven`, same as its sibling Financial Dashboard. — *Xero Integration Works*
4. **[tab-unproven, daily tab]** The Onboarding tab's admin package/compliance screens (the "production-ready" rebuild, built over recent weeks) have no browser or E2E check at all — only the basic invite→register path is covered. — *Portal Onboarding Workflow*
5. **[tab-unproven, daily tab]** The rebuilt document Library view in the Resources tab (folders, recycle bin, file versions, the privacy-override "Upload anyway" checklist) is fully tested but has never been opened in a browser. — *Clinical resources*

**Standing issue, not feature-specific:** every one of the 13 tracker cards is still staged `idea`. Eleven of them already have real, guarded, mostly-tested code in this repository — several (onboarding, resources, assessments, Xero) are substantial production features. This is a tracker-hygiene gap across the whole board, not a defect in any one card.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Portal - Splose - Outlook \| Integration Works | idea | broken | `/api/outlook/categories` 500s with no Outlook connection; no test; "Multi Calendar Rules" task has no code | 7 unit suites (101) + 1 integration suite (12) pass |
| Portal Onboarding Workflow | idea | broken | OCR dependency missing (1 test fails); rest of the subsystem is tab-unproven | 25 unit suites (632) + 10 integration suites (218) pass; 1 of 22 fails (OCR) |
| Clinical resources | idea | tab-unproven | Library view + privacy checklist fully tested, never opened in a browser | 12 unit files (398 pass, 12 skipped) + 7 integration files (168) pass |
| Inductions | idea | tab-unproven (2 of 3 sub-parts are proven) | Induction Playground untested in browser; Portal & Splose Inductions are proven by e2e + a dedicated integration test | 6 unit suites (133) + 7 integration suites (128) pass |
| Professional Development | idea | needs-refinement | Two unrelated "CPD" systems; the My Profile approve/reject round trip has no test | 1 unit file (46) pass; CPD-tracker integration coverage passes; 0 tests for the untested system |
| Automated Reminders | idea | needs-refinement | Therapist Snapshot is tab-unproven; the 24hr client reminder has no code at all | 1 unit file (289) + 1 integration file (6) pass |
| Employee Personal Page (My Profile Tab) | idea | needs-refinement | Credentials/documents/work-location proven indirectly; leave+CPD round trip untested | covered indirectly via documents/credentials test files; 0 dedicated tests for leave/CPD |
| Interactive Assessments | idea | tab-unproven | FCA/WHODAS/letter all pass fully and are guarded; no browser/E2E proof any wizard produces a document | 15 unit files + 4 integration files, all pass |
| Opa Mobile Companion | idea | needs-refinement | Mobile API guarded and fully tested; no way to confirm the real mobile client calls it from this repo | 2 unit files (122) + 2 integration files (6) + AI-gateway boundary checks (30) pass |
| Password Master Document | idea | untouched | Describes an external OneDrive document; no code should exist | none — no code to test |
| Report Templates | idea | tab-unproven | FCA/Letter/Client Agreement Form template engine passes fully; no browser proof any wizard produces a document | 5 unit files + shared fca/letter tests + 3 integration files, all pass |
| Update Opal Docs Register | idea | untouched | Describes an external Excel register; no code should exist | none — no code to test |
| Xero Integration Works | idea | tab-unproven | Financial Dashboard and Payroll Automation both backend-tested, both missing browser/E2E proof of their UI | 7 unit files (74+7) + 6 integration files (70) pass |

## 4. Prompts for the morning

**1. `/opal-fast-change`**
Fix `GET /api/outlook/categories` in `backend/routes.js` (~line 1487): it calls `getValidAccessToken(user)` with no pre-check and the catch-all turns the resulting error into a 500. Add the same pre-check `GET /api/calendar/reconcile` already uses at `routes.js:1058` — return a clean `409` when `!user?.access_token` — then add a test. Files: `backend/routes.js`. Test to pass: a new assertion in `backend/tests/sync.test.js` (or a new `tests/outlook-categories.test.js`) asserting a non-500 response with no Outlook connection.

**2. `/opal-critical`**
Confirm `@tesseract.js-data/eng` is present in the real Azure deployment's `node_modules` (this sandbox cannot run `npm install` to check). If it's genuinely missing there too, add it to `backend/package.json` dependencies. Files: `backend/package.json`. Test to pass: `npx jest tests/onboarding-document-reader.test.js tests/onboarding-document-check.test.js` — 22/22.

**3. `/opal-critical`**
As Owner with a connected Xero account, open an onboarding journey record and walk the payroll-setup panel (`frontend/current/onboarding-journey.js`, `payrollConfigForm`) end to end: config → approve → sync. Separately confirm the Finance tab Dashboard renders real figures. Add a Playwright spec or a dated `docs/qa/BROWSER_QA_RESULTS.md` entry covering both. Files: `frontend/current/onboarding-journey.js`, `frontend/current/finance.js`. Done when a passing E2E spec or QA entry exists for both.

**4. `/opal-feature`**
Open the Onboarding tab's admin package/compliance screens as Owner and walk the Stage 1→2→3 flow (release, invitation, induction, Activate) built in commits `273de15`/`f143965`/`96324d9`. Add a Playwright spec or a dated `docs/qa/BROWSER_QA_RESULTS.md` entry — `e2e/tests/portal.spec.js` currently only covers the basic invite→register→first-login path. Files: `frontend/current/onboarding.js`, `onboarding-journey.js`.

**5. `/opal-feature`**
Open the Resources tab's Library view (`frontend/current/resourcelibrary.js`) as Owner/Admin and as a therapist. Walk upload (including triggering the privacy-override "Upload anyway" checklist), recycle-bin restore, and file versions. Add a Playwright spec alongside `e2e/tests/portal.spec.js`'s flow G, or a dated `docs/qa/BROWSER_QA_RESULTS.md` entry.

## 5. Ideas without a start

All 13 feature folders already existed from previous nights; each was re-verified and rewritten tonight. One line each on why a START.md still exists (i.e. the feature is not yet `proven`):

- **portal-splose-outlook-integration-works** — a real defect with no test.
- **portal-onboarding-workflow** — a real test failure (OCR dependency) plus an unproven admin UI.
- **clinical-resources** — tested but never opened in a browser.
- **inductions** — one of three sub-parts (Induction Playground) is unproven in a browser.
- **professional-development** — one of two CPD systems has no test.
- **automated-reminders** — one sub-part untested in browser, one sub-part not started.
- **employee-personal-page-my-profile-tab** — leave/CPD round trip untested.
- **interactive-assessments** — tested but never opened in a browser.
- **opa-mobile-companion** — tracker tasks still open; the one remaining gap is structurally unprovable from this repo.
- **password-master-document** — not a coding task; no START.md action beyond noting that.
- **report-templates** — tested but never opened in a browser.
- **update-opal-docs-register** — not a coding task; no START.md action beyond noting that.
- **xero-integration-works** — both sub-parts tested but unproven in a browser.

## 6. What changed since last audit

**Nothing.** Develop is sitting at the exact same commit (`15acf0c`) that last night's audit (2026-10-28) already audited — zero commits landed on `develop` in the last 24 hours. Every evidence label in this brief comes from re-running tests and re-checking guards against unchanged code, not from reacting to new commits.

For background only — the last 14 days of history on `backend`/`frontend/current` (50 commits, most already covered by earlier nights' audits), grouped by subsystem:

- **Onboarding** (heaviest activity): `273de15`, `51f585b`, `db8fb6c`, `41e8178`, `f143965`, `96324d9`, `fba7efa`, `f40dbef`, `a968e90`, `74444eb`, `0779da3`, `5eef761`, `34d3803`, `7d8db31`, `f8d3905` — the "production-ready" Stage 2/3 rebuild (portal route, Owner-only activation, safety fixes) plus account/auth hardening alongside it.
- **Resources / Document Library**: `06c6777`, `0195cb3`, `dd958d0`, `896ace1`, `31d5008`, `40d88a6`, `ba9b66d` — the new SharePoint-style Library, its privacy-override UX, and removal of the AI Resource Studio.
- **Calendar / Splose / Outlook sync**: `41f45ed`, `ab75330`, `3ef3965`, `971cac1`, `11aa73f`, `3ca80ad`, `5d48f01`, `d64389c` — sync settings UI, webhook token decryption, Splose review reconciliation.
- **Email transport**: `3f095ce`, `f89352c` — Microsoft Graph mail transport.
- **Dependency/security patches**: `15acf0c`, `0628bda`, `d997b47`, `0c8fa8e`.
- **Test infrastructure**: `73adb13` — email forced off in unit/integration tests.
- **Booking / Travel (no tracker card at all)**: `94dad51`, `58f3fec`, `c86355b`, `ac4912e`, `74d9d91`, `64fca97`, `e213493`, `bd0d982`, `a2e672b`, `136e4fd` (Booking tab — "Make room" block-shortening, Home chip, Book Another Client) and `6a124db`, `26ae223` (Travel & Flights/Maps — desk-work-at-home, place-name retention). This is a significant, actively-developed slice of the product (10+ commits over two weeks) with no corresponding card anywhere in the 13-feature tracker snapshot — worth a tracker card if the team wants nightly coverage of it.

This same "Booking/Travel has no tracker card" observation has been carried forward by previous nights (see `docs/qa/nightly/features/README.md`'s history on this branch); it remains unresolved.

## 7. Technical detail

**Environment:** PostgreSQL was found stopped at session start and started per the runbook (`service postgresql start`). `backend/node_modules` was already installed; no `npm install`/`npm ci` was run.

**Tracker fetch:** `NODE_USE_ENV_PROXY=1 SUPABASE_URL=... node scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json` → 13 features, 19 tasks, 0 decisions.

**Test isolation:** five parallel investigation passes each used their own integration database (`DB_NAME=therapy_scheduler_audit_g1` … `_g5`, one sub-pass used `_g3b`) to avoid corrupting each other's runs, per `.claude/rules/tests.md`'s concurrent-session guidance.

**Could not locate:** "Multi Calendar Rules" (Portal - Splose - Outlook task), "Automated Client Appt Reminders" (24hr client reminder), "Password Master Document", "Update Opal Docs Register" — no matching code anywhere for any of these four.

**Open questions for the team:**
- Is the "Multi Calendar Rules" task still wanted, and what does it mean concretely? No idea/why/what is written for it.
- Is the 24-hour client appointment reminder still wanted, and on what channel (SMS/email/other)?
- Last night's tracker note about "Stage 2's SharePoint-storage gap" appears to be a misattribution — no SharePoint reference exists anywhere in the onboarding code; that description matches the (unrelated) Resource Library feature instead. Worth a human check before it's repeated again.
- Should the Booking and Travel & Flights subsystems (10+ commits over the last two weeks, no tracker card) get their own tracker cards for nightly coverage?

**Process note for whoever reads this next:** this agent's bootstrap checks out a fresh branch from `origin/develop` to read code (per the scheduled task's own instructions), and that checkout's `docs/qa/nightly/` only ever has `README.md` — the dated briefs and feature folders live on `claude/nightly-audit`, which is never merged into `develop`. This agent initially mis-read that as "no prior audit exists" and planned around a 14-day default window, before discovering the real history when it switched to the `claude/nightly-audit` branch to commit. All judgements in this brief and in each STATUS.md were corrected to reflect the true (empty) 1-night window before this brief was finalised. A future run of this audit would avoid the detour by checking `docs/qa/nightly/` on `origin/claude/nightly-audit` (if it exists) rather than on `develop`, for the window calculation specifically — worth folding into `scripts/nightly-audit/PROMPT.md` setup step 5.

**Full detail for every feature, including exact commands, is in `docs/qa/nightly/features/<slug>/STATUS.md`.**

**Write-back to the tracker:** `post-tracker: 13 features posted, 0 already posted tonight, brief posted` — all 13 features' Claude update/next action refreshed, each got one assistant message with its starter prompt, and one activity row per feature plus one workspace-level row. Every per-feature `claude_update`/`next_action` sent is a pure evidence statement with no "window" framing, so the mis-read window above did not affect it. The one workspace-level activity row's summary text does say "first-ever run (14-day window)" — written before the window mistake was caught — which is inaccurate per the correction above; `post-tracker.mjs` has no update path for an already-posted activity row (by design, idempotent per night), so this one sentence in the tracker's workspace activity feed could not be corrected without hand-crafting a PATCH against the tracker, which the hard limits forbid. Flagging it here plainly rather than silently leaving it.
