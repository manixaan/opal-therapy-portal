#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  STAGE 11: Microsoft Entra staging app registration (idempotent)
#
#  Prereq: az login as a user who may register applications in the tenant.
#  Usage:  bash deploy/staging-entra.sh
#
#  Creates "Opal Portal (Staging)" with the staging redirect URI and the
#  delegated Graph permissions the portal uses for Outlook sync, creates a
#  client secret DIRECTLY into Key Vault (never printed), and updates the
#  app settings. Admin consent is the one step that may need a Global
#  Administrator in the tenant — the script prints the exact command/URL.
#
#  Separate registration from production by design — staging tokens and
#  consent never touch the production app.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/staging-resources.txt # APP/RG/KV/BASE

DISPLAY_NAME="Opal Portal (Staging)"
REDIRECT="$BASE/auth/oauth/callback"

echo "══ app registration ══"
APP_ID=$(az ad app list --display-name "$DISPLAY_NAME" --query '[0].appId' -o tsv)
if [ -z "$APP_ID" ]; then
  # Delegated Graph permissions: openid, profile, email, offline_access,
  # User.Read, Calendars.ReadWrite (ids are Microsoft Graph well-known ids).
  APP_ID=$(az ad app create --display-name "$DISPLAY_NAME" \
    --web-redirect-uris "$REDIRECT" \
    --sign-in-audience AzureADMyOrg \
    --required-resource-accesses '[{
      "resourceAppId": "00000003-0000-0000-c000-000000000000",
      "resourceAccess": [
        {"id": "37f7f235-527c-4136-accd-4a02d197296e", "type": "Scope"},
        {"id": "14dad69e-099b-42c9-810b-d002981feec1", "type": "Scope"},
        {"id": "64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0", "type": "Scope"},
        {"id": "7427e0e9-2fba-42fe-b0c0-848c9e6a8182", "type": "Scope"},
        {"id": "e1fe6dd8-ba31-4d61-89e7-88639da4683d", "type": "Scope"},
        {"id": "1ec239c2-d7c9-4623-a91a-a9775856bb36", "type": "Scope"}
      ]
    }]' \
    --query appId -o tsv)
  echo "✓ created $DISPLAY_NAME ($APP_ID)"
else
  echo "✓ $DISPLAY_NAME exists ($APP_ID)"
  az ad app update --id "$APP_ID" --web-redirect-uris "$REDIRECT"
fi

echo "══ client secret → key vault (24-month, never printed) ══"
SECRET=$(az ad app credential reset --id "$APP_ID" --display-name staging-portal \
  --years 2 --query password -o tsv)
az keyvault secret set --vault-name "$KV" --name microsoft-client-secret \
  --value "$SECRET" -o none
unset SECRET
echo "✓ microsoft-client-secret updated in $KV"

TENANT=$(az account show --query tenantId -o tsv)
echo "══ app settings ══"
az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings \
  MICROSOFT_CLIENT_ID="$APP_ID" \
  MICROSOFT_TENANT_ID="$TENANT"
echo "✓ MICROSOFT_CLIENT_ID / MICROSOFT_TENANT_ID set (restart pending)"

echo ""
echo "══ ADMIN CONSENT (may require Global Administrator) ══"
echo "  Try:   az ad app permission admin-consent --id $APP_ID"
echo "  Or:    https://login.microsoftonline.com/$TENANT/adminconsent?client_id=$APP_ID"
echo "  Then:  az webapp restart -g $RG -n $APP"
