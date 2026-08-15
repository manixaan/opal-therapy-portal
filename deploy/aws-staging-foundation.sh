#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  MILESTONE 3B.1: AWS staging foundation for clinical AI (idempotent)
#
#  Prereq: `aws configure` / SSO as an ADMIN of a NON-PRODUCTION account,
#          and docs/AZURE_AWS_FEDERATION_IDENTITY_DISCOVERY.md completed
#          with OBSERVED token claims (Milestone 3A.1).
#
#  Usage:  TENANT_ID=... MI_CLIENT_ID=... APP_REG_CLIENT_ID=... \
#          OBSERVED_SUB=... OBSERVED_AZP=... \
#          bash deploy/aws-staging-foundation.sh
#
#  Creates (ap-southeast-2): CloudTrail (+S3, encrypted, log-file validation),
#  AWS Config (+S3, recorder, delivery channel), GuardDuty detector, an IAM
#  OIDC provider trusting one Entra tenant, and OpalAIStagingRuntimeRole.
#
#  ── THE ROLE HAS NO PERMISSIONS ──────────────────────────────────────────
#  Deliberate. This milestone proves ONLY that Azure identity federation
#  works. AssumeRoleWithWebIdentity must succeed; any Bedrock call must fail
#  with AccessDenied. Establish identity, verify protection, test failure,
#  THEN energise. Bedrock permissions are attached in 3B.2, after this has
#  been proven.
#
#  Writes an inventory to deploy/aws-staging-resources.txt.
#  Creates nothing in production. Creates no static credentials.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

REGION=${REGION:-ap-southeast-2}
ROLE=${ROLE:-OpalAIStagingRuntimeRole}
TRAIL=${TRAIL:-opal-ai-security-audit-staging}
INVENTORY="$(cd "$(dirname "$0")" && pwd)/aws-staging-resources.txt"

# ── Tag standard ───────────────────────────────────────────────────────────
# Applied to everything this script creates. Six months from now, when the
# account also holds logs, buckets, roles and detectors from other work, this
# is how you identify what belongs to clinical AI — and what must not be
# deleted, reused or loosened without reading the security architecture.
TAGS_CLI="Key=Application,Value=Opal Portal Key=Environment,Value=Staging \
Key=DataClassification,Value=Synthetic Key=Owner,Value=Opal Therapy \
Key=Purpose,Value=Clinical AI inference"

say() { printf '%s\n' "$*"; }
die() { printf '\n✗ %s\n' "$*" >&2; exit 1; }

# ═══ GUARD 1: identity claims must be OBSERVED, not guessed ════════════════
# An IAM trust policy is matched literally. A `sub` or `aud` that is one
# identifier-type wrong yields either a role nobody can assume or a condition
# that matches more than intended. Microsoft's own docs contradict each other
# about what `sub` contains, so it MUST come from a decoded token.
say "══ preflight: observed identity claims ══"
: "${TENANT_ID:?missing — run the §3 diagnostic in docs/AZURE_AWS_FEDERATION_IDENTITY_DISCOVERY.md first}"
: "${MI_CLIENT_ID:?missing — managed identity client ID from the discovery document}"
: "${APP_REG_CLIENT_ID:?missing — app registration client ID from the discovery document}"
: "${OBSERVED_SUB:?missing — the sub claim as READ FROM A REAL TOKEN (case-sensitive)}"
: "${OBSERVED_AZP:?missing — the azp claim as READ FROM A REAL TOKEN}"

GUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
for pair in "TENANT_ID:$TENANT_ID" "MI_CLIENT_ID:$MI_CLIENT_ID" "APP_REG_CLIENT_ID:$APP_REG_CLIENT_ID"; do
  name=${pair%%:*}; val=${pair#*:}
  [[ "$val" =~ $GUID_RE ]] || die "$name is not a GUID: '$val' — check you copied the right identifier (see §2 of the discovery document; Azure exposes six that look alike)"
done

# Placeholder detection. A trust policy built from template text is worse than
# no trust policy, because it looks configured.
for pair in "OBSERVED_SUB:$OBSERVED_SUB" "OBSERVED_AZP:$OBSERVED_AZP"; do
  name=${pair%%:*}; val=${pair#*:}
  case "$val" in
    *'{'*|*'}'*|*OBSERVED*|*observed*|*TODO*|*xxx*|*XXX*|*PLACEHOLDER*|*CHANGEME*)
      die "$name still looks like a placeholder: '$val' — §3.4 of the discovery document must be filled in from a decoded token" ;;
  esac
done

# AWS reads `azp` as the audience when present. If these differ, the audience
# condition is about to be wrong in a way that produces a confusing
# InvalidIdentityToken at assume time rather than an error here.
if [ "$OBSERVED_AZP" != "$MI_CLIENT_ID" ]; then
  say "⚠ OBSERVED_AZP ($OBSERVED_AZP) != MI_CLIENT_ID ($MI_CLIENT_ID)"
  say "  AWS uses azp as the audience. The trust condition will use the OBSERVED value."
  say "  If that is not what you expect, stop and re-check §4.2 of the discovery document."
  read -r -p "  Continue? [y/N] " ok; [ "$ok" = y ] || die "aborted"
fi
say "✓ identity claims present and well-formed"

# ═══ GUARD 2: this must not be the production account ══════════════════════
command -v aws >/dev/null || die "aws CLI not installed"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
CALLER=$(aws sts get-caller-identity --query Arn --output text)
say ""
say "══ target account ══"
say "  account : $ACCOUNT"
say "  caller  : $CALLER"
say "  region  : $REGION"
say ""
say "  This script creates a STAGING foundation. It must NOT run in the"
say "  account that serves clinical work."
read -r -p "  Type the account id to confirm this is non-production: " CONFIRM
[ "$CONFIRM" = "$ACCOUNT" ] || die "confirmation did not match — nothing created"

# Refuse to run anywhere but Australia, for the same reason the application does.
case "$REGION" in
  ap-southeast-2|ap-southeast-4) ;;
  *) die "REGION must be an Australian region (ap-southeast-2 / ap-southeast-4), got '$REGION'" ;;
esac

SUFFIX=$(printf '%s' "$ACCOUNT-$REGION" | shasum | cut -c1-8)
TRAIL_BUCKET="opal-ai-trail-stg-$SUFFIX"
CONFIG_BUCKET="opal-ai-config-stg-$SUFFIX"

# ═══ 1. CloudTrail — FIRST, so the first federated call is already audited ══
say ""
say "══ 1/5 CloudTrail ══"
if aws s3api head-bucket --bucket "$TRAIL_BUCKET" 2>/dev/null; then
  say "✓ bucket $TRAIL_BUCKET exists"
else
  aws s3api create-bucket --bucket "$TRAIL_BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  say "✓ created bucket $TRAIL_BUCKET"
fi
aws s3api put-public-access-block --bucket "$TRAIL_BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$TRAIL_BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-versioning --bucket "$TRAIL_BUCKET" \
  --versioning-configuration Status=Enabled

# CloudTrail needs explicit write permission, scoped to this trail.
aws s3api put-bucket-policy --bucket "$TRAIL_BUCKET" --policy "$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"AWSCloudTrailAclCheck","Effect":"Allow",
  "Principal":{"Service":"cloudtrail.amazonaws.com"},
  "Action":"s3:GetBucketAcl","Resource":"arn:aws:s3:::$TRAIL_BUCKET",
  "Condition":{"StringEquals":{"aws:SourceArn":"arn:aws:cloudtrail:$REGION:$ACCOUNT:trail/$TRAIL"}}},
 {"Sid":"AWSCloudTrailWrite","Effect":"Allow",
  "Principal":{"Service":"cloudtrail.amazonaws.com"},
  "Action":"s3:PutObject","Resource":"arn:aws:s3:::$TRAIL_BUCKET/AWSLogs/$ACCOUNT/*",
  "Condition":{"StringEquals":{"s3:x-amz-acl":"bucket-owner-full-control",
   "aws:SourceArn":"arn:aws:cloudtrail:$REGION:$ACCOUNT:trail/$TRAIL"}}}]}
JSON
)"
say "✓ bucket hardened (no public access, AES256, versioned, trail-scoped policy)"

if aws cloudtrail describe-trails --trail-name-list "$TRAIL" --region "$REGION" \
     --query 'trailList[0].Name' --output text 2>/dev/null | grep -q "$TRAIL"; then
  say "✓ trail $TRAIL exists"
else
  # Multi-region so a call in an unexpected region is still recorded, and log
  # file validation so the audit trail is tamper-evident.
  aws cloudtrail create-trail --name "$TRAIL" --s3-bucket-name "$TRAIL_BUCKET" \
    --is-multi-region-trail --enable-log-file-validation --region "$REGION" >/dev/null
  say "✓ created trail $TRAIL (multi-region, log-file validation)"
fi
aws cloudtrail start-logging --name "$TRAIL" --region "$REGION"
aws cloudtrail add-tags --resource-id "arn:aws:cloudtrail:$REGION:$ACCOUNT:trail/$TRAIL" \
  --tags-list Key=Application,Value="Opal Portal" Key=Environment,Value=Staging \
  Key=DataClassification,Value=Synthetic Key=Owner,Value="Opal Therapy" \
  Key=Purpose,Value="Clinical AI inference" --region "$REGION" 2>/dev/null || true
say "✓ logging started"

# ═══ 2. AWS Config — detects IAM / policy / region drift ═══════════════════
say ""
say "══ 2/5 AWS Config ══"
if aws s3api head-bucket --bucket "$CONFIG_BUCKET" 2>/dev/null; then
  say "✓ bucket $CONFIG_BUCKET exists"
else
  aws s3api create-bucket --bucket "$CONFIG_BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  say "✓ created bucket $CONFIG_BUCKET"
fi
aws s3api put-public-access-block --bucket "$CONFIG_BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$CONFIG_BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws s3api put-bucket-policy --bucket "$CONFIG_BUCKET" --policy "$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"AWSConfigBucketPermissionsCheck","Effect":"Allow",
  "Principal":{"Service":"config.amazonaws.com"},
  "Action":["s3:GetBucketAcl","s3:ListBucket"],"Resource":"arn:aws:s3:::$CONFIG_BUCKET",
  "Condition":{"StringEquals":{"AWS:SourceAccount":"$ACCOUNT"}}},
 {"Sid":"AWSConfigBucketDelivery","Effect":"Allow",
  "Principal":{"Service":"config.amazonaws.com"},
  "Action":"s3:PutObject","Resource":"arn:aws:s3:::$CONFIG_BUCKET/AWSLogs/$ACCOUNT/Config/*",
  "Condition":{"StringEquals":{"s3:x-amz-acl":"bucket-owner-full-control",
   "AWS:SourceAccount":"$ACCOUNT"}}}]}
JSON
)"
aws iam create-service-linked-role --aws-service-name config.amazonaws.com >/dev/null 2>&1 || true
aws configservice put-configuration-recorder --region "$REGION" \
  --configuration-recorder "name=default,roleARN=arn:aws:iam::$ACCOUNT:role/aws-service-role/config.amazonaws.com/AWSServiceRoleForConfig" \
  --recording-group allSupported=true,includeGlobalResourceTypes=true
aws configservice put-delivery-channel --region "$REGION" \
  --delivery-channel "name=default,s3BucketName=$CONFIG_BUCKET"
aws configservice start-configuration-recorder --region "$REGION" \
  --configuration-recorder-name default
say "✓ recorder + delivery channel active"

# ═══ 3. GuardDuty ══════════════════════════════════════════════════════════
say ""
say "══ 3/5 GuardDuty ══"
DETECTOR=$(aws guardduty list-detectors --region "$REGION" --query 'DetectorIds[0]' --output text)
if [ "$DETECTOR" = "None" ] || [ -z "$DETECTOR" ]; then
  DETECTOR=$(aws guardduty create-detector --enable --region "$REGION" \
    --tags Application="Opal Portal",Environment=Staging,Owner="Opal Therapy" \
    --query DetectorId --output text)
  say "✓ created detector $DETECTOR"
else
  say "✓ detector $DETECTOR exists"
fi

# ═══ 4. IAM OIDC provider — trusts ONE Entra tenant ════════════════════════
say ""
say "══ 4/5 IAM OIDC provider ══"
ISSUER="https://login.microsoftonline.com/$TENANT_ID/v2.0"
OIDC_ARN="arn:aws:iam::$ACCOUNT:oidc-provider/login.microsoftonline.com/$TENANT_ID/v2.0"

if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  say "✓ provider exists for tenant $TENANT_ID"
else
  # No thumbprint: AWS has auto-retrieved it for publicly-trusted CAs since
  # July 2024, and login.microsoftonline.com uses one. If this errors asking
  # for a thumbprint, the CLI is older than that change — upgrade rather than
  # supplying a value you cannot verify.
  #
  # BOTH client IDs are registered. AWS prefers the `azp` claim (the managed
  # identity) over `aud` (the app registration); registering both makes the
  # provider correct either way. The trust CONDITION below still pins the
  # observed value.
  aws iam create-open-id-connect-provider \
    --url "$ISSUER" \
    --client-id-list "$MI_CLIENT_ID" "$APP_REG_CLIENT_ID" \
    --tags Key=Application,Value="Opal Portal" Key=Environment,Value=Staging \
           Key=Owner,Value="Opal Therapy" Key=Purpose,Value="Clinical AI inference" \
    >/dev/null
  say "✓ created provider (audiences: MI + app registration)"
fi
say "  issuer: $ISSUER"

# ═══ 5. The runtime role — assumable, but able to do NOTHING ═══════════════
say ""
say "══ 5/5 $ROLE ══"
TRUST=$(cat <<JSON
{"Version":"2012-10-17","Statement":[{
  "Sid":"OpalStagingFederatedAssume",
  "Effect":"Allow",
  "Principal":{"Federated":"$OIDC_ARN"},
  "Action":"sts:AssumeRoleWithWebIdentity",
  "Condition":{"StringEquals":{
    "login.microsoftonline.com/$TENANT_ID/v2.0:aud":"$OBSERVED_AZP",
    "login.microsoftonline.com/$TENANT_ID/v2.0:oaud":"$APP_REG_CLIENT_ID",
    "login.microsoftonline.com/$TENANT_ID/v2.0:sub":"$OBSERVED_SUB"
  }}}]}
JSON
)
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "$TRUST"
  say "✓ role exists — trust policy updated to observed claims"
else
  aws iam create-role --role-name "$ROLE" \
    --assume-role-policy-document "$TRUST" \
    --max-session-duration 3600 \
    --description "Milestone 3B.1 — federation proof only. NO permissions until 3B.2." \
    --tags Key=Application,Value="Opal Portal" Key=Environment,Value=Staging \
           Key=DataClassification,Value=Synthetic Key=Owner,Value="Opal Therapy" \
           Key=Purpose,Value="Clinical AI inference" >/dev/null
  say "✓ created role"
fi

ATTACHED=$(aws iam list-attached-role-policies --role-name "$ROLE" --query 'length(AttachedPolicies)' --output text)
INLINE=$(aws iam list-role-policies --role-name "$ROLE" --query 'length(PolicyNames)' --output text)
if [ "$ATTACHED" != "0" ] || [ "$INLINE" != "0" ]; then
  say "⚠ role has $ATTACHED attached and $INLINE inline policies — 3B.1 expects ZERO."
  say "  Federation cannot be proven in isolation if the role can already act."
else
  say "✓ no permissions attached — assume must succeed, Bedrock must be denied"
fi

# ═══ Inventory ═════════════════════════════════════════════════════════════
{
  printf '# AWS staging foundation — Milestone 3B.1\n'
  printf '# Generated by deploy/aws-staging-foundation.sh\n'
  printf '# Account %s / region %s\n\n' "$ACCOUNT" "$REGION"
  printf 'cloudtrail.trail          %s\n' "arn:aws:cloudtrail:$REGION:$ACCOUNT:trail/$TRAIL"
  printf 'cloudtrail.bucket         %s\n' "s3://$TRAIL_BUCKET"
  printf 'config.bucket             %s\n' "s3://$CONFIG_BUCKET"
  printf 'config.recorder           default\n'
  printf 'guardduty.detector        %s\n' "$DETECTOR"
  printf 'iam.oidc_provider         %s\n' "$OIDC_ARN"
  printf 'iam.role                  %s\n' "arn:aws:iam::$ACCOUNT:role/$ROLE"
  printf 'iam.role.permissions      NONE (by design until 3B.2)\n'
  printf '\n# Trust conditions (from observed token claims)\n'
  printf 'trust.aud   %s\n' "$OBSERVED_AZP"
  printf 'trust.oaud  %s\n' "$APP_REG_CLIENT_ID"
  printf 'trust.sub   %s\n' "$OBSERVED_SUB"
  printf '\n# Tags applied to all resources\n'
  printf 'Application=Opal Portal  Environment=Staging  DataClassification=Synthetic\n'
  printf 'Owner=Opal Therapy  Purpose=Clinical AI inference\n'
} > "$INVENTORY"

say ""
say "══ done ══"
say "  inventory: $INVENTORY"
say ""
say "  NEXT — prove federation before attaching any permission:"
say "    1. From the App Service, obtain an Entra token (discovery doc §3.2)."
say "    2. aws sts assume-role-with-web-identity \\"
say "         --role-arn arn:aws:iam::$ACCOUNT:role/$ROLE \\"
say "         --role-session-name opal-federation-proof \\"
say "         --web-identity-token \"\$TOKEN\""
say "       EXPECT: success, credentials valid ~1 hour."
say "    3. With those credentials, call Bedrock."
say "       EXPECT: AccessDenied. The role has no permissions — that is the point."
say "    4. Confirm both in CloudTrail."
say ""
say "  Only when 2 and 3 both behave as expected does 3B.2 attach Bedrock access."
