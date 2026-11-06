/opal-critical

## Idea
Xero Integration Works

## Why
(not yet written in the tracker)

## Who uses it
(not yet written in the tracker)

## What they see
(not yet written in the tracker)

## What should happen
(not yet written in the tracker)

## Outcome
(not yet written in the tracker)

## Decisions
(none recorded)

## Where it lives today
`backend/accounting-routes.js` + `backend/accounting-db.js` (Financial Dashboard),
`backend/xero-api.js` / `backend/xero-sync.js` (Xero client), `backend/xero-payroll-*.js`
(Payroll Automation). Owner-only, mounted in `backend/server.js:644-648`. Frontend Finance page
inside `frontend/current/mockup_v3.html`, gated by `data-owner-only="1"`.

## Start here
This is accounting/Xero code — CRITICAL level (`.claude/rules/backend-api.md`,
`.claude/rules/tests.md`). The backend is fully built and passes 116 tests (77 unit + 39
integration), all against a mocked/offline Xero. The real gap is a live run: open the Finance
tab as Owner with a real Xero **sandbox** org connected via `GET /api/accounting/xero/connect`
→ `callback`, and walk one Financial Dashboard read and one Payroll push against that sandbox.
Never use production Xero credentials for this.

## Done means
A recorded sandbox walkthrough (dashboard figures match the sandbox org; one payroll push
succeeds and appears in Xero) moves the evidence label from `tab-unproven` toward `proven`, and
the tracker's two task checklists can start ticking off their first items.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
