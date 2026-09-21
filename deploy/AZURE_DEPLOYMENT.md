# Azure Deployment & Operations — Opal Therapy Employee Portal

Target: `portal.opaltherapy.com.au` · Region: **Australia East** · Environments: dev (local) / staging / production

> **Status legend used throughout:**
> ✅ *Completed in repository* · 🔑 *Requires Antony (Azure account) action* · 🏢 *Requires Microsoft administrator action* · 🌐 *Requires DNS action* · 🩺 *Requires Splose credentials* · ⏸ *Deferred until production*

---

## 1. Architecture

```
                      ┌─────────────────────────────────────────────┐
   Browser ──HTTPS──► │ Azure App Service (Linux, Node 22 LTS)      │
   (portal.opal…)     │  Express + Socket.IO + static frontend      │
                      │  startup.sh → migrate → node server.js      │
                      └──────┬───────────────┬──────────────┬───────┘
                             │               │              │
              ┌──────────────▼──┐   ┌────────▼────────┐  ┌──▼───────────────┐
              │ Azure Database   │   │ Azure Key Vault │  │ Azure Blob       │
              │ for PostgreSQL   │   │ (secrets via    │  │ Storage (private │
              │ Flexible Server  │   │  KV references) │  │ employee-docs)   │
              └──────────────────┘   └─────────────────┘  └──────────────────┘
                             │
              ┌──────────────▼──────────────┐     External: Microsoft Graph
              │ Application Insights        │     (Outlook), Splose API,
              │ (redacted telemetry)        │     SMTP, Google Maps
              └─────────────────────────────┘
```

Resource naming (logical):

| Environment | Resource group | App Service | PostgreSQL | Key Vault | Storage |
|---|---|---|---|---|---|
| staging | `opal-portal-staging` | `opal-portal-staging` | `opal-portal-staging-pg` | `opal-portal-staging-kv` | `opalportalstagingsa` |
| production | `opal-portal-prod` | `opal-portal-prod` | `opal-portal-prod-pg` | `opal-portal-prod-kv` | `opalportalprodsa` |

Dev remains local (localhost + local PostgreSQL) — no Azure dev resources are required for the pilot.

---

## 2. Initial resource setup 🔑

Run once per environment (shown for staging; repeat with `prod` substitutions).
Requires `az login` on Antony's Azure subscription.

```bash
LOC=australiaeast
RG=opal-portal-staging

az group create --name $RG --location $LOC

# ── PostgreSQL Flexible Server ────────────────────────────────────────────
# B1ms is sufficient for the pilot; 14-day PITR window; TLS is enforced by default.
az postgres flexible-server create \
  --resource-group $RG --name opal-portal-staging-pg --location $LOC \
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 \
  --version 16 --backup-retention 14 \
  --admin-user opaladmin --admin-password '<GENERATE-STRONG-PASSWORD>' \
  --public-access 0.0.0.0   # Azure-services-only; tighten later (see §11)

az postgres flexible-server db create \
  --resource-group $RG --server-name opal-portal-staging-pg \
  --database-name opal_portal

# ── App Service ───────────────────────────────────────────────────────────
az appservice plan create --resource-group $RG --name opal-portal-staging-plan \
  --location $LOC --is-linux --sku B1
az webapp create --resource-group $RG --plan opal-portal-staging-plan \
  --name opal-portal-staging --runtime "NODE:22-lts"

# WebSockets (Socket.IO), Always On (background sync pollers), HTTPS only
az webapp config set --resource-group $RG --name opal-portal-staging \
  --web-sockets-enabled true --always-on true \
  --startup-file "bash /home/site/wwwroot/backend/startup.sh"
az webapp update --resource-group $RG --name opal-portal-staging --https-only true
az webapp config set --resource-group $RG --name opal-portal-staging --min-tls-version 1.2

# System-assigned managed identity (used for Key Vault + Blob)
az webapp identity assign --resource-group $RG --name opal-portal-staging

# ── Key Vault ─────────────────────────────────────────────────────────────
az keyvault create --resource-group $RG --name opal-portal-staging-kv --location $LOC
PRINCIPAL=$(az webapp identity show -g $RG -n opal-portal-staging --query principalId -o tsv)
az role assignment create --assignee $PRINCIPAL \
  --role "Key Vault Secrets User" \
  --scope $(az keyvault show -n opal-portal-staging-kv --query id -o tsv)

# ── Blob Storage (private container for employee documents) ──────────────
az storage account create --resource-group $RG --name opalportalstagingsa \
  --location $LOC --sku Standard_LRS --kind StorageV2 \
  --allow-blob-public-access false --min-tls-version TLS1_2
az storage container create --account-name opalportalstagingsa \
  --name employee-documents --public-access off --auth-mode login

# ── Application Insights ──────────────────────────────────────────────────
az monitor app-insights component create --resource-group $RG \
  --app opal-portal-staging-ai --location $LOC --application-type web
```

Notes:
- **Node runtime**: App Service's newest LTS runtime is `NODE:22-lts`, inside the repo's `engines` range (`>=20 <27`). The `.nvmrc` (26) is a local-dev target; App Service pins 22 LTS. ✅ tested nothing Node-26-specific is required.
- **`--public-access 0.0.0.0`** means "Azure services only" — acceptable for the pilot; §11 documents the private-endpoint upgrade.
- **PORT**: App Service injects `PORT`; `server.js` already honours it. ✅

---

## 3. Secrets — Key Vault + App Settings 🔑 (values) / ✅ (mechanism)

**Never put these in Git, source, workflow files, frontend JS, or docs.**
Store secrets in Key Vault; reference them from App Settings so they never
appear in the portal configuration as plaintext:

```bash
KV=opal-portal-staging-kv
az keyvault secret set --vault-name $KV --name db-password           --value '<pg password>'
az keyvault secret set --vault-name $KV --name session-secret        --value "$(openssl rand -base64 48)"
az keyvault secret set --vault-name $KV --name token-encryption-key  --value "$(openssl rand -hex 32)"
az keyvault secret set --vault-name $KV --name microsoft-client-secret --value '<from Entra app>'      # 🏢
az keyvault secret set --vault-name $KV --name splose-api-key        --value '<from Splose>'           # 🩺
az keyvault secret set --vault-name $KV --name email-pass            --value '<SMTP password>'
az keyvault secret set --vault-name $KV --name google-maps-api-key   --value '<Maps key>'
az keyvault secret set --vault-name $KV --name storage-connection    --value '<storage conn string>'   # until managed-identity blob auth (§12)
az keyvault secret set --vault-name $KV --name webhook-client-state  --value "$(openssl rand -hex 24)"
```

App Settings (Key Vault references resolve via the managed identity):

```bash
RG=opal-portal-staging APP=opal-portal-staging KVURI=https://opal-portal-staging-kv.vault.azure.net
az webapp config appsettings set -g $RG -n $APP --settings \
  NODE_ENV=staging \
  APP_BASE_URL=https://opal-portal-staging.azurewebsites.net \
  ALLOWED_ORIGINS=https://opal-portal-staging.azurewebsites.net \
  DB_HOST=opal-portal-staging-pg.postgres.database.azure.com \
  DB_PORT=5432 DB_NAME=opal_portal DB_USER=opaladmin DB_SSL=true \
  "DB_PASSWORD=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/db-password/)" \
  "SESSION_SECRET=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/session-secret/)" \
  "TOKEN_ENCRYPTION_KEY=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/token-encryption-key/)" \
  MICROSOFT_CLIENT_ID='<staging app registration client id>' \
  MICROSOFT_TENANT_ID='<tenant id>' \
  "MICROSOFT_CLIENT_SECRET=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/microsoft-client-secret/)" \
  MICROSOFT_REDIRECT_URI=https://opal-portal-staging.azurewebsites.net/auth/oauth/callback \
  "SPLOSE_API_KEY=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/splose-api-key/)" \
  EMAIL_HOST='<smtp host>' EMAIL_PORT=587 EMAIL_USER='<smtp user>' \
  "EMAIL_PASS=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/email-pass/)" \
  "GOOGLE_MAPS_API_KEY=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/google-maps-api-key/)" \
  DOCUMENT_STORAGE_BACKEND=blob \
  "AZURE_STORAGE_CONNECTION_STRING=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/storage-connection/)" \
  AZURE_STORAGE_CONTAINER=employee-documents \
  "WEBHOOK_CLIENT_STATE=@Microsoft.KeyVault(SecretUri=$KVURI/secrets/webhook-client-state/)" \
  WEBHOOK_BASE_URL=https://opal-portal-staging.azurewebsites.net \
  MIGRATE_ALLOW_PRODUCTION=true \
  APPLICATIONINSIGHTS_CONNECTION_STRING='<from App Insights resource>' \
  ALLOWED_EMAILS='<first owner email — required for first registration>' \
  SYNC_MAX_AUTO_DELETE=25 SYNC_MAX_DELETE_PERCENT=30
```

`env-validation.js` refuses to boot staging/production with missing or weak
critical values ✅ — a misconfigured deploy fails loudly at startup, and
`/ready` reports `config: issues:N`.

---

## 4. Microsoft Entra app registrations 🏢

One registration **per environment** (staging, production) so tokens and
consent are isolated:

1. Entra ID → App registrations → New: `Opal Portal (Staging)` / `Opal Portal (Production)`.
2. Redirect URI (Web):
   - staging: `https://opal-portal-staging.azurewebsites.net/auth/oauth/callback`
   - production: `https://portal.opaltherapy.com.au/auth/oauth/callback`
3. API permissions (delegated): `openid`, `profile`, `email`, `offline_access`, `User.Read`, `Calendars.ReadWrite` → grant admin consent.
4. Certificates & secrets → new client secret → put the **value** in Key Vault (`microsoft-client-secret`). Record the expiry date (§13 rotation).
5. Copy Application (client) ID and Directory (tenant) ID into App Settings.

Future Entra ID SSO for employee login is prepared for (email/password stays
primary for the pilot) — the same registrations can gain SSO scopes later.

---

## 5. GitHub configuration 🔑

### 5.1 Federated identity (OIDC — recommended, no stored cloud credentials)

```bash
# One app registration for deployments, federated to this repo's environments
az ad app create --display-name opal-portal-deployer
APP_ID=<appId from output>
az ad sp create --id $APP_ID

# Federated credentials — one per GitHub environment
az ad app federated-credential create --id $APP_ID --parameters '{
  "name": "github-staging",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:<OWNER>/<REPO>:environment:staging",
  "audiences": ["api://AzureADTokenExchange"]
}'
az ad app federated-credential create --id $APP_ID --parameters '{
  "name": "github-production",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:<OWNER>/<REPO>:environment:production",
  "audiences": ["api://AzureADTokenExchange"]
}'

# Grant the deployer contributor rights on each resource group
az role assignment create --assignee $APP_ID --role Contributor \
  --scope /subscriptions/<SUB>/resourceGroups/opal-portal-staging
az role assignment create --assignee $APP_ID --role Contributor \
  --scope /subscriptions/<SUB>/resourceGroups/opal-portal-prod
```

### 5.2 GitHub repo settings

- **Environments**: create `staging` and `production`.
  - `production` → **Required reviewers: Antony** (this is the manual
    production gate — the deploy job pauses until approved).
- **Environment secrets** (both environments): `AZURE_CLIENT_ID`,
  `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (ids, not passwords — OIDC has
  no secret material).
- **Environment variables** (optional): `STAGING_URL`, `PRODUCTION_URL`.
- Workflows contain **no credentials** ✅ — verified by review; CI itself uses
  only a throwaway service-container database.

### 5.3 Pipeline flow ✅

```
PR / push → ci.yml: npm ci → syntax check → unit tests → integration tests
            (PostgreSQL service container) → migration validation (fresh DB,
            idempotent re-run, status) → npm audit (zero-vuln gate) → package
push main → deploy-staging.yml: CI gate → OIDC login → deploy →
            /health gate → /ready gate → smoke tests (routing, CSP header)
manual    → deploy-production.yml: confirmation phrase → CI gate →
            environment approval (human) → deploy → health/ready gate →
            smoke tests (incl. HSTS check)
```

Failed tests, failed migrations, or failed health checks stop the pipeline ✅.

---

## 6. Database operations

### 6.1 Migration procedure ✅

Migrations run **on the App Service at startup** (`backend/startup.sh`):
deploy → instance restarts → `node migrate.js up` (advisory-locked, so
multiple instances cannot interleave) → `node server.js`. Fail-closed: a
failed migration prevents startup and `/ready` stays red.

Manual run (e.g. pre-deploy verification) from a machine with DB access:

```bash
DB_HOST=… DB_NAME=opal_portal DB_USER=opaladmin DB_PASSWORD=… DB_SSL=true \
NODE_ENV=production node migrate.js status
# then, deliberately:
… node migrate.js up --yes
```

### 6.2 Backup & restore 🔑 / ⏸

- **Automated**: Flexible Server PITR, `--backup-retention 14` (14 days).
- **Restore drill** (run once before pilot go-live, and quarterly):

```bash
az postgres flexible-server restore \
  --resource-group opal-portal-prod --name opal-portal-prod-pg-restored \
  --source-server opal-portal-prod-pg \
  --restore-time "2026-07-14T02:00:00Z"
# Verify: connect, run `node migrate.js status`, spot-check row counts.
# To adopt the restore: repoint DB_HOST app setting → restart app.
```

- Restores create a **new server** — the live server is never overwritten.
- Verify after restore: `SELECT COUNT(*) FROM users;` matches expectation,
  `node migrate.js status` shows all applied, app `/ready` green against it.

### 6.3 Rollback & migration compatibility ✅ (policy)

- **App rollback**: re-deploy the previous `deploy.zip` artifact (retained 14
  days) via `az webapp deploy -g <rg> -n <app> --src-path deploy.zip --type zip`,
  or re-run the deploy workflow from the previous good commit.
- **Migration policy**: migrations must be **backwards-compatible one version**
  (additive: new columns nullable/defaulted, no drops/renames in the same
  release that removes the old reader). Under that policy, rolling the app
  back one version never requires a schema rollback.
- Migrations that cannot roll back (data-destructive) must ship behind a
  restore-verified backup and be flagged in the PR description.

---

## 7. Custom domain + HTTPS 🌐 / 🔑

1. DNS (wherever opaltherapy.com.au is hosted): 🌐
   - `CNAME portal → opal-portal-prod.azurewebsites.net`
   - TXT verification record as shown by:
     `az webapp config hostname get-external-ip / az webapp config hostname add …`
2. `az webapp config hostname add -g opal-portal-prod --webapp-name opal-portal-prod --hostname portal.opaltherapy.com.au` 🔑
3. Managed certificate (free, auto-renewing):
   `az webapp config ssl create -g opal-portal-prod -n opal-portal-prod --hostname portal.opaltherapy.com.au` then bind SNI. 🔑
4. Update `APP_BASE_URL`, `ALLOWED_ORIGINS`, `MICROSOFT_REDIRECT_URI`,
   `WEBHOOK_BASE_URL` app settings to the custom domain. 🔑
5. Update the production Entra redirect URI to the custom domain. 🏢
6. Verify: `curl -I https://portal.opaltherapy.com.au/health` → 200, valid
   cert, `strict-transport-security` header present.

---

## 8. Monitoring & alerts 🔑 (setup) / ✅ (app-side)

App-side ✅: `/health`, `/ready`, structured redacted logs, optional App
Insights with a redacting telemetry processor, correlation IDs.

Recommended Azure alert rules (per environment):

| Signal | Rule | Why |
|---|---|---|
| Availability | URL ping test on `/health` from 2+ regions, alert on 2 consecutive failures | app down |
| Readiness | URL ping test on `/ready` (expect 200) | DB/migration/config trouble while process alive |
| HTTP 5xx | `requests | where resultCode >= 500` count > 5 in 15 min | regressions |
| Slow requests | avg duration > 3 s over 15 min | DB or Graph latency |
| Exceptions | any `exceptions` spike | unhandled errors (auto-collected) |
| `sync.safety_block` customEvent | any occurrence | mass-deletion guard fired — investigate before clearing |
| Failed logins | `customEvents/audit` — `login_failed` > 20 in 15 min | credential-stuffing attempt |

Log stream: `az webapp log tail -g <rg> -n <app>` (structured JSON lines).

---

## 9. Emergency procedures

| Scenario | Action |
|---|---|
| **Emergency shutdown** | `az webapp stop -g opal-portal-prod -n opal-portal-prod` (stateless app; sessions persist in PG; sync pollers stop cleanly — SIGTERM drain ✅) |
| Compromised secret | Rotate in Key Vault (§13) → `az webapp restart` (KV references re-resolve) |
| Bad deploy | Rollback per §6.3 |
| Runaway sync deletions | Already fail-closed by sync-safety thresholds ✅; owners are notified in-app; clear via diagnostics after investigation |
| Database emergency | PITR restore (§6.2) to new server, repoint `DB_HOST` |

---

## 10. Secret rotation 🔑 (quarterly, or immediately on suspicion)

1. Generate new value (`openssl rand -base64 48` / `-hex 32`).
2. `az keyvault secret set --vault-name <kv> --name <secret> --value '<new>'`.
3. `az webapp restart` — Key Vault references pick up the new version.
4. Special cases:
   - **TOKEN_ENCRYPTION_KEY**: rotating invalidates stored Outlook tokens —
     employees simply reconnect Outlook (no data loss). Schedule with notice.
   - **SESSION_SECRET**: signs the session cookie id; rotating signs users out.
   - **Microsoft client secret**: create the new secret in Entra *first* 🏢,
     update Key Vault, then delete the old one after verification.
   - **DB password**: `az postgres flexible-server update --admin-password` +
     Key Vault update in one maintenance window.

---

## 11. Network security — pilot vs. later ⏸

Pilot posture (documented, acceptable for limited pilot):
- PG Flexible Server "Azure services only" firewall + TLS enforced + strong password.
- Blob container private; access only through the app's authenticated route ✅.
- App Service HTTPS-only, TLS ≥ 1.2, HSTS via helmet ✅.

Post-pilot upgrade path ⏸: VNet integration for App Service + private
endpoints for PG/Storage/Key Vault, removing all public database exposure.

---

## 12. Blob auth: managed identity pathway ⏸

The storage abstraction currently authenticates with a connection string
(via Key Vault ✅). The managed-identity upgrade (no secret at all) is:
`DefaultAzureCredential` + `Storage Blob Data Contributor` role for the app
identity — a small change isolated to `storage/index.js` (`makeAzureBackend`),
documented here so it can ship as a follow-up migration without touching
routes. Existing DB-stored documents migrate per `backend/migrations/README.md`.

---

## 13. External-action summary

| # | Action | Who |
|---|---|---|
| 1 | Create Azure subscription resources (§2, staging + prod) | 🔑 Antony |
| 2 | Set Key Vault secret values (§3) | 🔑 Antony |
| 3 | Entra app registrations + consent + client secrets (§4) | 🏢 Microsoft admin (likely Antony) |
| 4 | GitHub environments, OIDC federated credential, 3 id secrets (§5) | 🔑 Antony |
| 5 | DNS CNAME + TXT for portal.opaltherapy.com.au (§7) | 🌐 domain host |
| 6 | Production Splose API key into Key Vault (§3) | 🩺 Splose |
| 7 | SMTP credentials into Key Vault (§3) | 🔑 Antony |
| 8 | Alert rules + availability tests (§8) | 🔑 Antony |
| 9 | Restore drill before go-live (§6.2) | 🔑 Antony |
| 10 | VNet/private endpoints; managed-identity blob auth | ⏸ post-pilot |

## Fast deploys — run from package (added 21 Sep 2026)

A staging deploy used to take ~35 minutes: 13 for the gate and 21 for Azure to
unpack the bundle (thousands of `node_modules` files) onto the `/home` network
share. Two changes bring it to roughly 8:

1. **The gate runs side by side** (`ci.yml`): one job for unit tests, syntax,
   migration validation and audit; four integration shards, each with its own
   PostgreSQL. Same tests, same pass/fail — about 4 minutes instead of 13.
2. **The bundle is mounted, not unpacked.** With the app setting
   `WEBSITE_RUN_FROM_PACKAGE=1`, App Service keeps the zip under
   `/home/data/SitePackages` and mounts it read-only at `/home/site/wwwroot`.
   The deploy workflow needs no change; with the setting off it still works,
   slowly.

Because the application folder becomes **read-only**, nothing may be written
beside the code. On App Service the two local stores default to
`/home/data/opal/resource-hub-files` and `/home/data/opal/local-documents`
(writable, persistent), and `backend/startup.sh` copies anything an earlier
deployment kept beside the code, once, without overwriting.

**Order matters.** Deploy the code that contains the copy step FIRST, confirm
`/ready`, and only then switch the setting on:

Azure portal → `opal-portal-staging` → Settings → Environment variables →
**+ Add** → Name `WEBSITE_RUN_FROM_PACKAGE`, Value `1` → Apply → Confirm.

To go back: delete the setting and redeploy. Production is unchanged until the
same two steps are done there deliberately.
