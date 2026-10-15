/opal-feature (for the Snapshot utilisation-index work below). If the client
appointment-reminder sub-feature is picked up instead, open under
/opal-critical — see the separate note at the bottom.

**Idea:** 24Hr Automatic Client Appt Reminders

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

**Decisions:** (none recorded)

Tracker task notes (quoted verbatim): "Want to create some sort of way to
send a message to the clients 24hrs beforehand regarding their session to
prompt them to confirm before rocking up to them not being there.
Investigate how can this be safely done. The 24 hr should be editable to a
user created time." / (Therapist Snapshot task) "Already is a snapshot built
into the portal - want to refine and test how this looks like. One key
metric is utilisation index for the week and also their daily sessions and
where to go etc. This is just a note to investigate what has been built and
whether the UI can be improved to be more user friendly/useful"

## Where it lives today

Therapist Snapshot: `backend/snapshot-routes.js`, `frontend/current/reports.js`
(the "Daily & Weekly Snapshot" modal). Client reminders: nothing — no code
exists for this at all.

## Start here

This START.md covers the Snapshot refinement (the part with real code to
build on). Open `frontend/current/reports.js` around the billable-hours
block (search `_rptDailyRecs`) to see the existing metrics shape. There is
no "utilisation index" formula defined anywhere yet — agree the formula with
the practice owner before coding it. Add a focused unit test for the new
calculation (don't touch the existing `snapshot.itest.js` test unless the
new metric needs new data). If real browser proof is wanted, add one
Playwright case to `e2e/tests/portal.spec.js` opening the report panel.

**If you pick up the client-reminder sub-feature instead:** that is a
net-new feature (no code exists) touching client contact data and a new
outbound-messaging integration — open it under **/opal-critical**, not
/opal-feature, and start by confirming what appointment/client-contact data
Opal already stores (see the tracker task's own checklist) before choosing
a delivery channel.

## Done means

A utilisation-index figure appears on the Snapshot panel, backed by a test
that asserts its calculation, moving this slice from needs-refinement to
proven. (The client-reminder sub-feature is separately done when a message
is actually sent and confirmed — see its own checklist in the tracker.)

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
