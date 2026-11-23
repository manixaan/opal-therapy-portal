# Portal - Splose - Outlook | Integration Works

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-22..2026-11-23): **no**
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
- No new migrations this window (last ones remain `089`–`093`, all already applied).

## Guard check
OK — no backend route or permission-surface code changed tonight (zero commits in the window). Every route file still sits behind `requireAuth` plus a role/permission middleware or `denyReadOnly`, re-confirmed by fresh `node --check` + re-grep tonight across all seven route files. `PATCH /api/events/:dbId/notes` remains `requireAuth` + an inline role check + SQL scoped `WHERE id = $1 AND user_id = $2` — self-scoped by design, not a gap. No unguarded route found. No TODO/FIXME found in this subsystem's files.

## Tests run
- unit: 50 files run fresh tonight (calendar/booking/travel/NF2F/Splose-sync/sync-prefs/theme/time-format/rich-notes/block-review, plus `boot-fetch-sharing.test.js`, `static-cache-headers.test.js`, `splose-billing-source.test.js`, and the shared asset-pin guard `assessment-surface-guards.test.js`) — **pass** (954/954 tests). File-set selection varies slightly night to night by design (see Reason below); no regression, all green.
- integration: `block-review.itest.js, calendar-category-colours.itest.js, calendar-local-first.itest.js, event-travel-plan.itest.js, events-sync.itest.js, nf2f-timer.itest.js, splose-connection.itest.js, splose-draft-sync.itest.js, splose-link-ignore.itest.js, sync-settings.itest.js, travel-outlook-sync.itest.js, travel-overrides.itest.js` — **pass** (12 files / 112 tests, re-run fresh tonight)

## Tab / browser proof
docs/qa/BROWSER_QA_RESULTS.md rows E/F/J — dated 2026-08-01, stale (predates the whole 2026-11 window). **Correction tonight**: a plain substring grep for "sync" against `e2e/tests/portal.spec.js` returns 23 hits, but nearly all are false positives — the word `async` contains the substring `sync`. The two genuine Splose-related tests there ("broad Splose data denied; unmapped practitioner fails closed", "Splose write routes are blocked") are RBAC/permission-boundary checks, not proof that the calendar/booking/travel sync workflow itself works. Net finding stands: no functional E2E coverage of this subsystem's actual behaviour.

## Recency
Not touched since the last audit — tonight was the quietest window this audit has seen: **zero commits** landed in `backend/` or `frontend/current/` between 18:13 UTC 2026-11-22 (last audit) and tonight's run. This is the first night since the audit began that this subsystem was not touched at all.

## Open tasks (from the tracker)
- Multi Calendar Rules — todo

## Reason for the label
Code, guards and tests all pass on an unchanged codebase — but the one tracker task (Multi Calendar Rules) is still `todo` and the next_action ("walk the Multi Calendar Rules checklist against the live portal") is still open, and no tab-level browser/E2E proof exists either (see the portal.spec.js correction above). `needs-refinement` is the stricter, correct label given the open human checklist item. Unchanged from last night.

## Disagreement with the tracker
Tracker "idea" stage vs. a very large, heavily tested, production subsystem — the same disagreement as every prior night, now with more evidence behind it.
