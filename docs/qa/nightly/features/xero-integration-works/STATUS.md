# Xero Integration Works

- Tracker stage: `idea`
- Tracker environment: `none`
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-10-09): no
- Created (any located code at all): yes

## Located

- `backend/accounting-routes.js` + `backend/finance-routes.js` — `ownerOnly = [requireAuth, requireRole('owner')]`, applied on 28 and 6 routes respectively. No TODO/FIXME found in either file or in `backend/xero-*.js`.

## Tests

- Unit (5 files): **70/70 pass.**
- Integration (4 files): **39/39 pass**, all against a mocked Xero ("xero offline in test" warnings in the logs confirm no live Xero call was attempted).
- e2e: `e2e/tests/portal.spec.js` asserts accounting 403 gating for non-owners. Browser QA row H: owner sees the tab, gating is correct, `xeroWrite:false`, `draftInvoiceCreate:false` — and explicitly "no Xero connection attempted, no write action exercised."

## Open tasks (from the tracker)

Tasks "Financial Dashboard" and "Payroll Automation" are both `todo`.

## Commits since the last audit that touched it

None — no commits have landed on `develop` under `backend/` or `frontend/current/` since the last audit (2026-10-09). Code audited tonight is the same commit (`aacf8e6`) as the last several nights.

## Disagreement with the tracker

None.

