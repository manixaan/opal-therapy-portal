# Nightly tracker audit — 2026-10-27

## 1. Status line

**RAN** · 2026-10-27 18:09–19:05 UTC · commit audited `41f45ed` (branch `develop`)

Counts: **needs-refinement: 5 · tab-unproven: 4 · broken: 2 · untouched: 2 · proven: 0 · built-untested: 0** (13 features total)

**Tonight's real window is narrow.** The last brief pushed to this branch was `2026-10-26.md`, auditing develop commit `896ace1`. The true set of commits that became part of `develop` since then (`git log 896ace1..41f45ed`) is **4 real commits plus their merge, all on one card** — Portal - Splose - Outlook: a new Calendar Sync Settings feature (migration 081), an Outlook webhook token-decryption fix, and a Splose auto-sync timer fix. No other feature's files changed. (Earlier in this run, before checking `git log 896ace1..41f45ed` against the actual `claude/nightly-audit` branch history, this audit nearly treated the last 14 days of `develop` commits as "new since last audit" and almost force-pushed a fresh branch over 12 nights of prior audit history. Caught before anything was pushed — see §7.)

Every other feature's STATUS.md was re-verified tonight (its tests re-run, its guard re-checked) and found unchanged from 2026-10-26, except Portal Onboarding Workflow, which gained one new, reproducible test failure (see §2).

## 2. Do this first

1. **`broken`, 11th consecutive night.** `GET /api/outlook/categories` (`backend/routes.js:1487`) still returns a raw `500` instead of a clean response when the calling user isn't connected to Outlook. Unchanged, byte-for-byte, since first reported 2026-10-17 — still no regression test anywhere. → `docs/qa/nightly/features/portal-splose-outlook-integration-works/`
2. **`broken`, new tonight — needs a human to confirm it isn't sandbox noise.** `npx jest tests/onboarding-document-reader.test.js` fails: `@tesseract.js-data/eng` (OCR language data, declared in `package.json`) is missing from this sandbox's `node_modules`. Reproduced twice. No audit since 2026-10-16 has ever reported this, which points to tonight's environment provisioning rather than a code regression — but it needs someone with access to the real deployment to confirm the package is actually present there. → `docs/qa/nightly/features/portal-onboarding-workflow/`
3. **Tracker hygiene (no code), carried forward again.** The "Multi Calendar Rules" checklist item "Confirm the Portal and Splose end up matching in both directions" has had a real, tested implementation since 2026-10-22 but still reads as entirely unstarted in the tracker.
4. **`tab-unproven`, unchanged, still worth a look.** Clinical Resources' new document Library screen (rebuilt 2026-10-22, gained a privacy-override checklist 2026-10-25) still has no browser or E2E proof it renders — Resources is used daily.
5. **`tab-unproven`, unchanged.** Interactive Assessments, Report Templates and Xero's Financial Dashboard all remain solidly built and tested with no browser/E2E proof of the screen itself.

**Worth a look, not urgent — carried forward, still no tracker card:** the "Make room" booking-panel feature (shorten/split a calendar block to fit a new session), first flagged 2026-10-24, still has no tracker card of its own.

## 3. Every feature

| Feature | Tracker stage | Evidence | Reason | Tests run |
|---|---|---|---|---|
| Portal - Splose - Outlook \| Integration Works | idea | **broken** | Same confirmed `/api/outlook/categories` 500, 11th night; new Calendar Sync Settings feature shipped and tested tonight | unit 243/243 · integration 19/19 pass |
| Portal Onboarding Workflow | idea | **broken** | New tonight: OCR language-pack test fails (likely sandbox gap, needs confirmation); Stage 2's SharePoint-storage gap unchanged | unit 653/654 (1 new fail) |
| Clinical resources | idea | tab-unproven | New Library view (2026-10-22) + privacy-override checklist (2026-10-25) still unproven in a browser — unchanged tonight | unit 398/410 pass (12 skipped) |
| Inductions | idea | needs-refinement | Walkthroughs proven by e2e; AI co-author (Induction Playground) built+tested but unproven in a browser; "Splose Inductions" scope unclear — unchanged | unit 223/223 pass |
| Professional Development | idea | needs-refinement | Resource Hub CPD logbook tested and proven; a separate My Profile CPD approve/reject flow has no test — unchanged | integration 33/33 pass (rh2 CPD) |
| Automated Reminders | idea | needs-refinement | Client appt reminders not started at all; Therapist Snapshot built+tested but UI unproven — unchanged | integration 6/6 pass |
| Employee Personal Page (My Profile Tab) | idea | needs-refinement | Most of the tab is proven; the leave/CPD approve-reject round trip has no dedicated test — unchanged | none for the untested path |
| Interactive Assessments | idea | tab-unproven | Tests pass; no e2e/browser proof any wizard produces a document — unchanged | unit 897/897 pass |
| Opa Mobile Companion | idea | needs-refinement | API guarded, tested, AU-region AI governance enforced; needs confirmation a real mobile client calls it — unchanged | unit 41/41 + 10/10 pass |
| Password Master Document | idea | untouched | No code — external document, not a portal feature | none applicable |
| Report Templates | idea | tab-unproven | Tests pass; no e2e/browser proof any of the 3 wizards produces a document — unchanged | unit 218/218 pass |
| Update Opal Docs Register | idea | untouched | No code — external Excel register, not a portal feature | none applicable |
| Xero Integration Works | idea | tab-unproven | Financial Dashboard built+tested, never browser-checked connected; Payroll Automation proven — unchanged | unit 81/81 + integration 63/63 pass |

## 4. Prompts for the morning

**1. `/opal-fast-change`** — Fix the Outlook categories 500 (11th night running).
> Open `backend/routes.js` around line 1487 (`GET /api/outlook/categories`). In the `catch` block, when `err.message` indicates Outlook isn't connected (the error `getValidAccessToken` throws at `routes.js:151`), return a clean `200 { data: [] }` or a `409`, not a `500`. Add a test alongside `backend/tests/outlook-mirror.test.js`. Done means the new test passes and the route no longer 500s for a disconnected user.

**2. `/opal-critical`** — Confirm whether the onboarding OCR test failure is real.
> Run `cd backend && npx jest tests/onboarding-document-reader.test.js`. Confirm whether `@tesseract.js-data/eng` is present in the real deployment's `node_modules` (not just this sandbox). If missing there too, fix the dependency install — don't patch around it in code. If present, this was sandbox-only noise; note that for the next audit so the evidence label can revert.

**3. (tracker housekeeping, no code)** — Tick the "Multi Calendar Rules" checklist item that 2026-10-22's Splose match/link/ignore work already answered, and decide whether "Make room" booking (no tracker card, four nights running now) needs one.

**4. `/opal-feature`** — Prove the Resources Library view and the assessment wizards.
> Open the Resources tab and walk the Library view (folders, recycle bin, privacy-override checklist) end to end as Owner/Admin and therapist; separately, open the FCA, WHODAS or progress-letter wizard and confirm it produces a document. Add a Playwright spec next to `e2e/tests/portal.spec.js`, or a `docs/qa/BROWSER_QA_RESULTS.md` row, for whichever you check. Done means at least one of these screens has a passing e2e/browser proof.

## 5. Ideas without a start

All 13 feature folders already existed on this branch from prior nights; none were created fresh tonight. `portal-splose-outlook-integration-works/START.md` and `portal-onboarding-workflow/STATUS.md`/`START.md` were substantively rewritten tonight (new feature, new test failure). Every other feature's `STATUS.md` gained a short "Re-verified 2026-10-27" note confirming no change; no other `START.md` needed rewriting since no other evidence label changed.

## 6. What changed since last audit

Commit window: `896ace1` (2026-10-26, the commit the last pushed audit covered) through tonight's `41f45ed`, on `develop`. 4 real commits plus their merge, all on one card:

- **Calendar Sync Settings (Portal - Splose - Outlook)** — `11aa73f`: a new per-direction sync model (Outlook↔portal, Splose↔portal, Splose→Outlook) with its own on/off, "sync events from" date and Automatic toggle; Owner-set practice defaults; a previewed "Sync now" that plans before it writes. New: `sync-settings-routes.js`, `sync-preferences.js`, `sync-backfill.js`, migration 081.
- **Outlook webhook token-decryption fix** — `971cac1`/`3ef3965`: the Graph change-notification receiver now decrypts stored OAuth tokens before using them; pushes were silently falling back to the 90-second poll whenever `TOKEN_ENCRYPTION_KEY` was set.
- **Splose auto-sync timer fix** — `ab75330`: a sync-settings reset no longer races with a queued auto-sync nudge into starting a timer that outlives the database pool.

**Still no tracker card, carried forward from 2026-10-24:** the "Make room" booking-panel feature (`frontend/current/travel.js`/`booking-route.css`) — unchanged tonight, still unresolved.

One commit outside this audit's scoped paths (`deploy/`) is not read or acted on by this audit.

## 7. Technical detail

### A near-miss this session, corrected before anything was pushed

This session initially fetched `develop` and treated the last **14 days** of commits as "since the last audit," without first checking what was already on `origin/claude/nightly-audit`. On reaching the delivery step, `git push --force-with-lease` was denied by the harness's own destructive-action guard — which is what caught the mistake. Fetching `origin/claude/nightly-audit` showed 12 nights of prior audit history (2026-10-15 through 2026-10-26) that a force-push from a fresh `develop`-based branch would have destroyed. This session then reset its local branch to `origin/claude/nightly-audit`, recomputed the true change window as `896ace1..41f45ed` (the commits actually new to `develop` since the last pushed audit, not a calendar window), and rewrote tonight's contribution as an addition on top of that history rather than a replacement of it. The lesson for future runs: always fetch and diff against `origin/claude/nightly-audit` itself before computing "since last audit," not just the newest dated file visible from a `develop`-based checkout — the two can disagree when a commit's author date and the date it actually reached `develop` differ (as happened here: three of tonight's "sync-settings" commits carry Oct 26 timestamps but had not yet reached `develop` when the Oct 26 audit ran, only merging in via tonight's `41f45ed`).

### Commands run tonight

```
NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json
  → fetch-tracker: 13 features, 19 tasks -> /tmp/tracker.json

service postgresql status → 16/main (port 5432): online
ls backend/node_modules/.bin/jest → present

Unit tests, run as targeted batches per feature (no complete suite — tonight
is not Sunday UTC): ~90 files across onboarding, resources, learning/
induction, assessments (FCA/WHODAS/letters), splose/outlook/sync, profile,
templates, finance/Xero/payroll. All passed except
tests/onboarding-document-reader.test.js (1 test, missing
@tesseract.js-data/eng — see §2).

Integration tests (DB_NAME=therapy_scheduler_audit, DB_PASSWORD=audit,
--runInBand) against: sync-settings, calendar-local-first, resource-hub-r2,
accounting-phase2, accounting-routes, finance-routes, invoicing,
onboarding-payroll-xero, snapshot. All passed (19+33+63+6 = 121 tests).
onboarding's own 8 integration files were not re-run tonight (see that
feature's folder) — they last passed 2026-10-26 and are unchanged.
```

### Could not verify

- Whether `@tesseract.js-data/eng` is present in the real deployment — needs a human with Azure access.
- Whether the real native mobile client successfully calls `/api/mobile/*` (Opa Mobile Companion) — outside this repository.
- Current rendering of any tab marked `tab-unproven` — this audit does not drive a browser.
- Whether the environmental `readonly-and-hardening.itest.js` root/chmod artifact (reported by every audit since 2026-10-16, per that history) still reproduces — not re-run tonight.

### Tracker write-back

```
NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json
  → post-tracker: 13 features posted, 0 already posted tonight, brief posted
```

Note: an earlier writeback was posted tonight before this session caught the
window-calculation mistake above; it used `proven`/`built-untested` labels
for Professional Development and Employee Personal Page that disagreed with
this branch's established history. A corrected writeback was posted
afterward with `needs-refinement` for both, consistent with every prior
night — see the `claude_update`/`next_action` fields now live on those two
cards, which reflect the correction, not the first pass.
