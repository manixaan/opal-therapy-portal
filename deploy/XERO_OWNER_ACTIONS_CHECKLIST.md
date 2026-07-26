# Xero Owner Actions Checklist — for Antony

The Accounting module is built and tested locally. These are the only steps
that require your Xero account and cannot be done autonomously. Nothing here
enables any financial write — the module stays read-only until you explicitly
approve controlled draft-invoice testing (last section).

> ⚠️ **Never paste Xero secrets into chat.** They go into Azure Key Vault via
> the provided script, which reads them from your environment and never prints
> them.

## A. Create the Xero developer app (~10 min)

| ✅ | # | Action | Where / value |
|---|---|---|---|
| ☐ | 1 | Sign in to the Xero developer portal | https://developer.xero.com/app/manage |
| ☐ | 2 | **New app** → *Web app* | Name e.g. "Opal Therapy Portal (Staging)" |
| ☐ | 3 | OAuth2 grant type | **Authorization Code** flow |
| ☐ | 4 | Company/URL | your practice details |
| ☐ | 5 | **Staging redirect URI** | `https://opal-portal-staging.azurewebsites.net/api/accounting/xero/callback` |
| ☐ | 6 | (Production redirect URI — later) | `https://portal.opaltherapy.com.au/api/accounting/xero/callback` |
| ☐ | 7 | Copy the **Client ID** | (used in step B) |
| ☐ | 8 | Generate a **Client secret**, copy it | (used in step B) — shown once |

**Scopes** the app requests (read-first — the code asks for these; you just
confirm consent when connecting): `openid profile email offline_access
accounting.transactions.read accounting.contacts.read accounting.settings.read
accounting.reports.read`. No write scope is requested during read-only
validation.

## B. Put the secrets in Azure Key Vault (~2 min)

In your terminal (after `az login`), from the repo root — set the values as
environment variables so they never land in shell history as arguments:

```bash
read -rs XERO_CLIENT_ID;      export XERO_CLIENT_ID
read -rs XERO_CLIENT_SECRET;  export XERO_CLIENT_SECRET
# webhook key only if/when you enable webhooks (section E) — optional now:
# read -rs XERO_WEBHOOK_KEY;   export XERO_WEBHOOK_KEY
bash deploy/staging-xero-config.sh
```

This stores the secrets in Key Vault, points the app settings at them via Key
Vault references, sets the redirect URI, and leaves **all write flags false**.
The script prints the exact redirect URI to double-check against step 5.

## C. Connect + read-only validation (~5 min)

| ✅ | # | Action |
|---|---|---|
| ☐ | 9 | Sign into the staging portal as the **owner** account |
| ☐ | 10 | Go to **Accounting → Xero Connection → Connect Xero** |
| ☐ | 11 | Authorise, and **select the Xero organisation** (use the Xero **Demo Company** first if you want zero real-data risk) |
| ☐ | 12 | Back in the portal, click **Sync now** |
| ☐ | 13 | Check **Overview** populates (revenue, invoices, outstanding) and **Invoices** lists Xero invoices |
| ☐ | 14 | Confirm the flag badges show **write: off**, **draft-invoice: off** |
| ☐ | 15 | Tell me "xero connected" and I'll run the full Stage X17 read-only validation battery |

**Do not enable any write flag yet.** Read-only validation must pass first.

## D. (Later, only on explicit approval) Controlled draft-invoice test

When you're satisfied with the read-only mirror and want to test invoice
creation — against the Xero **Demo Company** or a clearly marked test contact:

1. Set two app settings (I can do this once you approve):
   `ENABLE_XERO_WRITE=true` and `ENABLE_XERO_DRAFT_INVOICE_CREATE=true`
   (leave approve/send/payment/auto-reconciliation all false).
2. In the portal, approve one invoice candidate, then **Create draft invoice**.
3. Verify in Xero it appears as **DRAFT** — not approved, not sent.
4. Turn the two flags back to `false` unless continuing controlled testing.

## E. (Optional, later) Webhooks

Only if you want near-real-time invoice status updates:
1. In the Xero app, add the webhook delivery URL
   `https://opal-portal-staging.azurewebsites.net/api/accounting/webhooks/xero`
   and copy the **webhook signing key**.
2. Store it: `read -rs XERO_WEBHOOK_KEY; export XERO_WEBHOOK_KEY; bash deploy/staging-xero-config.sh`
3. I set `ENABLE_XERO_WEBHOOKS=true`; Xero sends an "intent to receive"
   validation the endpoint answers automatically.

## What stays a human action in Xero (by API design)

Bank reconciliation — matching bank statement lines — **cannot** be done via
the public Xero API (see `docs/accounting/XERO_API_CAPABILITY_MATRIX.md`). The
portal's Reconciliation tab *suggests* invoice↔payment matches for your
review; the actual bank-feed reconciliation always happens in Xero.
