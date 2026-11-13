# Automated Reminders

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement** (the card bundles one `untouched` idea with one already-`proven` existing feature — see below)
- Addressed in change window (2026-11-12 to 2026-11-13): no
- Created (any code located): yes, but only for the bundled-in "Therapist Snapshot" task, not for the card's own named idea

## Located files

The tracker's `idea` field for this card is **"24Hr Automatic Client Appt Reminders"** — an automated pre-appointment confirmation message to clients. Re-checked tonight: that idea still has **nothing located**: no route, no data access, no frontend, no test. The only reminder-shaped file in the codebase is `backend/credential-reminder.js`, which reminds *staff* about *credential expiry* — unrelated to client appointment reminders.

The card also carries a second, unrelated task, **"Therapist Snapshot"**, which **is** a real, already-built feature:

- Routes: `backend/snapshot-routes.js` (`/api/snapshot/reminders`, `/api/snapshot/tasks`), mounted `server.js:589`
- Frontend: `frontend/current/reports.js` ("Daily & Weekly Snapshot" panel), referenced `mockup_v3.html:4179`
- Integration tests: `snapshot.itest.js`
- Unit tests: none dedicated

## Guard check

Re-confirmed tonight. `snapshot-routes.js:31` — `requireAuth` only, but the file header explicitly documents every read/write as strictly scoped to `WHERE user_id = req.user.id` — matches the self-scoped-by-design exception. Not a finding.

## Tests run

- Integration: `snapshot.itest.js` — part of tonight's 7-suite/47-test Mobile/Finance batch run — **pass**.
- No unit test exists for `snapshot-routes.js` specifically.

## Open tasks from tracker

- "Automated Client Appt Reminders" — `todo`. Entirely unbuilt.
- "Therapist Snapshot" — `todo`. **Evidence check, re-confirmed**: the snapshot panel exists and is tested, but a direct search of `snapshot-routes.js` again found no metric literally named "utilisation index" — the tracker's specific ask isn't confirmed built, only the general snapshot panel.

## Commits in window touching it

None for either sub-item.

## Disagreement

None in the formal sense. The real issue is that this card conflates two unrelated things under one idea/title — unchanged standing recommendation to split "Therapist Snapshot" into its own card.
