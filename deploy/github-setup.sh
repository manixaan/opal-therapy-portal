#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  STAGE 2: GitHub repository protection + environments (idempotent)
#
#  Prereq: the private repo exists and `origin` points at it (owner-created).
#  Usage:  bash deploy/github-setup.sh <owner/repo>
#
#  Configures: branch protection on main (CI checks required, PRs required,
#  no force-push/deletion), staging + production environments, production
#  required-reviewer = repo owner (the manual production gate).
#  AZURE_* environment secrets are set later by deploy/github-azure-oidc.sh.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
REPO=${1:?usage: github-setup.sh <owner/repo>}
OWNER=${REPO%%/*}

echo "══ branch protection: main ══"
gh api -X PUT "repos/$REPO/branches/main/protection" \
  --input - > /dev/null <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Unit + integration tests"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
echo "✓ main protected (CI check + PR required, no force-push)"

echo "══ environments ══"
OWNER_ID=$(gh api "users/$OWNER" --jq .id)
gh api -X PUT "repos/$REPO/environments/staging" > /dev/null
echo "✓ staging environment"
gh api -X PUT "repos/$REPO/environments/production" \
  --input - > /dev/null <<JSON
{
  "reviewers": [{ "type": "User", "id": $OWNER_ID }],
  "deployment_branch_policy": { "protected_branches": true, "custom_branch_policies": false }
}
JSON
echo "✓ production environment (required reviewer: $OWNER, protected branches only)"

echo "Done. Next: deploy/github-azure-oidc.sh (after az login) wires the AZURE_* secrets."
