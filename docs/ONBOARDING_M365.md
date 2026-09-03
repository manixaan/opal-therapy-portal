# Onboarding — Microsoft 365 account provisioning

The onboarding journey can create a new starter's Microsoft 365 account: a work
address on the practice domain, a temporary password, and a licence. Deactivating
the portal account later disables the Microsoft account and returns the licence
to the pool. Nothing is ever deleted from Microsoft by the portal.

Code: `backend/graph-identity.js` (the only app-only Graph client),
`backend/onboarding-workflow-routes.js` (the two `/m365` routes),
`backend/app-routes.js` (`offboardMicrosoft365` on deactivate),
`frontend/current/onboarding.js` (`m365Card`, `m365Dialog`), migration 053.

## What the Owner sees

| State | Card text |
|---|---|
| Feature off or the tenant grant missing | "Ask your Microsoft admin…" — nothing else is offered |
| Ready | "Create Microsoft account" → dialog shows the suggested address and each licence tier with how many are left |
| No licences in the chosen tier | The tier is disabled with "None left — buy one in the Microsoft 365 admin centre first"; if every tier is empty the Create button is not shown |
| Account created, licence failed | "No licence yet" with an "Assign licence" retry that never creates a second account |
| Created and licensed | Address and tier, read-only |

The temporary password is shown once and never stored. Microsoft forces a change
at first sign-in.

## Money

The account is free; the licence is the monthly charge. The licence pool is
checked **before** the account is created, so an empty pool creates nothing.
Buying licences stays a human act in the Microsoft 365 admin centre. On
deactivation the licence is released so the next starter can reuse it.

## One-time setup (tenant Global Administrator)

1. In Entra ID → App registrations → the portal's app → **API permissions**,
   add these **Application** (not Delegated) Microsoft Graph permissions and
   press **Grant admin consent**:
   - `User.ReadWrite.All` — create, disable, licence
   - `Organization.Read.All` — read the licence pool
2. Confirm a client secret exists (`MICROSOFT_CLIENT_SECRET`).
3. Find the SKU ids for the two tiers the practice buys. From Graph Explorer
   (`GET https://graph.microsoft.com/v1.0/subscribedSkus`) copy `skuId` for e.g.
   Business Basic and Business Standard/Premium.
4. Set the App Service settings:

```
M365_PROVISIONING_ENABLED=true
M365_DOMAIN=<the practice's verified domain>
M365_LICENCE_SKU_BASIC=<skuId>
M365_LICENCE_SKU_FULL=<skuId>       # optional; leave blank to offer one tier
M365_USAGE_LOCATION=AU
```

Until step 1 is done every Graph call fails closed with the admin message. There
is no retry, fallback, or partial mode.

## Audit

- `onboarding.m365_account_created` — licence tier, object id, `tempPasswordIssued`
- `onboarding.m365_licence_assigned` — the retry path
- `account.m365_disabled` — on deactivate, with `licencesReleased`

The address lives on the `users` and `onboarding_assignments` rows; it is not
written to the audit metadata, and the password has no key there at all.

## Tests

- `backend/tests/graph-identity.test.js` — order of operations, refusals, never-delete
- `backend/tests/onboarding-workflow-guards.test.js` — the route table
- `backend/tests/integration/onboarding-workflow.itest.js` — "creating the Microsoft 365 account"
