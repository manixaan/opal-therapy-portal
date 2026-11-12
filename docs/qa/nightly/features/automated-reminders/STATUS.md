# Automated Reminders

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement** (the card bundles one `untouched` idea with one already-`proven` existing feature — see below)
- Addressed in change window (2026-10-29 to 2026-11-12): no
- Created (any code located): yes, but only for the bundled-in "Therapist Snapshot" task, not for the card's own named idea

## Located files

The tracker's `idea` field for this card is **"24Hr Automatic Client Appt Reminders"** — an automated pre-appointment confirmation message to clients. That idea has **nothing located**: no route, no data access, no frontend, no test. The only reminder-shaped file in the codebase is `backend/credential-reminder.js`, which reminds *staff* about *credential expiry* — unrelated to client appointment reminders.

The card also carries a second, unrelated task, **"Therapist Snapshot"**, which **is** a real, already-built feature:

- Routes: `backend/snapshot-routes.js` (`/api/snapshot/reminders`, `/api/snapshot/tasks`), mounted `server.js:589`
- Frontend: `frontend/current/reports.js` ("Daily & Weekly Snapshot" panel), referenced `mockup_v3.html:4179`
- Integration tests: `snapshot.itest.js`
- Unit tests: none dedicated

## Guard check

`snapshot-routes.js:31` — `requireAuth` only, but the file header explicitly documents every read/write as strictly scoped to `WHERE user_id = req.user.id`, "no cross-user access for ANY role" — matches the self-scoped-by-design exception in `.claude/rules/backend-api.md`. Not a finding.

## Tests run

- Integration: `snapshot.itest.js` — included in the 245-test run (244 passed / 1 unrelated failure — see brief's Technical detail) — **pass**.
- No unit test exists for `snapshot-routes.js` specifically.

## Open tasks from tracker

- "Automated Client Appt Reminders" — `todo`. Entirely unbuilt; checklist covers reviewing existing appointment/client data, choosing SMS/email, choosing the confirm mechanism, making the lead time configurable, building the scheduler, sending and logging, and testing safely. None of this exists in code.
- "Therapist Snapshot" — `todo`. Checklist: review existing snapshot (partially ticked — "find where it lives" ✅), confirm two key metrics (weekly utilisation index, today's sessions), decide how to calculate/show utilisation, sketch and build an improved layout, test with real data. **Evidence check**: the snapshot panel exists and is tested at the integration level, but a direct search of `snapshot-routes.js` found no metric literally named "utilisation index" — the tracker's specific ask isn't confirmed built, only the general snapshot panel.

## Commits in window touching it

None for either sub-item.

## Disagreement

None in the formal sense. The real issue is that this card conflates two unrelated things under one idea/title. Recommend the team split "Therapist Snapshot" into its own card (where it would likely classify as `proven` or `needs-refinement` on its own specific utilisation-index ask) so the genuinely `untouched` client-reminder idea isn't obscured by unrelated, already-built work.
