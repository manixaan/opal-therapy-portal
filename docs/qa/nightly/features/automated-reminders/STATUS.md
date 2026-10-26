# Automated Reminders

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement** (bundles two unrelated deliverables at very different maturity)
- Addressed in change window (since last audit, 2026-10-24): no — no commit this window touched `snapshot-routes.js` or `reports.js`
- Created (code exists): yes for Therapist Snapshot; no for client appointment reminders

## Therapist Snapshot — mixed
This task actually spans two pieces of code, not one file:
- **Personal reminders/tasks API**: `backend/snapshot-routes.js`, mounted at `/api/snapshot/*`. Guard: `router.use('/api/snapshot', requireAuth)` only — the file's header comment explicitly documents strict `user_id` scoping for ALL roles, owner included ("personal productivity data, not practice data") — self-scoped by design, not a missing guard.
- **The actual "Daily & Weekly Snapshot" panel** (utilisation/billable-hours progress, travel summary, idle gaps, smart recommendations — this is what the tracker notes mean by "weekly utilisation index" and "daily sessions and where to go") lives in `frontend/current/reports.js`, opened via the header's report icon (`openReportPanel('daily'|'weekly')`). It computes its metrics client-side from `/api/events` and existing billing/travel data, then layers in the personal reminders/tasks from `/api/snapshot/*`.
- Tests: `tests/integration/snapshot.itest.js` (6 tests) — **pass** (re-run tonight); `tests/frontend-stage3-guards.test.js` (289 tests, asset-pin + structural guards covering `reports.js`) — **pass** (re-run tonight).
- **No E2E/browser proof exists for the report panel itself** (the utilisation index / travel summary / idle-gaps display). No `e2e/tests/*.spec.js` match, no `docs/qa/BROWSER_QA_RESULTS.md` entry.
- No TODO/FIXME found in `snapshot-routes.js`.

## Automated Client Appt Reminders — untouched
**Confirmed: nothing has been built for this at all.** Specifically checked and found absent:
- No cron/scheduling infrastructure anywhere in the codebase (no `node-cron` dependency, no `setInterval`-based job runner, nothing in `package.json`).
- No SMS provider integration (no Twilio or similar) — only `nodemailer` exists, for unrelated transactional email.
- No "reminded"/"reminder_sent" flag or similar column anywhere in `database.js` or `backend/migrations/*.sql`.
- The only "reminder" code in the repo is the unrelated personal `snapshot_reminders` table used by `mobile-routes.js` and `snapshot-routes.js` (to-do items a user sets for themselves), not client-facing appointment reminders.

## Open tasks from the tracker
"Automated Client Appt Reminders" (todo, detailed checklist — channel choice, confirm-step design, configurable lead time, scheduler, audit logging, safe testing) — entirely unstarted. "Therapist Snapshot" (todo, checklist partially done — "find where the snapshot lives" and "create minimise function" are checked; the rest, including the utilisation-index formula decision, is open).

## Commits in window that touched it
None.

## Disagreement
None against tracker stage. The tracker's own next_action already separates the two pieces correctly: decide if the 24-hour client reminder is still wanted and on what channel, then build the scheduled job — nothing to disagree with there.
