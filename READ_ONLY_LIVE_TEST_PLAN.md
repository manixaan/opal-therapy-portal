# Controlled Read-Only Live Test Plan — Opal Therapy Employee Portal

**Environment:** Azure staging · https://opal-portal-staging.azurewebsites.net
**Scope:** ONE real therapist calendar, read-only. Splose read-only (practice key).
**Duration:** 7–14 days of normal practice activity.
**Hard invariants for the entire test (verified before start, re-verified weekly):**

```dotenv
ENABLE_OUTLOOK_WRITE=false
ENABLE_SPLOSE_WRITE=false
ENABLE_AUTOMATIC_REMOTE_DELETE=false
```

The portal is a mirror. It cannot create, modify, or delete anything in
Outlook or Splose — enforced server-side at the module boundary and proven
live with working credentials (403 `feature_disabled` on every write path).

## What this test is for

Prove, with one real calendar over real workdays, that the mirror is
**accurate, timely, and boring**: events appear, change, and cancel in the
portal exactly as they do in Outlook/Splose, with nobody having to think
about it — before any employee relies on it and before write-back is ever
considered.

## Roles

- **Test therapist**: works normally in Outlook/Splose. No behaviour change
  asked of them beyond a one-click connect and occasional spot-checks.
- **Antony (owner)**: connects the calendar, does the weekly checks, decides
  pass/fail. Records observations in `READ_ONLY_LIVE_TEST_RESULTS.md`.

## Phase 0 — Connect (Day 0)

1. Therapist (or Antony with the therapist present) signs into the portal,
   Settings → Integrations → **Connect Outlook** → picks the therapist's own
   `@opaltherapy.com.au` account.
2. Verify within 5 minutes: therapist's upcoming events appear on their
   portal calendar; Integrations shows **Connected as** their mailbox.
3. Record in the results file: date/time, mailbox, initial event count for
   the coming 14 days (portal vs Outlook — should match exactly).

## Phase 1 — Daily passive checks (Days 1–7, ~2 min/day)

Each working day, one quick comparison (alternate who does it):

| # | Check | Pass looks like |
|---|---|---|
| D1 | New appointment made in Outlook/Splose today appears in the portal | Visible within ~2 min (90 s poll), correct time/title/location |
| D2 | Any rescheduled appointment moved in the portal too | New time matches, no duplicate at the old time |
| D3 | Any cancellation shows as removed/cancelled in the portal | Gone from portal view; never deleted from Outlook by the portal |
| D4 | Counts match for “today + tomorrow” | Portal count = Outlook count |
| D5 | Portal stayed up | /health + /ready green (Antony; or note any alert emails) |

## Phase 2 — Deliberate probes (once, Days 3–5)

With the therapist, in their Outlook (portal untouched):

1. Create an appointment → confirm it mirrors. Then **rename it** → confirm
   the title updates. Then **delete it** → confirm it leaves the portal AND
   nothing else changed.
2. Create a recurring event → confirm instances mirror sensibly (note any
   oddity — recurrence is a known-complex area).
3. Create an event while the portal tab is OPEN → note whether it appears
   without a manual refresh (Socket.IO live push).
4. In Splose, note one upcoming appointment → confirm the portal’s Smart
   Booking/Splose views show the same time/practitioner.
5. Attempt a write from the portal as the test therapist (e.g. try to create
   an event/appointment) → **must be refused** with a clear message. Record it.

## Phase 3 — Weekly integrity check (Days 7 and 14, Antony, ~10 min)

1. `/health` 200, `/ready` all-ok.
2. Feature flags still all `false` (Settings diagnostics, or ask Claude to verify).
3. 14-day window comparison: portal event count = Outlook event count for
   the therapist; spot-check 5 events field-by-field (time, title, location).
4. No duplicate events (same appointment appearing twice).
5. No “ghost” events (in portal but not in Outlook).
6. Skim the week’s alert emails (there should be none beyond expected).
7. Update the results file.

## Safety rails already active (nothing to do — listed for confidence)

- Write flags off + server-side enforcement (403s) — live-proven.
- Mass-deletion safety: any sync cycle wanting to remove >25 events or >30%
  of linked events is blocked, audited, and owners are notified in-app.
- Tokens AES-256-GCM encrypted at rest; logs and telemetry are redacted and
  have been scanned clean repeatedly.
- Daily PostgreSQL backups, 14-day point-in-time restore.
- Single-command emergency stop: `az webapp stop -g opal-portal-staging-rg -n opal-portal-staging`.

## Exit criteria

**PASS** (→ plan the write-back stage / limited pilot) when:
- ≥7 consecutive practice days with all daily checks passing
- Phase 2 probes all behaved correctly (or issues found were fixed and re-proven)
- Both weekly integrity checks clean (no ghosts, no duplicates, no drift)
- Zero unexplained alerts; flags never changed

**FAIL / PAUSE** if any of: a portal-side change appears in Outlook/Splose
(should be impossible — immediate stop + investigate), persistent data
mismatch, repeated sync failures, or any suspected data leak. Disconnect is
always available: Settings → Integrations, or Antony can stop the app.

## Explicitly out of scope for this test

Multiple therapists · any write-back · automatic remote deletion ·
production domain/DNS · Entra SSO login · client-facing anything.
