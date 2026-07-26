# Next Xero Setup Steps — quick reference for Antony

Nothing here is done yet, and nothing enables writes. Full detail lives in
`deploy/XERO_OWNER_ACTIONS_CHECKLIST.md` — this is the 5-minute overview of
what happens, in order, when you're ready.

## The path (≈30 min total, all read-only)

1. **Create the Xero developer app** (~10 min)
   https://developer.xero.com/app/manage → New app → *Web app* →
   Authorization Code flow. Redirect URI (exact):
   `https://opal-portal-staging.azurewebsites.net/api/accounting/xero/callback`
   Copy the **Client ID** and generate + copy the **Client secret** (shown once).

2. **Store the secrets in Azure Key Vault** (~2 min, never in chat/git)
   ```bash
   read -rs XERO_CLIENT_ID;     export XERO_CLIENT_ID
   read -rs XERO_CLIENT_SECRET; export XERO_CLIENT_SECRET
   bash deploy/staging-xero-config.sh
   ```
   The script puts both in Key Vault, wires app settings via Key Vault
   references, sets the redirect URI, and leaves **every write flag false**.

3. **Connect from the portal** (~2 min)
   Staging portal → owner login → **Accounting → Xero Connection → Connect
   Xero** → authorise. Tip: pick Xero's **Demo Company** first for a
   zero-risk dry run before your real organisation.

4. **Read-only validation** — say **"xero connected"** and the Phase X17
   battery runs automatically: sync (contacts/invoices/payments/accounts/
   items), dashboard population, token encryption + refresh, rate-limit
   behaviour, write-routes-blocked proof, log hygiene.

## What is deliberately NOT in this path
Invoice creation · invoice approval/sending · payment creation ·
auto-reconciliation · webhooks — each has its own fail-closed flag and its
own later, explicitly-approved step (checklist §D/§E). Bank reconciliation
itself always stays in Xero (public-API limitation, documented in
`XERO_API_CAPABILITY_MATRIX.md`).
