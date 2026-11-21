# Portal - Splose - Outlook | Integration Works

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-20..2026-11-21): **yes — heavily**
- Created (any located code): **yes**

## Located files
- backend/calendar-routes.js
- backend/nf2f-routes.js
- backend/travel-sync-routes.js
- backend/splose-sync-routes.js
- backend/sync-settings-routes.js
- backend/splose-link-routes.js
- backend/block-review-routes.js
- `PATCH /api/events/:dbId/notes` in backend/routes.js
- backend/travel-outlook-sync.js, backend/sync-preferences.js, backend/splose-api.js, backend/rich-notes.js, backend/block-review.js
- backend/billing/{calendar-travel-minutes,day-route,route-facts,travel-billing,nf2f-timer,trips}.js (travel/route-planning logic this subsystem's UI consumes — not the invoicing use of the same billing engine, which the Xero Integration Works folder covers separately)
- frontend: travel.js/.css, booking-route.js/.css, nf2f.js/.css, splose-sync.js/.css, sync-settings.js, block-review.js/.css, and the calendar tab block in mockup_v3.html
- Migrations touched this window: `089_nf2f_untimed_resolution.sql`, `090_calendar_travel_minutes.sql` (applied cleanly inside the integration suite's own isolated schema setup; not run as a standalone migration by this audit)

## Guard check
OK — every route file sits behind `requireAuth` plus a role/permission middleware or `denyReadOnly`, re-confirmed tonight across all seven route files. `PATCH /api/events/:dbId/notes` is `requireAuth` + an inline role check + SQL scoped `WHERE id = $1 AND user_id = $2` — self-scoped by design, not a gap. No unguarded route found. `node --check` clean on all 17 located backend files.

## Tests run
- unit: 63 files run in 5 batches — **pass** (2,290/2,290 tests; calendar rendering/a11y/gestures, booking, travel, NF2F, Splose sync/match/poller/credentials, sync preferences/backfill/safety, theme/time-format guards, rich-notes, block-review)
- integration: 15 files — **pass** (133/133 tests, including fresh application of all 92 migrations). First two attempts against the shared `DB_NAME=therapy_scheduler_audit` hit `deadlock detected` on `TRUNCATE` across all 13 suites — a sibling audit worker (the Xero-feature fork) was running its own integration suite against that same database name concurrently. This is a cross-process DB collision, not a code defect. Re-run against an isolated database name passed cleanly. **Flagged in the brief's Technical detail: tonight's bootstrap should give each verification worker its own `DB_NAME` suffix.**

## Tab / browser proof
docs/qa/BROWSER_QA_RESULTS.md rows E/F/J — dated 2026-08-01, stale (predates the whole 2026-11 window). `e2e/tests/portal.spec.js` has zero calendar/booking/travel/sync references. No fresh browser/E2E proof added tonight.

## Recency
**Heavily addressed tonight.** ~70 of the 77 commits that landed in `backend/` and `frontend/current/` since the last audit (18:52 UTC 2026-11-20) touch this subsystem: calendar a11y/gesture/rendering polish, the booking panel, travel-leg display and routing, the NF2F timer, a redesigned one-button Sync popup with a "To check" outside-events tab, and a security fix escaping Outlook event text in calendar tiles/panel. Two of tonight's commits (`9606c4c`, `175cee5`) re-pin three guard tests after intentional UI changes — all still passing. Unit test count rose from 456 (19 files) to 2,290 (63 files); integration rose from 126 (12 files) to 133 (15 files) — all green, no regression.

## Open tasks (from the tracker)
- Multi Calendar Rules — todo

## Reason for the label
Code, guards and a now much larger test suite all pass, and tonight's large landing is clean — but the one tracker task (Multi Calendar Rules) is still `todo` and the next_action ("walk the Multi Calendar Rules checklist against the live portal") is still open, and no tab-level browser/E2E proof exists either. `needs-refinement` is the stricter, correct label given the open human checklist item.

## Disagreement with the tracker
Tracker "idea" stage vs. a very large, heavily tested, production subsystem that just grew substantially again tonight (~70 more commits, ~1,840 more passing unit tests than last night's snapshot) — the same disagreement as every prior night, now with more evidence behind it.
