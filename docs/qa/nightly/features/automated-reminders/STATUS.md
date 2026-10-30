# Automated Reminders

- Tracker stage: idea · Tracker environment: none
- Evidence label: **needs-refinement** (mixed — Therapist Snapshot sub-part is `tab-unproven`, Automated Client Appt Reminders sub-part is `untouched`; see breakdown)
- Addressed since the last audit (window `15acf0c`..`338f5dc`, 5 commits): no.
- Created (any located code): partially — Therapist Snapshot exists and is built/guarded/tested; the 24-hour client appointment reminder does not exist anywhere in the codebase.

## Located

- **Therapist Snapshot:** `backend/snapshot-routes.js` (mounted at `backend/server.js:586`, `app.use('/', require('./snapshot-routes'))`); frontend lives in `frontend/current/reports.js` (per its own header comment: "the Snapshot Day V2 unified reminder/task list").
- **Automated Client Appt Reminders (24hr pre-appointment reminder to clients):** not found. Re-ran a broad search tonight (not just the narrow terms used before): `reminder`, `cron`, `node-cron`, `node_schedule`, `agenda(`, `bullmq`, `twilio`, `sendgrid` across `backend/**/*.js` and `frontend/current/**/*.js`, plus `backend/package.json` dependencies. Every "reminder" hit is one of: credential/onboarding expiry reminders (`credential-reminder.js`, `onboarding-*`), the staff's own personal to-do reminders in `snapshot_reminders` (`snapshot-routes.js`, `reports.js`, `mobile-routes.js`), case-note completion reminders (`app-routes.js: checkCaseNoteReminders`), or a bare comment in `travel.js:2773` ("Client reminders around leave come later"). `email.js` mentions SendGrid only in a comment listing possible SMTP bridges — no SDK, no credentialed client, no scheduled job. No `node-cron`/`node-schedule`/`agenda`/`bullmq`/`twilio`/`sendgrid` package or scheduled-job file exists anywhere in `backend/`. Nothing sends an automated reminder to an NDIS client ahead of their appointment.

## Guard check

`snapshot-routes.js:31` — `router.use('/api/snapshot', requireAuth)`. The file's header comment (lines 4-18) explicitly documents every query filtered `WHERE user_id = req.user.id`, "NO cross-user access for ANY role — owner and admin included" — self-scoped by design, matching the CLAUDE.md exception for personal data. No endpoint found unguarded.

## Tests and results

| Command | Result |
|---|---|
| `npx jest tests/frontend-stage3-guards.test.js` | PASS — 289 tests |
| `DB_NAME=therapy_scheduler_auditg5 DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/snapshot.itest.js --runInBand` | PASS — 6 tests |
| `node --check snapshot-routes.js` | OK |
| test for "Automated Client Appt Reminders" | **none exists — there is no code to test** |

## Commits in window touching located files

None of the 5 commits in `15acf0c..338f5dc` touch `snapshot-routes.js` or `frontend/current/reports.js`, and none relate to a client-facing appointment reminder:

- `08da79d` (feat/travel) — travel/traffic-alert subsystem (`backend/routes.js`, `frontend/current/travel*.js`, related tests). Checked carefully given the name overlap: this is drive-time traffic alerts for therapists, not client appointment reminders — does not touch the reminder subsystem.
- `e1af24e` (fix/mobile) — `backend/database.js`, `backend/mobile-routes.js` + its test. Mobile diary/calendar sync fix; touches `mobile-routes.js` (which reads `snapshot_reminders` for the phone diary) but only the calendar-matching logic, not reminder creation/guarding, and not `snapshot-routes.js` itself.
- `a56173c`, `dc5dbc4` (case notes) — case-note approval/edit flow only.
- `338f5dc` — test-only change to `travel-traffic.test.js` (shifts alert scenarios to "tomorrow"); no feature code.

## Breakdown

- **Therapist Snapshot: tab-unproven** — API located, guarded, fully covered by passing unit + integration tests, but nothing proves the Daily/Weekly report panel renders in a browser: no hit for `snapshot`/`utilisation`/`utilization` in `docs/qa/BROWSER_QA_RESULTS.md`, and no e2e spec under `e2e/tests/*.spec.js` references it.
- **Automated Client Appt Reminders: untouched** — zero matching code anywhere; this feature has not been started.

## Open tracker tasks

`[todo]` Automated Client Appt Reminders — not started; a decision on channel/scope (SMS vs email, provider, confirm-step UX, reminder-lead-time setting) is needed before any code is written. `[todo]` Therapist Snapshot — code/tests are done; only a browser or E2E check is needed to move past tab-unproven.

## Disagreement / notes

Agree with the tracker's current `claude_update`/`next_action` on both counts, independently re-verified tonight: nothing changed in the 5-commit window for either sub-part, and a broader-than-last-night grep for scheduling/SMS/email-provider libraries still found no reminder-sending infrastructure.
