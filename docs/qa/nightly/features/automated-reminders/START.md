/opal-feature

# Automated Reminders

**Idea**

24Hr Automatic Client Appt Reminders

**Why**

(not yet written in the tracker)

**Who uses it**

(not yet written in the tracker)

**What they see**

(not yet written in the tracker)

**What should happen**

(not yet written in the tracker)

**Outcome**

(not yet written in the tracker)

**Decision**

(not yet written in the tracker)

## Where it lives today

- Client-facing appointment reminders (SMS/email): **nothing found.** Searched the whole backend for sms/twilio/sendgrid/reminder-sending code; there is none.
- Therapist Snapshot panel: `backend/snapshot-routes.js` (requireAuth; header comment documents strict `user_id` scoping — self-scoped by design, same pattern as `mobile-routes.js`). Frontend: `frontend/current/reports.js` — `snapLoad()` (line ~431) calls `/api/snapshot/reminders` and `/api/snapshot/tasks` directly, and its own comment confirms it ("Snapshot Day V2 (2026-08-09): ONE unified To-Do-style list over the /api/snapshot backend, rendered inside the daily panel"). The panel itself is the "Daily & Weekly Snapshot" report modal in `frontend/current/mockup_v3.html` (around line 21836), opened from the header icon — it is not a `TAB` banner, it's a modal reachable from every tab.
- Re-confirmed tonight that the panel's reminders/tasks widget really is `snapshot-routes.js` (corrected on 2026-10-09 after eight prior nights called it unrelated) — see STATUS.md for the full history.

## Start here

Decide whether client-facing appointment reminders are in scope yet (SMS vs email, provider) — there is zero code to build on. Separately, for the Snapshot panel, add a Playwright check (pattern: `e2e/tests/tutorials.spec.js`) that opens the report modal via the header icon and asserts today's sessions render; that single test would move the panel to `proven`.

## Done means

An e2e test opening the Snapshot report modal and asserting real data renders — label would move to `proven`. The client-reminder half needs a design decision before any test can exist.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
