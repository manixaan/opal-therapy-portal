#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  STAGE 2/4: GitHub↔Azure OIDC federation (idempotent)
#
#  Prereq: az login (subscription owner) + repo exists.
#  Usage:  bash deploy/github-azure-oidc.sh <owner/repo>
#
#  Creates the deployer app registration + service principal, federated
#  credentials for the staging and production GitHub environments, grants
#  Contributor on the staging resource group, and writes the three AZURE_*
#  id secrets (NOT passwords — OIDC has no secret material) to both GitHub
#  environments.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
REPO=${1:?usage: github-azure-oidc.sh <owner/repo>}
RG=${RG:-opal-portal-staging-rg}

echo "══ deployer app registration ══"
APP_ID=$(az ad app list --display-name opal-portal-deployer --query '[0].appId' -o tsv)
if [ -z "$APP_ID" ]; then
  APP_ID=$(az ad app create --display-name opal-portal-deployer --query appId -o tsv)
  echo "✓ created opal-portal-deployer"
else
  echo "✓ opal-portal-deployer exists"
fi
az ad sp create --id "$APP_ID" -o none 2>/dev/null || true

echo "══ federated credentials (per GitHub environment) ══"
for ENVNAME in staging production; do
  az ad app federated-credential create --id "$APP_ID" --parameters "{
    \"name\": \"github-$ENVNAME\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:$REPO:environment:$ENVNAME\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" -o none 2>/dev/null && echo "✓ federated: $ENVNAME" || echo "✓ federated exists: $ENVNAME"
done

echo "══ role assignment (staging RG only — production RG comes later) ══"
SUB=$(az account show --query id -o tsv)
az role assignment create --assignee "$APP_ID" --role Contributor \
  --scope "/subscriptions/$SUB/resourceGroups/$RG" -o none 2>/dev/null || true
echo "✓ Contributor on $RG"

echo "══ GitHub environment secrets (ids only — no passwords exist in OIDC) ══"
TENANT=$(az account show --query tenantId -o tsv)
for ENVNAME in staging production; do
  gh secret set AZURE_CLIENT_ID       --env "$ENVNAME" --repo "$REPO" --body "$APP_ID"
  gh secret set AZURE_TENANT_ID       --env "$ENVNAME" --repo "$REPO" --body "$TENANT"
  gh secret set AZURE_SUBSCRIPTION_ID --env "$ENVNAME" --repo "$REPO" --body "$SUB"
  echo "✓ $ENVNAME secrets"
done
echo "Done. The Deploy Staging workflow can now authenticate to Azure."
