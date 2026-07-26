#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  Accounting/Xero staging configuration (idempotent)
#
#  Prereq: az login + staging provisioned (deploy/staging-resources.txt) AND
#          the owner has created the Xero app (deploy/XERO_OWNER_ACTIONS_CHECKLIST.md).
#  Usage:  XERO_CLIENT_ID=... XERO_CLIENT_SECRET=... XERO_WEBHOOK_KEY=... \
#            bash deploy/staging-xero-config.sh
#
#  Stores the Xero secrets in Key Vault (never printed) and sets the App
#  Service settings (Key Vault references for secrets; fail-closed flags).
#  Read-only by default: every write flag is left false.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/staging-resources.txt  # APP / RG / KV / BASE

: "${XERO_CLIENT_ID:?set XERO_CLIENT_ID in the environment (not on the command line history if avoidable)}"
: "${XERO_CLIENT_SECRET:?set XERO_CLIENT_SECRET}"
XERO_WEBHOOK_KEY="${XERO_WEBHOOK_KEY:-}"

echo "── storing Xero secrets in Key Vault (values never echoed) ──"
az keyvault secret set --vault-name "$KV" --name xero-client-id     --value "$XERO_CLIENT_ID"     -o none && echo "  ✓ xero-client-id"
az keyvault secret set --vault-name "$KV" --name xero-client-secret --value "$XERO_CLIENT_SECRET" -o none && echo "  ✓ xero-client-secret"
if [ -n "$XERO_WEBHOOK_KEY" ]; then
  az keyvault secret set --vault-name "$KV" --name xero-webhook-key --value "$XERO_WEBHOOK_KEY" -o none && echo "  ✓ xero-webhook-key"
fi

KVURI="https://$KV.vault.azure.net"
echo "── setting App Service settings (KV refs for secrets; fail-closed flags) ──"
az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings \
  "XERO_CLIENT_ID=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/xero-client-id/)" \
  "XERO_CLIENT_SECRET=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/xero-client-secret/)" \
  "XERO_WEBHOOK_KEY=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/xero-webhook-key/)" \
  "XERO_REDIRECT_URI=$BASE/api/accounting/xero/callback" \
  ENABLE_XERO_READ=true \
  ENABLE_FINANCE_DASHBOARD=true \
  ENABLE_XERO_WRITE=false \
  ENABLE_XERO_DRAFT_INVOICE_CREATE=false \
  ENABLE_XERO_APPROVE_INVOICE=false \
  ENABLE_XERO_SEND_INVOICE=false \
  ENABLE_XERO_PAYMENT_CREATE=false \
  ENABLE_XERO_AUTO_RECONCILIATION=false \
  ENABLE_XERO_WEBHOOKS=false

# Rewrite forces Key Vault reference re-resolution (a restart alone may serve
# a cached value — learned during the Splose key rotation).
echo ""
echo "✓ Xero staging config applied (read-only; all writes fail-closed)."
echo "  Redirect URI to register in the Xero app: $BASE/api/accounting/xero/callback"
echo "  Next: connect from the portal → Accounting → Xero Connection → Connect Xero,"
echo "        then run a read-only sync. Do NOT enable writes until validated."
