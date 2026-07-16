#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  STAGE 3–5: Azure staging provisioning (idempotent)
#
#  Prereq: `az login` completed by the subscription owner.
#  Usage:  bash deploy/staging-provision.sh
#
#  Creates (Australia East): resource group, Log Analytics, App Insights,
#  PostgreSQL Flexible Server (+opal_portal DB, TLS enforced, 14-day PITR),
#  App Service plan B1 + Linux web app (Node 22 LTS, WebSockets, Always On,
#  HTTPS-only, health-check on /ready), system-assigned managed identity,
#  Key Vault (RBAC mode) + generated secrets, Storage account + private
#  container, role assignments, and all app settings with KV references.
#
#  SECRETS: generated in-process and written straight to Key Vault. Nothing
#  is echoed. Microsoft/Splose/SMTP/Maps values are set to labelled
#  placeholders so the app can boot; they are replaced in Stages 11–13.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

LOC=australiaeast
RG=opal-portal-staging-rg
PLAN=opal-portal-staging-plan
APP=${APP:-opal-portal-staging}
PG=${PG:-opal-portal-staging-pg}
KV=${KV:-opal-portal-stg-kv}
LAW=opal-portal-staging-law
AI=opal-portal-staging-ai
DBNAME=opal_portal
# Storage account names: 3–24 lowercase alphanumeric, globally unique.
SA=${SA:-opalstg$(openssl rand -hex 4)}

echo "══ context ══"
az account show --query '{subscription:name, tenant:tenantId, user:user.name}' -o table

echo "══ resource group ══"
az group create --name "$RG" --location "$LOC" -o none && echo "✓ $RG"

echo "══ log analytics + app insights ══"
az monitor log-analytics workspace create -g "$RG" -n "$LAW" -l "$LOC" -o none && echo "✓ $LAW"
LAW_ID=$(az monitor log-analytics workspace show -g "$RG" -n "$LAW" --query id -o tsv)
# Created via bare ARM: the `application-insights` CLI extension fails to
# install under az 2.88 / Python 3.14 (pip wheel incompatibility).
az resource create -g "$RG" -n "$AI" -l "$LOC" \
  --resource-type "microsoft.insights/components" \
  --properties "{\"Application_Type\":\"web\",\"WorkspaceResourceId\":\"$LAW_ID\"}" -o none && echo "✓ $AI"
AI_CONN=$(az resource show -g "$RG" -n "$AI" --resource-type "microsoft.insights/components" --query properties.ConnectionString -o tsv)

echo "══ postgresql flexible server (this step takes ~5–10 min) ══"
PG_ADMIN=opaladmin
PG_PASS=$(openssl rand -hex 20)
if az postgres flexible-server show -g "$RG" -n "$PG" -o none 2>/dev/null; then
  echo "✓ $PG exists — keeping existing admin password"
  PG_PASS="" # do not rotate on re-run
else
  az postgres flexible-server create -g "$RG" -n "$PG" -l "$LOC" \
    --tier Burstable --sku-name Standard_B1ms --storage-size 32 \
    --version 16 --backup-retention 14 \
    --admin-user "$PG_ADMIN" --admin-password "$PG_PASS" \
    --public-access 0.0.0.0 --yes -o none && echo "✓ $PG"
fi
az postgres flexible-server db create -g "$RG" -s "$PG" -d "$DBNAME" -o none 2>/dev/null && echo "✓ db $DBNAME" || echo "✓ db $DBNAME exists"

echo "══ app service ══"
az appservice plan create -g "$RG" -n "$PLAN" -l "$LOC" --is-linux --sku B1 -o none && echo "✓ $PLAN"
az webapp create -g "$RG" -p "$PLAN" -n "$APP" --runtime "NODE:22-lts" -o none && echo "✓ $APP" || echo "✓ $APP exists (or name taken — rerun with APP=<other-name>)"
az webapp config set -g "$RG" -n "$APP" \
  --web-sockets-enabled true --always-on true --min-tls-version 1.2 \
  --generic-configurations '{"healthCheckPath": "/ready"}' \
  --startup-file "bash /home/site/wwwroot/backend/startup.sh" -o none && echo "✓ app config"
az webapp update -g "$RG" -n "$APP" --https-only true -o none && echo "✓ https-only"
az webapp identity assign -g "$RG" -n "$APP" -o none && echo "✓ managed identity"
PRINCIPAL=$(az webapp identity show -g "$RG" -n "$APP" --query principalId -o tsv)

echo "══ key vault (RBAC mode) ══"
az keyvault create -g "$RG" -n "$KV" -l "$LOC" --enable-rbac-authorization true -o none 2>/dev/null && echo "✓ $KV" || echo "✓ $KV exists (or name taken — rerun with KV=<other-name>)"
KV_ID=$(az keyvault show -n "$KV" --query id -o tsv)
ME=$(az ad signed-in-user show --query id -o tsv)
az role assignment create --assignee "$ME" --role "Key Vault Administrator" --scope "$KV_ID" -o none 2>/dev/null || true
az role assignment create --assignee "$PRINCIPAL" --role "Key Vault Secrets User" --scope "$KV_ID" -o none 2>/dev/null || true
echo "✓ KV roles (you: admin, app: secrets user)"
echo "  (role propagation can take ~1 min)"; sleep 45

echo "══ secrets → key vault (generated in-process, never echoed) ══"
setsecret() { az keyvault secret set --vault-name "$KV" --name "$1" --value "$2" -o none && echo "  ✓ $1"; }
[ -n "$PG_PASS" ] && setsecret db-password "$PG_PASS"
setsecret session-secret "$(openssl rand -base64 48)"
setsecret token-encryption-key "$(openssl rand -hex 32)"
setsecret webhook-client-state "$(openssl rand -hex 24)"
# Labelled placeholders — replaced in Stages 11 (Entra), 13 (Splose), SMTP/Maps when available
for s in microsoft-client-secret splose-api-key email-pass google-maps-api-key; do
  az keyvault secret show --vault-name "$KV" --name "$s" -o none 2>/dev/null || \
    setsecret "$s" "staging-placeholder-not-configured"
done

echo "══ storage account + private container ══"
az storage account create -g "$RG" -n "$SA" -l "$LOC" --sku Standard_LRS --kind StorageV2 \
  --allow-blob-public-access false --min-tls-version TLS1_2 -o none && echo "✓ $SA"
az storage container create --account-name "$SA" -n employee-documents \
  --public-access off --auth-mode login -o none 2>/dev/null && echo "✓ container" || echo "✓ container exists"
az role assignment create --assignee "$PRINCIPAL" --role "Storage Blob Data Contributor" \
  --scope "$(az storage account show -g "$RG" -n "$SA" --query id -o tsv)" -o none 2>/dev/null || true
# Pilot uses the connection-string path of the storage abstraction (managed
# identity is the documented follow-up in AZURE_DEPLOYMENT.md §12).
SA_CONN=$(az storage account show-connection-string -g "$RG" -n "$SA" --query connectionString -o tsv)
setsecret storage-connection "$SA_CONN"

echo "══ app settings (values + key vault references) ══"
KVURI="https://$KV.vault.azure.net"
BASE="https://$APP.azurewebsites.net"
az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings \
  NODE_ENV=staging \
  APP_BASE_URL="$BASE" \
  ALLOWED_ORIGINS="$BASE" \
  DB_HOST="$PG.postgres.database.azure.com" \
  DB_PORT=5432 DB_NAME="$DBNAME" DB_USER="$PG_ADMIN" DB_SSL=true \
  "DB_PASSWORD=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/db-password/)" \
  "SESSION_SECRET=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/session-secret/)" \
  "TOKEN_ENCRYPTION_KEY=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/token-encryption-key/)" \
  MICROSOFT_CLIENT_ID=staging-placeholder-not-configured \
  MICROSOFT_TENANT_ID=common \
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
  ALLOWED_EMAILS="synthetic.owner@example.test" \
  SYNC_MAX_AUTO_DELETE=25 SYNC_MAX_DELETE_PERCENT=30 \
  ENABLE_OUTLOOK_WRITE=false ENABLE_SPLOSE_WRITE=false ENABLE_AUTOMATIC_REMOTE_DELETE=false \
  SCM_DO_BUILD_DURING_DEPLOYMENT=false
echo "✓ app settings"

echo ""
echo "═══════════════════════════════════════════════════════"
echo " STAGING PROVISIONED"
echo "   App:      $BASE"
echo "   RG:       $RG"
echo "   PG:       $PG.postgres.database.azure.com / $DBNAME"
echo "   KV:       $KV"
echo "   Storage:  $SA (private container: employee-documents)"
echo "   Insights: $AI → $LAW"
echo " Record these names in deploy/staging-resources.txt"
echo "═══════════════════════════════════════════════════════"
printf 'APP=%s\nRG=%s\nPG=%s\nKV=%s\nSA=%s\nAI=%s\nLAW=%s\nBASE=%s\n' \
  "$APP" "$RG" "$PG" "$KV" "$SA" "$AI" "$LAW" "$BASE" > "$(dirname "$0")/staging-resources.txt"
