#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  PRODUCTION AI enablement, October 2026 — Opa + clinical case notes.
#
#  Owner-authorised (30 Oct 2026): both features on in production, with the
#  de-identification step and guardrail OpalClinicalAIGuardrail as the net.
#  Run ONE step at a time:
#
#    bash deploy/prod-ai-enable-2026-10.sh identity
#        read-only: the production managed identity's claims, the staging AI
#        settings to mirror, and the IAM trust policy to paste into AWS.
#
#    (AWS account 847566517126: create OpalPortalProductionBedrockRole with
#     the printed trust policy and a copy of OpalPortalStagingBedrockRolePolicy.
#     The sts.windows.net OIDC provider already lists the audience. Done
#     30 Oct 2026 via CloudShell.)
#
#    bash deploy/prod-ai-enable-2026-10.sh settings <production role ARN>
#        applies the AI settings to opal-portal-prod and restarts it.
#
#    bash deploy/prod-ai-enable-2026-10.sh verify
#
#  Rollback: set OPA_AI_ENABLED=false CLINICAL_NOTE_AI_ENABLED=false (or
#  AI_GLOBAL_DISABLE=true) on opal-portal-prod and restart.
#
#  Prereq: `az login` as the subscription owner. Prints identifiers only —
#  no setting here is a secret (federation has no static credential).
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

APP=opal-portal-prod
RG=opal-portal-prod-rg
STG_APP=opal-portal-staging
STG_RG=opal-portal-staging-rg
BASE=https://opal-portal-prod.azurewebsites.net

# Settings copied verbatim from staging (all identifiers, none secret).
MIRRORED="AWS_REGION AZURE_BEDROCK_AUDIENCE BEDROCK_MODEL_ID BEDROCK_MODEL_ID_CLINICAL_STANDARD \
BEDROCK_MODEL_ID_CLINICAL_COMPLEX BEDROCK_MODEL_ID_ASSISTANT_FAST BEDROCK_GUARDRAIL_ID BEDROCK_GUARDRAIL_VERSION"

stg() { az webapp config appsettings list -g "$STG_RG" -n "$STG_APP" --query "[?name=='$1'].value | [0]" -o tsv; }

case "${1:-}" in
identity)
  TENANT=$(az account show --query tenantId -o tsv)
  # `az resource show`, not `az webapp show` (pyexpat crash on Homebrew Python).
  PRINCIPAL=$(az resource show -g "$RG" -n "$APP" --resource-type Microsoft.Web/sites --query identity.principalId -o tsv)
  [ -n "$PRINCIPAL" ] || { echo "✗ $APP has no system-assigned managed identity"; exit 1; }
  CLIENT=$(az ad sp show --id "$PRINCIPAL" --query appId -o tsv)
  AUD=$(stg AZURE_BEDROCK_AUDIENCE)
  echo "── Production managed identity"
  echo "  tenant          $TENANT"
  echo "  client id (azp) $CLIENT"
  echo "  object id (sub) $PRINCIPAL   (staging observed sub == oid, docs/AZURE_AWS_FEDERATION_IDENTITY_DISCOVERY.md §4.3)"
  echo "── Staging AI settings to mirror"
  for n in $MIRRORED; do printf '  %-36s %s\n' "$n" "$(stg "$n")"; done
  echo "── Trust policy for OpalPortalProductionBedrockRole"
  # Same shape as the live staging role (read 30 Oct 2026): the audience app
  # registration issues v1 tokens, so the issuer is sts.windows.net and the
  # pins are sub (the MI object id) + aud (AZURE_BEDROCK_AUDIENCE verbatim).
  cat <<JSON
{"Version":"2012-10-17","Statement":[{
  "Sid":"OpalProductionFederatedAssume",
  "Effect":"Allow",
  "Principal":{"Federated":"arn:aws:iam::847566517126:oidc-provider/sts.windows.net/$TENANT/"},
  "Action":"sts:AssumeRoleWithWebIdentity",
  "Condition":{"StringEquals":{
    "sts.windows.net/$TENANT/:sub":"$PRINCIPAL",
    "sts.windows.net/$TENANT/:aud":"$AUD"
  }}}]}
JSON
  ;;

settings)
  ROLE_ARN="${2:-}"
  [[ "$ROLE_ARN" =~ ^arn:aws:iam::[0-9]{12}:role/.+ ]] || { echo "Usage: … settings arn:aws:iam::<acct>:role/<name>"; exit 2; }
  ARGS=()
  for n in $MIRRORED; do
    v=$(stg "$n")
    [ -n "$v" ] && ARGS+=("$n=$v")
  done
  az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings "${ARGS[@]}" \
    AWS_ROLE_ARN="$ROLE_ARN" AWS_ROLE_SESSION_NAME=opal-portal-prod \
    OPA_AI_ENABLED=true CLINICAL_NOTE_AI_ENABLED=true
  echo "  ✓ AI settings applied: ${#ARGS[@]} mirrored + role, session name, both feature flags"
  az webapp restart -g "$RG" -n "$APP"
  echo "  ✓ restarted"
  ;;

verify)
  echo "── AI setting NAMES on production"
  az webapp config appsettings list -g "$RG" -n "$APP" --query "[].name" -o tsv \
    | grep -E '^(AWS_|AZURE_BEDROCK|BEDROCK_|OPA_AI|CLINICAL_NOTE_AI|AI_GLOBAL)' | sort | tr '\n' ' '; echo
  echo "── /ready"; curl -s --max-time 20 "$BASE/ready"; echo
  echo "── Then: open Opa in production and say hello (expect the 'Hi <name>' panel, then a reply)."
  ;;

*)
  echo "Usage: bash deploy/prod-ai-enable-2026-10.sh identity|settings <role-arn>|verify"; exit 2 ;;
esac
