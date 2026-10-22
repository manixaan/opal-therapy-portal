#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  PRODUCTION go-live, October 2026 — launch settings and checks.
#
#  Owner-authorised (22 Oct 2026). The data wipe itself is done by the owner
#  in the Azure Portal (see docs/launch/PRODUCTION_GO_LIVE_CHECKLIST.md); this
#  script only reads state and applies settings. Run ONE step at a time:
#
#    bash deploy/prod-golive-2026-10.sh check      # read-only: names + state
#    bash deploy/prod-golive-2026-10.sh settings   # launch settings (safe switches)
#    bash deploy/prod-golive-2026-10.sh verify     # after the deploy
#
#  Prereq: `az login` as the subscription owner. Never prints a secret value:
#  settings and Key Vault secrets are listed by NAME only.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

APP=opal-portal-prod
RG=opal-portal-prod-rg
PG=opal-portal-prod-pg
KV=opal-portal-prod-kv
SA=opalprod163e898c
BASE=https://opal-portal-prod.azurewebsites.net
OWNER_EMAIL=ann.mathew@opaltherapy.com.au

case "${1:-}" in
check)
  echo "── Subscription"; az account show --query "{name:name, user:user.name}" -o tsv
  # `az resource show`, not `az webapp show`: the latter loads publish profiles
  # through xmltodict/pyexpat, which crashes on some Homebrew Python builds.
  echo "── App state";    az resource show -g "$RG" -n "$APP" --resource-type Microsoft.Web/sites --query "{state:properties.state, host:properties.defaultHostName}" -o tsv
  echo "── App setting NAMES"
  az webapp config appsettings list -g "$RG" -n "$APP" --query "[].name" -o tsv | sort | tr '\n' ' '; echo
  echo "── Key Vault secret NAMES"
  az keyvault secret list --vault-name "$KV" --query "[].name" -o tsv | sort | tr '\n' ' '; echo
  echo "── Database server + databases"
  az postgres flexible-server show -g "$RG" -n "$PG" --query "{state:state, version:version, backupDays:backup.backupRetentionDays}" -o tsv
  az postgres flexible-server db list -g "$RG" -s "$PG" --query "[].name" -o tsv | tr '\n' ' '; echo
  echo "── Storage containers: check in the Azure Portal (storage commands crash on some Homebrew Python builds)"
  echo "── Live /ready"; curl -s --max-time 20 "$BASE/ready"; echo
  ;;

settings)
  echo "── Onboarding encryption key (created only if missing)"
  if ! az keyvault secret show --vault-name "$KV" --name onboarding-encryption-key --query name -o tsv >/dev/null 2>&1; then
    openssl rand -hex 32 | az keyvault secret set --vault-name "$KV" --name onboarding-encryption-key --file /dev/stdin -o none
    echo "  ✓ created onboarding-encryption-key"
  else
    echo "  ✓ onboarding-encryption-key already present"
  fi
  KVURI=$(az keyvault show -n "$KV" --query properties.vaultUri -o tsv); KVURI="${KVURI%/}"
  # The resource-hub storage container is created in the Azure Portal during
  # the wipe: storage data-plane commands parse XML, which crashes on some
  # Homebrew Python builds (pyexpat/libexpat mismatch).
  echo "── Launch settings"
  az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings \
    NODE_ENV=production \
    APP_BASE_URL="$BASE" ALLOWED_ORIGINS="$BASE" \
    MIGRATE_ALLOW_PRODUCTION=true \
    "ONBOARDING_ENCRYPTION_KEY=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/onboarding-encryption-key/)" \
    BOOTSTRAP_OWNER_EMAIL="$OWNER_EMAIL" ALLOWED_EMAILS="$OWNER_EMAIL" ORG_NAME="Opal Therapy" \
    EMAIL_TRANSPORT=graph EMAIL_SENDER=adminteam@opaltherapy.com.au \
    "EMAIL_FROM=Opal Therapy <adminteam@opaltherapy.com.au>" \
    RESOURCE_HUB_STORAGE_BACKEND=blob RESOURCE_HUB_STORAGE_CONTAINER=resource-hub \
    ENABLE_OUTLOOK_WRITE=false ENABLE_SPLOSE_WRITE=false ENABLE_AUTOMATIC_REMOTE_DELETE=false \
    ENABLE_SPLOSE_CALENDAR_SYNC=false ENABLE_SPLOSE_DRAFT_SYNC=true ENABLE_SPLOSE_AUTO_SYNC=false \
    ENABLE_WHODAS_ASSESSMENT=false \
    ENABLE_XERO_WRITE=false ENABLE_XERO_CONTACT_CREATE=false ENABLE_XERO_DRAFT_INVOICE_CREATE=false \
    M365_PROVISIONING_ENABLED=false INDUCTION_AI_ENABLED=false
  echo "  ✓ settings applied (Outlook/Splose writes OFF, auto-sync OFF, review queue ON)"
  echo "── Setting NAMES now"
  az webapp config appsettings list -g "$RG" -n "$APP" --query "[].name" -o tsv | sort | tr '\n' ' '; echo
  ;;

verify)
  echo "── /health";  curl -s --max-time 20 "$BASE/health"; echo
  echo "── /ready";   curl -s --max-time 20 "$BASE/ready"; echo
  curl -s -o /dev/null -w "── new build live: resourcelibrary.js?v=2 → %{http_code}\n" --max-time 20 "$BASE/resourcelibrary.js?v=2"
  echo "── registration answers like the new code (expect use_invite_link)"
  curl -s --max-time 20 -X POST "$BASE/api/auth/check-invite" -H "Content-Type: application/json" -H "Origin: $BASE" \
    -d '{"email":"nobody@example.invalid"}'; echo
  ;;

*)
  echo "Usage: bash deploy/prod-golive-2026-10.sh check|settings|verify"; exit 2 ;;
esac
