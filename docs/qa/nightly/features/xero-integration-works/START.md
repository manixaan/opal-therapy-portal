/opal-critical

**Idea:** Xero Integration Works

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

No decisions recorded yet.

**Task — Financial Dashboard:** We will add a new Finance page inside the
owner portal only. It will pull live figures from Xero and combine them with
your own invoicing data already in Opal. We show the figures as clear cards
and lists: income, expenses, revenue, outstanding and late invoices, tax
owed, and a few more. First we confirm the Xero connection works, then we
gather the numbers, then we display them.

**Task — Payroll Automation:** We will let Opal Portal send payroll
information straight into Xero, so Anthony stops typing it in by hand. First
we learn exactly what Xero allows and needs, using Xero's own official
connection guide. Then we set up a secure link between the portal and the
company's Xero account. Finally we take the...(truncated in the tracker).

## Where it lives today

`backend/finance-routes.js`, `backend/accounting-routes.js`,
`backend/onboarding-payroll-routes.js`, the `xero-*.js` family, and
`frontend/current/finance.js` / `invoicing.js`. All guarded correctly. 81
unit tests and 63 integration tests pass against mocked/offline Xero.

## Start here

This is CRITICAL level (Xero/accounting). The code and tests already prove
the mechanics work; what is missing is a real Xero sandbox connection and a
browser check of the Finance tab's numbers. Start by connecting a Xero
developer sandbox (`xero-payroll-connection.js` has the OAuth flow already),
then sign in as an owner and open the Finance tab to confirm the dashboard
populates with real figures, not mocks. Follow the pattern in
`tests/integration/finance-routes.itest.js` for what "populated correctly"
means in code.

## Done means

An owner session against a connected Xero sandbox shows real income,
expenses, outstanding/late invoices and tax figures on the Finance tab, with
a browser check or new E2E spec recorded for it. Target label: `proven`.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
