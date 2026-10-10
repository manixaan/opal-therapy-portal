/opal-critical

# Xero Integration Works

**Idea**

Xero Integration Works

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

- `backend/accounting-routes.js` + `backend/finance-routes.js` — `ownerOnly = [requireAuth, requireRole('owner')]`, applied on 28 and 6 routes respectively. No TODO/FIXME found in either file or in `backend/xero-*.js`.

## Start here

This needs a real Xero sandbox connection, not more mocked tests — follow `.claude/rules/ai-gateway.md`-style caution for any external financial integration: connect a Xero sandbox account in a non-production environment, then run the existing Financial Dashboard and Payroll Automation flows against it and record what actually comes back. Treat any fix that surfaces as CRITICAL (accounting/Xero).

## Done means

A recorded run against a real Xero sandbox (dashboard figures, one payroll sync) with results noted in `docs/qa/BROWSER_QA_RESULTS.md` or an integration test gated behind a real sandbox credential.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
