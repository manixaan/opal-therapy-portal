#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  PRODUCTION provisioning (idempotent) — Option B, approved 2026-08-01
#
#  Prereq: `az login` (subscription owner). Usage: bash deploy/prod-provision.sh
#
#  Mirrors deploy/staging-provision.sh with the production differences from
#  docs/launch/PRODUCTION_ENVIRONMENT_CUTOVER_PLAN.md:
#    • NODE_ENV=production (Secure cookies, strict CSRF, prod migration guard)
#    • APP_BASE_URL/ALLOWED_ORIGINS/REDIRECT_URI on the prod URL
#    • FRESH session-secret / token-encryption-key / db-password (never
#      copied from staging); Entra client secret, Splose key and Maps key
#      are copied from staging KV afterwards by prod-secrets-sync (same
#      registrations / same practice key — intentional, documented)
#    • ALLOWED_EMAILS starts as the smoke-bootstrap address; the post-smoke
#      step switches it to the real owner's email (see cutover plan §data)
#    • EVERY external write flag explicitly false
#  Writes deploy/prod-resources.txt. Never echoes a secret.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

LOC=australiaeast
RG=opal-portal-prod-rg
PLAN=opal-portal-prod-plan
APP=${APP:-opal-portal-prod}
PG=${PG:-opal-portal-prod-pg}
KV=${KV:-opal-portal-prod-kv}
LAW=opal-portal-prod-law
AI=opal-portal-prod-ai
DBNAME=opal_portal
SA=${SA:-opalprod$(openssl rand -hex 4)}
SMOKE_BOOTSTRAP_EMAIL=${SMOKE_BOOTSTRAP_EMAIL:-prod.smoke@opaltherapy.com.au}

echo "══ context ══"
az account show --query '{subscription:name, tenant:tenantId, user:user.name}' -o table

echo "══ resource group ══"
az group create --name "$RG" --location "$LOC" -o none && echo "✓ $RG"

echo "══ log analytics + app insights ══"
az monitor log-analytics workspace create -g "$RG" -n "$LAW" -l "$LOC" -o none && echo "✓ $LAW"
LAW_ID=$(az monitor log-analytics workspace show -g "$RG" -n "$LAW" --query id -o tsv)
az resource create -g "$RG" -n "$AI" -l "$LOC" \
  --resource-type "microsoft.insights/components" \
  --properties "{\"Application_Type\":\"web\",\"WorkspaceResourceId\":\"$LAW_ID\"}" -o none && echo "✓ $AI"
AI_CONN=$(az resource show -g "$RG" -n "$AI" --resource-type "microsoft.insights/components" --query properties.ConnectionString -o tsv)

echo "══ postgresql flexible server (~5–10 min) ══"
PG_ADMIN=opaladmin
PG_PASS=$(openssl rand -hex 20)
if az postgres flexible-server show -g "$RG" -n "$PG" -o none 2>/dev/null; then
  echo "✓ $PG exists — keeping existing admin password"
  PG_PASS=""
else
  az postgres flexible-server create -g "$RG" -n "$PG" -l "$LOC" \
    --tier Burstable --sku-name Standard_B1ms --storage-size 32 \
    --version 16 --backup-retention 14 \
    --admin-user "$PG_ADMIN" --admin-password "$PG_PASS" \
    --public-access 0.0.0.0 --yes -o none && echo "✓ $PG"
fi
az postgres flexible-server db create --resource-group "$RG" --server-name "$PG" --name "$DBNAME" -o none 2>&1 | grep -v "already exists" || true; echo "✓ db $DBNAME"

echo "══ app service ══"
az appservice plan create -g "$RG" -n "$PLAN" -l "$LOC" --is-linux --sku B1 -o none && echo "✓ $PLAN"
az webapp create -g "$RG" -p "$PLAN" -n "$APP" --runtime "NODE:22-lts" -o none && echo "✓ $APP" || echo "✓ $APP exists (or name taken — rerun with APP=<other>; deploy-production.yml must match)"
az webapp config set -g "$RG" -n "$APP" \
  --web-sockets-enabled true --always-on true --min-tls-version 1.2 \
  --generic-configurations '{"healthCheckPath": "/ready"}' \
  --startup-file "bash /home/site/wwwroot/backend/startup.sh" -o none && echo "✓ app config"
az webapp update -g "$RG" -n "$APP" --https-only true -o none && echo "✓ https-only"
az webapp identity assign -g "$RG" -n "$APP" -o none && echo "✓ managed identity"
PRINCIPAL=$(az webapp identity show -g "$RG" -n "$APP" --query principalId -o tsv)

echo "══ key vault (RBAC mode) ══"
az keyvault create -g "$RG" -n "$KV" -l "$LOC" --enable-rbac-authorization true -o none 2>/dev/null && echo "✓ $KV" || echo "✓ $KV exists (or name taken — rerun with KV=<other>)"
KV_ID=$(az keyvault show -n "$KV" --query id -o tsv)
ME=$(az ad signed-in-user show --query id -o tsv)
az role assignment create --assignee "$ME" --role "Key Vault Administrator" --scope "$KV_ID" -o none 2>/dev/null || true
az role assignment create --assignee "$PRINCIPAL" --role "Key Vault Secrets User" --scope "$KV_ID" -o none 2>/dev/null || true
echo "✓ KV roles"; sleep 45

echo "══ secrets → key vault (FRESH for production, never echoed) ══"
setsecret() { az keyvault secret set --vault-name "$KV" --name "$1" --value "$2" -o none && echo "  ✓ $1"; }
[ -n "$PG_PASS" ] && setsecret db-password "$PG_PASS"
az keyvault secret show --vault-name "$KV" --name session-secret -o none 2>/dev/null || setsecret session-secret "$(openssl rand -base64 48)"
az keyvault secret show --vault-name "$KV" --name token-encryption-key -o none 2>/dev/null || setsecret token-encryption-key "$(openssl rand -hex 32)"
az keyvault secret show --vault-name "$KV" --name webhook-client-state -o none 2>/dev/null || setsecret webhook-client-state "$(openssl rand -hex 24)"
# Placeholders until prod-secrets-sync copies the intentional shared values
for s in microsoft-client-secret splose-api-key email-pass google-maps-api-key; do
  az keyvault secret show --vault-name "$KV" --name "$s" -o none 2>/dev/null || \
    setsecret "$s" "prod-placeholder-not-configured"
done

echo "══ storage account + private container ══"
az storage account create -g "$RG" -n "$SA" -l "$LOC" --sku Standard_LRS --kind StorageV2 \
  --allow-blob-public-access false --min-tls-version TLS1_2 -o none && echo "✓ $SA"
az storage container create --account-name "$SA" -n employee-documents \
  --public-access off --auth-mode login -o none 2>/dev/null && echo "✓ container" || echo "✓ container exists"
az role assignment create --assignee "$PRINCIPAL" --role "Storage Blob Data Contributor" \
  --scope "$(az storage account show -g "$RG" -n "$SA" --query id -o tsv)" -o none 2>/dev/null || true
# Blob soft-delete from day one (staging gap noted in the audit)
az storage account blob-service-properties update --account-name "$SA" -g "$RG" \
  --enable-delete-retention true --delete-retention-days 30 -o none && echo "✓ blob soft-delete 30d"
SA_CONN=$(az storage account show-connection-string -g "$RG" -n "$SA" --query connectionString -o tsv)
setsecret storage-connection "$SA_CONN"

echo "══ app settings (production posture) ══"
KVURI="https://$KV.vault.azure.net"
BASE="https://$APP.azurewebsites.net"
STG_MS_CLIENT_ID=$(az webapp config appsettings list -g opal-portal-staging-rg -n opal-portal-staging \
  --query "[?name=='MICROSOFT_CLIENT_ID'].value | [0]" -o tsv)
az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings \
  NODE_ENV=production \
  APP_BASE_URL="$BASE" \
  ALLOWED_ORIGINS="$BASE" \
  DB_HOST="$PG.postgres.database.azure.com" \
  DB_PORT=5432 DB_NAME="$DBNAME" DB_USER="$PG_ADMIN" DB_SSL=true \
  "DB_PASSWORD=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/db-password/)" \
  "SESSION_SECRET=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/session-secret/)" \
  "TOKEN_ENCRYPTION_KEY=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/token-encryption-key/)" \
  MICROSOFT_CLIENT_ID="$STG_MS_CLIENT_ID" \
  MICROSOFT_TENANT_ID="$(az account show --query tenantId -o tsv)" \
  "MICROSOFT_CLIENT_SECRET=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/microsoft-client-secret/)" \
  MICROSOFT_REDIRECT_URI="$BASE/auth/oauth/callback" \
  "SPLOSE_API_KEY=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/splose-api-key/)" \
  "EMAIL_PASS=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/email-pass/)" \
  "GOOGLE_MAPS_API_KEY=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/google-maps-api-key/)" \
  DOCUMENT_STORAGE_BACKEND=blob \
  "AZURE_STORAGE_CONNECTION_STRING=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/storage-connection/)" \
  AZURE_STORAGE_CONTAINER=employee-documents \
  MIGRATE_ALLOW_PRODUCTION=true \
  "APPLICATIONINSIGHTS_CONNECTION_STRING=$AI_CONN" \
  ALLOWED_EMAILS="$SMOKE_BOOTSTRAP_EMAIL" \
  SYNC_MAX_AUTO_DELETE=25 SYNC_MAX_DELETE_PERCENT=30 \
  ENABLE_OUTLOOK_WRITE=false ENABLE_SPLOSE_WRITE=false ENABLE_AUTOMATIC_REMOTE_DELETE=false \
  ENABLE_XERO_WRITE=false ENABLE_XERO_CONTACT_CREATE=false ENABLE_XERO_DRAFT_INVOICE_CREATE=false \
  ENABLE_RESOURCE_CLIENT_SUGGESTIONS=false ENABLE_RESOURCE_AI_SUGGESTIONS=false ENABLE_RESOURCE_EXTERNAL_SHARING=false \
  SCM_DO_BUILD_DURING_DEPLOYMENT=false
echo "✓ app settings (NODE_ENV=production, all write flags false)"

echo ""
echo "═══════════════════════════════════════════════════════"
echo " PRODUCTION PROVISIONED — no code deployed yet"
echo "   App:      $BASE"
echo "   RG:       $RG | PG: $PG.postgres.database.azure.com/$DBNAME"
echo "   KV:       $KV | Storage: $SA | Insights: $AI → $LAW"
echo " Next: prod-secrets-sync, deployer role, PRODUCTION_URL var,"
echo "       then the Deploy Production workflow (owner approves)."
echo "═══════════════════════════════════════════════════════"
printf 'APP=%s\nRG=%s\nPG=%s\nKV=%s\nSA=%s\nAI=%s\nLAW=%s\nBASE=%s\n' \
  "$APP" "$RG" "$PG" "$KV" "$SA" "$AI" "$LAW" "$BASE" > "$(dirname "$0")/prod-resources.txt"
