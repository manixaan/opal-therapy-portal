# Nightly tracker audit — 2026-10-30

## 1. Status line

**RAN** · 2026-10-30 18:12–18:45 UTC · commit audited: `338f5dc` (branch `develop`) · last audit: 2026-10-29, commit `15acf0c` · tonight's real window: **5 commits**, all pushed earlier today (Perth time).

Counts across the tracker's 13 features: **broken 2** · **tab-unproven 5** (one of them mixed, 2 of 3 sub-parts proven) · **needs-refinement 4** (one of them mixed) · **untouched 2** · proven 0 · built-untested 0. Every feature was independently re-verified from scratch tonight — locate, guard check, and every targeted test re-run, not carried over from last night's numbers.

One housekeeping note: PostgreSQL was not running when this audit started tonight; it was started (`service postgresql start`) per the agent prompt's own instructions before any integration test ran. No other setup problem.

## 2. Do this first

1. **[broken]** `GET /api/outlook/categories` still returns a 500, not a clean error, when a user hasn't connected Outlook (`backend/routes.js:1487` calls `getValidAccessToken(user)` with no pre-check). No test covers it. — *Portal - Splose - Outlook | Integration Works*
2. **[broken]** Returned-document OCR reading fails on a missing `@tesseract.js-data/eng` package in this sandbox (declared correctly in `package.json`/`package-lock.json`, just not installed here) — must be confirmed present in the real Azure deployment. — *Portal Onboarding Workflow*
3. **[tab-unproven, daily tab]** The rebuilt document Library view in the Resources tab (folders, recycle bin, file versions, the privacy-override "Upload anyway" checklist) is fully tested (566 tests passing) but has never been opened in a browser. — *Clinical resources*
4. **[tab-unproven, daily tab]** FCA, WHODAS and Progress Letter wizards all pass fully and are guarded correctly, but no browser or E2E check confirms any of them actually produces a document end to end. — *Interactive Assessments* (shares its underlying engine with *Report Templates*, same gap there)
5. **[tab-unproven]** The Induction Playground (AI co-author) has no browser/E2E proof; Portal Inductions and Splose Inductions are already proven and need no further code. — *Inductions*

**No tracker-vs-evidence disagreements tonight.** Every one of the 9 independent re-checks agreed with the tracker's current `claude_update`/`next_action` text.

**Standing issue, not feature-specific:** all 13 tracker cards are still staged `idea`. This is unchanged for two weeks running and is a tracker-hygiene gap across the whole board, not a defect in any one card.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Portal - Splose - Outlook \| Integration Works | idea | broken | `/api/outlook/categories` 500s with no Outlook connection; no test; "Multi Calendar Rules" has no code anywhere | 7 unit suites (101) + 1 integration suite (12) pass |
| Portal Onboarding Workflow | idea | broken | OCR/tesseract dependency missing in this sandbox (1 test fails); everything else (871 tests) is tab-unproven — admin package/compliance UI has no browser proof | 25+2 unit suites (871 pass, 1 fail) + 10 integration suites (218) pass |
| Clinical resources | idea | tab-unproven | Library view + privacy checklist fully tested, never opened in a browser | 12 unit files (398 pass, 12 skipped) + 7 integration files (168) pass |
| Inductions | idea | tab-unproven (2/3 sub-parts proven) | Induction Playground untested in browser; Portal & Splose Inductions proven by e2e + a dedicated integration test | 6 unit suites (133) + 7 integration suites (128) pass |
| Professional Development | idea | needs-refinement | Two unrelated "CPD" systems; the My Profile approve/reject round trip still has no test | 2 unit files (46) pass; Resource Hub CPD integration (33) passes; 0 tests for the untested system |
| Automated Reminders | idea | needs-refinement (mixed) | Therapist Snapshot is tab-unproven; the 24hr client reminder has no code at all (re-confirmed with a broader cron/SMS/email-provider grep tonight) | 1 unit file (289) + 1 integration file (6) pass |
| Employee Personal Page (My Profile Tab) | idea | needs-refinement | Credentials/documents proven indirectly; leave+CPD round trip still untested | several unit/integration files pass; 1 unrelated integration test fails (environment artifact, see Technical detail) |
| Interactive Assessments | idea | tab-unproven | FCA/WHODAS/letter all pass fully and are guarded; no browser/E2E proof any wizard produces a document | 20 unit files (1050) + 5 integration files (201) pass |
| Opa Mobile Companion | idea | needs-refinement | Mobile API and case-note approval-on-edit guarded and fully tested; **addressed this window** — nothing in this repo can confirm the real mobile client calls it correctly | 166 unit + 10 integration pass |
| Password Master Document | idea | untouched | Describes an external OneDrive document; no code should exist | none — no code to test |
| Report Templates | idea | tab-unproven | FCA/Letter/Client Agreement Form template engine passes fully; no browser proof any wizard produces a document | 20 unit files (1050) + 5 integration files (201) pass |
| Update Opal Docs Register | idea | untouched | Describes an external Excel register; no code should exist | none — no code to test |
| Xero Integration Works | idea | tab-unproven | Financial Dashboard and Payroll Automation both backend-tested (144/144), both still missing browser/E2E proof of their UI | 7 unit files (81) + 3 integration batches (63) pass |

## 4. Prompts for the morning

**1. `/opal-fast-change`** — fix `GET /api/outlook/categories` to return a clean error (not a 500) when Outlook isn't connected, and add a test. Files: `backend/routes.js:1487` (route), `backend/routes.js` (the `getValidAccessToken` helper it calls, ~line 151). Done when: a new unit/integration test asserts a clean 4xx with no Outlook connection, and `tests/sync*.test.js` + `tests/integration/sync-settings.itest.js` still pass. Full brief: `docs/qa/nightly/features/portal-splose-outlook-integration-works/START.md`.

**2. `/opal-critical`** — confirm `@tesseract.js-data/eng` is actually installed in the real Azure deployment's `node_modules` (it's correctly declared in `backend/package.json:28` and `package-lock.json`, just missing from this sandbox); if it genuinely isn't there in production, install it. Done when: `npx jest tests/onboarding-document-reader.test.js tests/onboarding-document-check.test.js` passes 22/22 in that environment. Full brief: `docs/qa/nightly/features/portal-onboarding-workflow/START.md`.

**3. `/opal-feature`** — open the Resources tab's Library view (folders, recycle bin, versions, privacy-override checklist) as Owner/Admin and as a therapist, walk it end to end, and add a Playwright spec or a dated `docs/qa/BROWSER_QA_RESULTS.md` entry. Done when: that proof exists and the evidence label can move to `proven`. Full brief: `docs/qa/nightly/features/clinical-resources/START.md`.

**4. `/opal-critical`** — open each of the FCA, WHODAS and Progress Letter wizards in a browser as a therapist with clinical data, confirm each produces a real document, and add E2E/browser-QA proof for all three (this covers both *Interactive Assessments* and *Report Templates*, which share the same engine). Done when: a browser or E2E check confirms each wizard completes. Full briefs: `docs/qa/nightly/features/interactive-assessments/START.md` and `docs/qa/nightly/features/report-templates/START.md`.

**5. `/opal-feature`** — open the Induction Playground (AI co-author) in a browser as Owner and confirm it works; Portal Inductions and Splose Inductions need no further code. Done when: a browser/E2E check or dated QA entry covers the Playground specifically. Full brief: `docs/qa/nightly/features/inductions/START.md`.

## 5. Ideas without a start

- **opa-mobile-companion** — two real fixes landed tonight (mobile-diary de-duplication/overlap-read, and voiding case-note approval on a real edit). `START.md`'s "Start here" now points at the tracker's own device-test checklist as the concrete next step, since the code side is already covered by new tests.
- **employee-personal-page-my-profile-tab** — reclassified from `/opal-feature` to `/opal-critical`: the leave/CPD approve-reject gap runs through a non-standard inline `canApprove` check on employment-sensitive data, which warrants the stricter skill.
- **professional-development** — same reclassification to `/opal-critical`, for the same shared `profile-routes.js` approval code.
- **portal-onboarding-workflow** — `START.md` gained a third, non-blocking note: Stage 2's "store documents in SharePoint" checklist item has no code anywhere — it's genuinely unbuilt, not merely unproven, and the team should decide if it's still wanted.

## 6. What changed since last audit

Five commits landed between last night's audit (`15acf0c`) and tonight's (`338f5dc`):

- **Travel & traffic alerts** (`08da79d`) — a substantial new feature: drive-time traffic priced at each leg's own departure time, a right-click "Not driving this" override, and traffic alerts with a "Make room" booking-planner action. Files: `backend/routes.js`, `frontend/current/travel.js`, `frontend/current/travel-alerts.js`/`.css`, plus new tests. **No tracker card covers this subsystem** — confirmed working tonight (94/94 unit, 4/4 integration) but untracked.
- **Travel-traffic test fix** (`338f5dc`) — test-only; fixed two tests that built "today" into their fixtures and so failed every Perth afternoon, which had stopped the staging CI gate earlier today. Confirmed passing now.
- **Mobile diary fix** (`e1af24e`) — the phone diary now matches the portal calendar: de-dupes Outlook copies of portal travel legs, reads events that touch a day (not just ones contained within it), flags all-day events correctly, and fixes the first drive's starting address. Part of *Opa Mobile Companion*'s "Calendar View" task.
- **Case-note approval-on-edit** (`a56173c`) and its **laptop-UI revert** (`dc5dbc4`) — editing an approved case note (phone or laptop) now voids the approval and reopens the linked AI-governance review record, so the record never attests to text the therapist didn't actually approve; the laptop-only "approved" banner was reverted (CI had stopped its staging deploy) but the underlying portal/mobile rule is unchanged. Part of *Opa Mobile Companion*'s "Case Noting" task.

Only **Opa Mobile Companion** has a tracker card among these; the travel/traffic-alerts work has none.

## 7. Technical detail

**Commands run** (all from `backend/`, each audit worker used its own `DB_NAME` suffix — `therapy_scheduler_auditg1` through `g9` — to avoid colliding with the others): targeted `npx jest tests/<file>.test.js` for every located unit test file per feature, and `DB_NAME=... DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/<file>.itest.js --runInBand` for every located integration file. No complete suite (`npm test`, `npm run test:integration`, E2E) was run — today is Friday, not the Sunday UTC weekly deep-run window.

**One test failure observed, judged an environment artifact, not a regression:** `tests/integration/readonly-and-hardening.itest.js` (part of the My Profile / Professional Development check) has one case expecting `chmod 0o000` to block a write; it doesn't, because this sandbox runs as root. This is unrelated to the leave/CPD testing gap reported above and is not evidence of a backend defect — flagging it so nobody chases it as a real failure.

**Not located anywhere in the codebase:** a 24-hour client appointment reminder (no route, no cron/scheduler, no SMS/email provider — checked `node-cron`/`node-schedule`/`agenda`/`bullmq`/`twilio`/`sendgrid` across backend and frontend, and `package.json`); "Multi Calendar Rules" (zero hits for calendar-rules phrasing beyond an unrelated comment); Stage 2's SharePoint document storage for onboarding (no code).

**Open questions for the team:**
- Is the 24-hour client appointment reminder still wanted, and on what channel (SMS/email/push)? Nothing has been started.
- Is "Multi Calendar Rules" still wanted as part of the Outlook integration? No code exists.
- Is Stage 2's "store documents in SharePoint" onboarding requirement still wanted, or superseded by the existing document storage?
- Should the travel/traffic-alerts feature (built today, working, 98 tests passing) get its own tracker card, since it currently has none?

Write-back to the Development Manager tracker and the git delivery steps follow this brief; see the session log for their output.
