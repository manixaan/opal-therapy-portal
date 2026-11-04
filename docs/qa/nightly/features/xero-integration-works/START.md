/opal-critical

**Idea**: Xero Integration Works

**Why**: (not yet written in the tracker)

**Who uses it**: (not yet written in the tracker)

**What they see**: (not yet written in the tracker)

**What should happen**: (not yet written in the tracker)

**Outcome**: (not yet written in the tracker)

**Decisions**: (none recorded)

**Tracker's next_action**: "Open the Finance tab as Owner with a Xero sandbox connected and
record what you saw."

## Where it lives today

`backend/finance-routes.js` (dashboard), `backend/xero-payroll-sync.js` (payroll push),
`frontend/current/finance.js`.

## Start here

This is a human walkthrough task, not a build task — the dashboard and payroll-sync code are
already built, guarded owner-only, and unit/integration tested. Connect a Xero sandbox account,
open the Finance tab as Owner, and record: does `GET /api/finance/dashboard` return real figures,
does the payroll sync actually create/configure employees in the sandbox, and does anything in
the UI leak Xero data to a non-owner role. Update the tracker checklists on "Financial Dashboard"
and "Payroll Automation" to reflect what's already built rather than leaving them at 0/N.

## Done means

A recorded sandbox walkthrough confirms both flows work live, or surfaces a specific defect as a
new task — either way the tracker checklist should stop understating what's built.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
