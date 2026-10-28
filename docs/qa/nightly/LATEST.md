# Nightly tracker audit — 2026-10-28

## 1. Status line

**RAN** · 2026-10-28 18:11–18:29 UTC · commit audited `15acf0c` (branch `develop`)

Counts: **needs-refinement: 5 · tab-unproven: 4 · broken: 2 · untouched: 2 · proven: 0 · built-untested: 0** (13 features total)

**Tonight's real window is narrow again.** The last brief pushed to this branch was `2026-10-27.md`, auditing develop commit `41f45ed`. The commits that actually became part of `develop` since then (`git log 41f45ed..15acf0c`) are **3 feature commits plus 1 merge plus 1 dependency patch**, none touching any of this tracker's 13 cards: a travel "desk work" rule (where a non-face-to-face/report block happens), a place-names fix for the address autocomplete (a picked school/hospital/day-program keeps its name, not just its street address), and a lockfile-only `qs`/`express` security patch. See §6.

Every feature's STATUS.md was re-verified tonight (its tests re-run, its guard re-checked) against this same narrow window. Nothing changed evidence-wise: the two `broken` cards are still broken (one 12th night running, one 2nd), and every other label is unchanged from 2026-10-27.

## 2. Do this first

1. **`broken`, 12th consecutive night.** `GET /api/outlook/categories` (`backend/routes.js:1487`) still returns a raw `500` instead of a clean response when the calling user isn't connected to Outlook. Unchanged, byte-for-byte, since first reported 2026-10-17 — still no regression test anywhere. → `docs/qa/nightly/features/portal-splose-outlook-integration-works/`
2. **`broken`, 2nd consecutive night — still needs a human to confirm it isn't sandbox noise.** `npx jest tests/onboarding-document-reader.test.js` fails again tonight with the identical error: `@tesseract.js-data/eng` (OCR language data, declared in `package.json`) is missing from this sandbox's `node_modules`. Reproduced again, same as 2026-10-27. No audit before 2026-10-27 ever reported this. It still needs someone with access to the real deployment to confirm the package is actually present there before this can be treated as either resolved sandbox noise or a real production gap. → `docs/qa/nightly/features/portal-onboarding-workflow/`
3. **Tracker hygiene (no code), carried forward again.** The "Multi Calendar Rules" checklist item "Confirm the Portal and Splose end up matching in both directions" has had a real, tested implementation since 2026-10-22 but still reads as entirely unstarted in the tracker.
4. **`tab-unproven`, unchanged, still worth a look.** Clinical Resources' document Library screen (rebuilt 2026-10-22, gained a privacy-override checklist 2026-10-25) still has no browser or E2E proof it renders — Resources is used daily.
5. **`tab-unproven`, unchanged.** Interactive Assessments, Report Templates and Xero's Financial Dashboard all remain solidly built and tested with no browser/E2E proof of the screen itself.

**Worth a look, not urgent — carried forward, still no tracker card:** the travel/booking panel (`frontend/current/travel.js`) keeps growing real, tested functionality with nowhere to track it — the "Make room" booking feature (first flagged 2026-10-24) and now a "desk work" location rule (new tonight). Separately, tonight's place-names autocomplete fix (`backend/maps-routes.js`, `backend/client-locations-db.js`) touches address entry used across Onboarding, Client Locations and Travel — also has no tracker card.

## 3. Every feature

| Feature | Tracker stage | Evidence | Reason | Tests run |
|---|---|---|---|---|
| Portal - Splose - Outlook \| Integration Works | idea | **broken** | Same confirmed `/api/outlook/categories` 500, 12th night; unchanged tonight — no commit in window touched this feature | unit 243/243 · integration 172/172 pass (shared batch) |
| Portal Onboarding Workflow | idea | **broken** | OCR language-pack test fails again (2nd night, still unconfirmed); Stage 2's SharePoint-storage gap unchanged | unit 653/654 (1 fail, same as last night) · integration 198/198 pass |
| Clinical resources | idea | tab-unproven | Library view + privacy-override checklist still unproven in a browser — unchanged tonight | unit 1597/1609 pass (12 skipped) · integration 170/171 (1 known sandbox artifact) |
| Inductions | idea | needs-refinement | Walkthroughs proven by e2e; AI co-author (Induction Playground) built+tested but unproven in a browser; "Splose Inductions" scope unclear — unchanged | unit + integration 152/152 pass (shared batch) |
| Professional Development | idea | needs-refinement | Resource Hub CPD logbook tested and proven; a separate My Profile CPD approve/reject flow has no test — unchanged | integration 172/172 pass (shared batch, includes rh2 CPD) |
| Automated Reminders | idea | needs-refinement | Client appt reminders not started at all; Therapist Snapshot built+tested but UI unproven — unchanged | integration 170/171 pass (shared batch) |
| Employee Personal Page (My Profile Tab) | idea | needs-refinement | Most of the tab is proven; the leave/CPD approve-reject round trip has no dedicated test — unchanged | unit pass · integration 170/171 (1 known sandbox artifact) |
| Interactive Assessments | idea | tab-unproven | Tests pass; no e2e/browser proof any wizard produces a document — unchanged | unit + integration 152/152 pass (shared batch) |
| Opa Mobile Companion | idea | needs-refinement | API guarded, tested, AU-region AI governance enforced; needs confirmation a real mobile client calls it — unchanged | unit + integration 152/152 pass (shared batch) |
| Password Master Document | idea | untouched | No code — external document, not a portal feature | none applicable |
| Report Templates | idea | tab-unproven | Tests pass; no e2e/browser proof any of the 3 wizards produces a document — unchanged | unit 569/569 · integration 172/172 pass (shared batch) |
| Update Opal Docs Register | idea | untouched | No code — external Excel register, not a portal feature | none applicable |
| Xero Integration Works | idea | tab-unproven | Financial Dashboard built+tested, never browser-checked connected; Payroll Automation proven — unchanged | unit 77/77 · integration 63/63 pass |

## 4. Prompts for the morning

**1. `/opal-fast-change`** — Fix the Outlook categories 500 (12th night running).
> Open `backend/routes.js` around line 1487 (`GET /api/outlook/categories`). In the `catch` block, when `err.message` indicates Outlook isn't connected (the error `getValidAccessToken` throws at `routes.js:151`), return a clean `200 { data: [] }` or a `409`, not a `500`. Add a test alongside `backend/tests/outlook-mirror.test.js`. Done means the new test passes and the route no longer 500s for a disconnected user.

**2. `/opal-critical`** — Confirm whether the onboarding OCR test failure is real (2nd night asking).
> Run `cd backend && npx jest tests/onboarding-document-reader.test.js`. Confirm whether `@tesseract.js-data/eng` is present in the real deployment's `node_modules` (not just this sandbox). If missing there too, fix the dependency install — don't patch around it in code. If present, this was sandbox-only noise; note that for the next audit so the evidence label can revert to `needs-refinement`.

**3. (tracker housekeeping, no code)** — Tick the "Multi Calendar Rules" checklist item that 2026-10-22's Splose match/link/ignore work already answered, and decide whether the travel/booking panel (no tracker card, five nights running now across two separate shipped features) needs one of its own.

**4. `/opal-feature`** — Prove the Resources Library view and the assessment wizards.
> Open the Resources tab and walk the Library view (folders, recycle bin, privacy-override checklist) end to end as Owner/Admin and therapist; separately, open the FCA, WHODAS or progress-letter wizard and confirm it produces a document. Add a Playwright spec next to `e2e/tests/portal.spec.js`, or a `docs/qa/BROWSER_QA_RESULTS.md` row, for whichever you check. Done means at least one of these screens has a passing e2e/browser proof.

## 5. Ideas without a start

All 13 feature folders already existed on this branch from prior nights; none were created fresh tonight. No `START.md` needed a substantive rewrite tonight — every evidence label is unchanged from 2026-10-27 — but `portal-splose-outlook-integration-works/START.md` and `portal-onboarding-workflow/STATUS.md` had their "Nth consecutive night" counters corrected (12th and 2nd respectively), and `portal-splose-outlook-integration-works/STATUS.md` had a stale line-number reference fixed (`routes.js:1466` → `:1487`, re-confirmed against tonight's file). Every other feature's `STATUS.md` gained a short "Re-verified 2026-10-28" note confirming no change.

## 6. What changed since last audit

Commit window: `41f45ed` (2026-10-27, the commit the last pushed audit covered) through tonight's `15acf0c`, on `develop`. 3 feature commits plus a merge plus a dependency patch, **none on any of this tracker's 13 cards**:

- **Travel desk work** (`6a124db`, merged via `e84dca7`) — a non-face-to-face/report block with no address of its own ("desk work") now has a defined home: at the day's base if the drive fits in the gap, where the therapist already is if there's no time to get home, or an explicit per-block choice (`travel.desk`: `'home'` | `'here'`). `PATCH /api/events/:id/travel` (`backend/routes.js`) gained a `desk` field (unrelated to the Outlook-categories route above it in the same file — confirmed by reading the diff). New `backend/tests/travel-physical-route.test.js` (126 tests), an addition to `tests/integration/event-travel-plan.itest.js`, and a `tests/assessment-surface-guards.test.js` pin-guard update for `frontend/current/travel.js`'s own version bump — all pass.
- **Place names in the address picker** (`26ae223`) — picking a named place (school, hospital, day program) from autocomplete now keeps its name in front of the street address, instead of losing it to Google's Place Details response. Touches `backend/client-locations-db.js`, `backend/maps-routes.js`, `frontend/current/places-autocomplete.js` (pin bumped 1→2, confirmed via `node scripts/check-asset-pins.js`). New assertions in `tests/maps-autocomplete-routes.test.js` and `tests/integration/client-locations.itest.js` — all pass.
- **Dependency patch** (`15acf0c`) — `qs`/`express` lockfile-only bump for a moderate DoS advisory (GHSA-6pq8-jhm2-2vcw) that was blocking the staging deploy's CI audit. No application code changed.

**Still no tracker card, carried forward from 2026-10-24 (and growing):** the travel/booking panel (`frontend/current/travel.js`, `booking-route.css`) — the "Make room" feature, now joined by tonight's desk-work rule. Also new tonight, also no tracker card: the place-names autocomplete fix above, since address entry spans Onboarding, Client Locations and Travel rather than any single tracked feature.

One commit outside this audit's scoped paths (none tonight — all 3 feature commits are in `backend`/`frontend/current`) and the dependency-only commit (`backend/package-lock.json`) are read for this section but not acted on further.

## 7. Technical detail

### Commands run tonight

```
NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json
  → fetch-tracker: 13 features, 19 tasks -> /tmp/tracker.json

service postgresql status → down; service postgresql start → 16/main (port 5432): online
ls backend/node_modules/.bin/jest → present
ls backend/node_modules/@tesseract.js-data/ → no such directory (see §2 item 2)

git fetch origin develop; git fetch origin claude/nightly-audit
git checkout -B nightly-audit-work origin/develop
git checkout origin/claude/nightly-audit -- docs/qa/nightly/   (brought forward 12 nights of prior audit history before computing anything, per 2026-10-27's own technical-detail note)
git log 41f45ed..origin/develop --stat -- backend frontend/current   (computed tonight's true window)

Unit tests, run as targeted batches per feature (no complete suite — tonight
is not Sunday UTC): resources/profile/learning/assessments/mobile batch
(32 suites, 1597 passed, 12 skipped), full onboarding-*.test.js (27 suites,
653/654, same known tesseract failure), splose/outlook/sync batch (17 suites,
243/243), report-templates batch (14 suites, 569/569), xero/finance batch
(6 suites, 77/77), and tonight's own untracked-subsystem files
(maps-autocomplete-routes, travel-physical-route, smart-booking-route — 3
suites, 183/183).

Integration tests (DB_NAME=therapy_scheduler_audit{,2,3,4,5,6},
DB_PASSWORD=audit, --runInBand, one database per concurrent batch):
batch 1 (snapshot, resources×6, readonly-and-hardening, credential-scans,
documents — 170/171, same known root/chmod artifact), batch 2 (learning-admin,
learning, onboarding-induction, induction-assistant, assessments, whodas,
case-note×2 — 152/152), batch 3 (sync-settings, calendar-local-first,
resource-hub-r2, fca-reports, progress-note-letters, templates — 172/172),
batch 4 (finance-routes, accounting-routes, accounting-phase2, invoicing,
onboarding-payroll-xero — 63/63), batch 5 (the 7 onboarding-*.itest.js files
not re-run on 2026-10-27 — 198/198), and tonight's own untracked-subsystem
files (client-locations, event-travel-plan — 11/11).

node scripts/check-asset-pins.js → "Every pin matches the shell this commit
would ship."
```

### Could not verify

- Whether `@tesseract.js-data/eng` is present in the real deployment — needs a human with Azure access (2nd night asking).
- Whether the real native mobile client successfully calls `/api/mobile/*` (Opa Mobile Companion) — outside this repository.
- Current rendering of any tab marked `tab-unproven` — this audit does not drive a browser.
- Whether the environmental `readonly-and-hardening.itest.js` root/chmod artifact (reported by every audit since 2026-10-16) still reproduces under a non-root runner — this sandbox runs as root (`uid=0`) every night, so it cannot be ruled out from here.

### Tracker write-back

```
NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json
  → post-tracker: 13 features posted, 0 already posted tonight, brief posted
```
