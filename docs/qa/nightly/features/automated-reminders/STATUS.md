# Automated Reminders (idea: "24Hr Automatic Client Appt Reminders")

- Tracker stage: idea · Tracker environment: none
- Evidence label: **needs-refinement** (two very different sub-tasks — see below; re-confirmed
  2026-11-05, unchanged)
- Addressed in this change window: no — zero commits since the 2026-11-04 audit's cutoff
- Created (any located code): partial — Snapshot exists, client reminders do not

## Located files

- Client appointment reminders: **nothing found**. Grepped `backend/*.js` for `reminder`,
  `sms`, `twilio`, `appt.?reminder` — only hits are `credential-reminder.js` (unrelated onboarding
  nudge) and `snapshot-routes.js` (personal, not client-facing). No cron job sends anything to
  clients.
- Therapist Snapshot: `backend/snapshot-routes.js` (personal reminders/tasks, self-scoped) +
  `frontend/current/reports.js` (the actual Daily/Weekly Snapshot panel: billable-hours progress,
  travel summary, idle gaps, recommendations) + `mockup_v3.html` report-modal markup (~22751).
- Guards: `snapshot-routes.js:30` `requireAuth` only, header comment documents every query
  scoped to `req.user.id` — self-scoped by design, not a defect.

## Tests and results

- Integration: `tests/integration/snapshot.itest.js` — **pass**.
- No unit test exists for `snapshot-routes.js` or `reports.js`. No test matches "reminder".

## Open tasks from the tracker

- "Automated Client Appt Reminders" — todo, all checklist items unchecked. Genuinely unbuilt.
- "Therapist Snapshot" — todo; checklist shows "Find where the snapshot lives" done and
  **"Create minimise function on snapshot" marked done**.

## Findings — tracker/code disagreement

The "Create minimise function on snapshot" checklist item is ticked, but no minimise logic exists
anywhere in `reports.js` or `mockup_v3.html` (grepped case-insensitively, zero hits). The checked
item does not match the code.
