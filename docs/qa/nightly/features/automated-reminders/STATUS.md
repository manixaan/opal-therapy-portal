Feature: Automated Reminders
Tracker stage: idea
Tracker environment: none
Evidence label: needs-refinement
Addressed in change window (2026-10-02 to 2026-10-16): no
Created (any located code): yes (Therapist Snapshot only)

## Located files
- Automated Client Appt Reminders: **nothing found.** Grepped
  `backend/*.js` for `twilio`/`sms`/`SMS`/"24hour"/"24hr"/"appointment
  reminder"/"client reminder" — the few "sms" hits were false-positive
  substring matches inside unrelated words in onboarding/payroll/Xero
  files, not an actual feature. Confirmed not built.
- Therapist Snapshot: `backend/snapshot-routes.js`
  (`router.use('/api/snapshot', requireAuth)`; header comment explicitly
  documents self-scoping — "There is NO cross-user access for ANY role" —
  the self-scoped exception applies).

## Guard check
Pass for Therapist Snapshot (self-scoped by design, documented).

## Tests run
- Unit: none exist for `snapshot-routes.js`.
- Integration (`DB_NAME=therapy_scheduler_audit`): `snapshot.itest.js` →
  PASS.
- Grepped `snapshot-routes.js` and `snapshot.itest.js` for
  "utilisation"/"utilization" — **zero hits. The utilisation-index metric
  Anthony asked for is confirmed not implemented.**

## Browser / E2E evidence
None found for the Snapshot panel specifically.

## Open tasks from tracker
- Automated Client Appt Reminders [todo]
- Therapist Snapshot [todo]

## Commits in window touching this feature
None.

## Disagreement with tracker
None. The tracker's own prior Claude update already correctly separates
these two very different sub-items under one card.
