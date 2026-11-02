#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  Opal Assist + Opa — switch on, November 2026.
#
#  Owner-authorised (2 Nov 2026): Opal Assist (the rephrase/rewrite chat at
#  /assist) and Opa on, in staging AND production. Both go through the AI
#  gateway with de-identification required and the Bedrock guardrail.
#
#    bash deploy/assist-enable-2026-11.sh check
#        read-only: which AI settings each App Service has (names and on/off
#        only — nothing secret is printed).
#
#    bash deploy/assist-enable-2026-11.sh enable
#        sets OPAL_ASSIST_ENABLED=true and OPA_AI_ENABLED=true on staging and
#        production and restarts each. REFUSES an app that has no Bedrock
#        connection yet (AWS_ROLE_ARN / model / guardrail missing) — switching
#        the flag on there would only show "unavailable". For production that
#        connection is deploy/prod-ai-enable-2026-10.sh.
#
#    bash deploy/assist-enable-2026-11.sh verify
#
#  Rollback: set OPAL_ASSIST_ENABLED=false (or AI_GLOBAL_DISABLE=true) on the
#  App Service and restart.
#
#  Prereq: `az login` as the subscription owner.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

APPS="opal-portal-staging:opal-portal-staging-rg opal-portal-prod:opal-portal-prod-rg"
NEEDED="AWS_REGION AWS_ROLE_ARN AZURE_BEDROCK_AUDIENCE BEDROCK_MODEL_ID_ASSISTANT_FAST BEDROCK_GUARDRAIL_ID BEDROCK_GUARDRAIL_VERSION"

val() { az webapp config appsettings list -g "$2" -n "$1" --query "[?name=='$3'].value | [0]" -o tsv; }

case "${1:-}" in
check)
  for pair in $APPS; do
    APP=${pair%%:*}; RG=${pair##*:}
    echo "── $APP"
    for n in $NEEDED; do
      if [ -n "$(val "$APP" "$RG" "$n")" ]; then printf '  %-34s set\n' "$n"; else printf '  %-34s MISSING\n' "$n"; fi
    done
    for n in OPAL_ASSIST_ENABLED OPA_AI_ENABLED CLINICAL_NOTE_AI_ENABLED AI_GLOBAL_DISABLE; do
      printf '  %-34s %s\n' "$n" "$(val "$APP" "$RG" "$n" | tr -d '[:space:]' || true)"
    done
  done
  ;;

enable)
  for pair in $APPS; do
    APP=${pair%%:*}; RG=${pair##*:}
    missing=""
    for n in $NEEDED; do [ -n "$(val "$APP" "$RG" "$n")" ] || missing="$missing $n"; done
    if [ -n "$missing" ]; then
      echo "✗ $APP has no Bedrock connection yet (missing:$missing) — not switched on."
      continue
    fi
    if [ "$(val "$APP" "$RG" AI_GLOBAL_DISABLE | tr -d '[:space:]')" = "true" ]; then
      echo "! $APP has AI_GLOBAL_DISABLE=true — the kill switch stays in charge; flags set anyway."
    fi
    az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings OPAL_ASSIST_ENABLED=true OPA_AI_ENABLED=true
    echo "  ✓ $APP: OPAL_ASSIST_ENABLED=true OPA_AI_ENABLED=true"
    az webapp restart -g "$RG" -n "$APP"
    echo "  ✓ $APP restarted"
  done
  ;;

verify)
  for base in https://opal-portal-staging.azurewebsites.net https://opal-portal-prod.azurewebsites.net; do
    echo "── $base/ready"; curl -s --max-time 20 "$base/ready"; echo
  done
  echo "── Then sign in, open /assist: the pill top-right should say Ready (not 'Not switched on')."
  ;;

*)
  echo "Usage: bash deploy/assist-enable-2026-11.sh check|enable|verify"; exit 2 ;;
esac
