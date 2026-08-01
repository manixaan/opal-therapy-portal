#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  PRODUCTION follow-up (idempotent): intentional secret shares + deploy path
#
#  Run AFTER deploy/prod-provision.sh. Does four things:
#   1. Copies the three INTENTIONALLY shared secrets from staging KV to prod
#      KV: microsoft-client-secret (same Entra app registration),
#      splose-api-key (the practice's one durable key), google-maps-api-key
#      (same Maps project). Session/encryption/DB secrets are NEVER copied —
#      production has fresh ones from provisioning.
#   2. Adds the production redirect URI to the existing Entra app
#      registration (same app as staging — a dedicated prod registration is
#      a documented later hardening step).
#   3. Grants the GitHub OIDC deployer Contributor on the prod RG only.
#   4. Sets the GitHub `production` environment variable PRODUCTION_URL so
#      the deploy workflow health-gates the real URL (custom domain later).
#  Values are piped, never echoed.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."
source deploy/staging-resources.txt
SRG=$RG; SKV=$KV
source deploy/prod-resources.txt
PRG=$RG; PKV=$KV; PAPP=$APP; PBASE=$BASE
REPO=${REPO:-manixaan/opal-therapy-portal}

echo "══ 1. intentional secret shares (staging KV → prod KV) ══"
for s in microsoft-client-secret splose-api-key google-maps-api-key; do
  VAL=$(az keyvault secret show --vault-name "$SKV" --name "$s" --query value -o tsv)
  if [ -z "$VAL" ] || [[ "$VAL" == *placeholder* ]]; then
    echo "  ⚠ $s is a placeholder on staging — leaving prod placeholder"
    continue
  fi
  printf '%s' "$VAL" | az keyvault secret set --vault-name "$PKV" --name "$s" --file /dev/stdin -o none \
    && echo "  ✓ $s copied"
  VAL=""
done

echo "══ 2. Entra: add production redirect URI ══"
MS_APP_ID=$(az webapp config appsettings list -g "$SRG" -n opal-portal-staging \
  --query "[?name=='MICROSOFT_CLIENT_ID'].value | [0]" -o tsv)
EXISTING=$(az ad app show --id "$MS_APP_ID" --query "web.redirectUris" -o json)
NEWURI="$PBASE/auth/oauth/callback"
if echo "$EXISTING" | grep -q "$NEWURI"; then
  echo "  ✓ redirect URI already present"
else
  UPDATED=$(echo "$EXISTING" | /usr/bin/jq -c ". + [\"$NEWURI\"]")
  az ad app update --id "$MS_APP_ID" --web-redirect-uris $(echo "$UPDATED" | /usr/bin/jq -r '.[]') -o none \
    && echo "  ✓ added $NEWURI"
fi

echo "══ 3. deployer role on prod RG ══"
DEPLOYER_APP_ID=$(az ad app list --display-name opal-portal-deployer --query '[0].appId' -o tsv)
SUB=$(az account show --query id -o tsv)
az role assignment create --assignee "$DEPLOYER_APP_ID" --role Contributor \
  --scope "/subscriptions/$SUB/resourceGroups/$PRG" -o none 2>/dev/null || true
echo "  ✓ Contributor on $PRG for opal-portal-deployer"

echo "══ 4. GitHub PRODUCTION_URL environment variable ══"
gh variable set PRODUCTION_URL --env production --repo "$REPO" --body "$PBASE" \
  && echo "  ✓ PRODUCTION_URL=$PBASE"

echo "Done. Trigger 'Deploy Production' (confirm phrase: deploy-production);"
echo "the run pauses at the deploy job for the owner's approval in GitHub."
