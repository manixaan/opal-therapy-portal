# Production Environment Cutover Plan — Opal Therapy Portal

> Target: https://portal.opaltherapy.com.au · Region: Australia East
> Written as part of Stage 1 launch blockers (2026-07-31).

> ⚠️ **THIS PLAN CREATES NOTHING. It is preparation only.**
> No production Azure resources exist today and none are provisioned by this
> document. Every provisioning, DNS, Entra, and deployment step below requires
> explicit owner (Antony) approval before execution. Staging
> (`https://opal-portal-staging.azurewebsites.net`) is the only cloud
> environment currently running.

---

## 1. Current state

| Fact | Evidence |
|---|---|
| Production has **never been provisioned** — no prod RG, App Service, DB, KV, storage, or App Insights exists | `deploy/EXTERNAL_ACTIONS_CHECKLIST.md` §A item 2 unchecked; only `deploy/staging-resources.txt` exists |
| Staging is live: App Service `opal-portal-staging`, RG `opal-portal-staging-rg`, PG Flexible `opal-portal-staging-pg` (B1ms, PG16, 14-day PITR), KV `opal-portal-stg-kv` (RBAC), storage `opalstg9842d34e` (private container `employee-documents`), App Insights → Log Analytics | `deploy/staging-provision.sh`, `deploy/staging-resources.txt` |
| The production deploy pipeline **already exists** and targets app name `opal-portal-prod` + URL `https://portal.opaltherapy.com.au` | `.github/workflows/deploy-production.yml` (app-name line 70, URL fallback lines 54/76) |
| GitHub `production` environment, required-reviewer gate, and the three `AZURE_*` id secrets are already configured | `deploy/github-azure-oidc.sh` lines 54–61; `deploy/AZURE_DEPLOYMENT.md` §5.2 |
| OIDC federated credentials for `environment:production` already exist in **both** subject formats | `deploy/github-azure-oidc.sh` lines 28–46 (see §8) |
| Deployer has **no role on any production RG yet** | `deploy/github-azure-oidc.sh` line 48: "staging RG only — production RG comes later" |

---

## 2. Production resource names (recommended)

Mirror the staging pattern exactly (the pattern that was actually used, not the
older logical table in `deploy/AZURE_DEPLOYMENT.md` §1, which predates the
`-rg` suffix and the shortened KV name).

| Resource | Staging (actual) | Production (recommended) | Notes |
|---|---|---|---|
| Resource group | `opal-portal-staging-rg` | `opal-portal-prod-rg` | |
| App Service plan | `opal-portal-staging-plan` | `opal-portal-prod-plan` | Linux B1, **1 instance** (§13) |
| App Service | `opal-portal-staging` | `opal-portal-prod` | **Must be this name** — hardcoded in `deploy-production.yml`. Globally unique; if taken, change both the resource and the workflow |
| PostgreSQL Flexible | `opal-portal-staging-pg` | `opal-portal-prod-pg` | B1ms, PG16, 32 GB, `--backup-retention 14`, DB `opal_portal` |
| Key Vault | `opal-portal-stg-kv` | `opal-portal-prod-kv` | RBAC mode; 19 chars, inside the 24-char limit; fall back to `opal-portal-prd-kv` if taken |
| Storage account | `opalstg9842d34e` | `opalprod<4-hex>` (generated) | 3–24 lowercase alnum, globally unique; container `employee-documents`, private |
| Log Analytics | `opal-portal-staging-law` | `opal-portal-prod-law` | |
| App Insights | `opal-portal-staging-ai` | `opal-portal-prod-ai` | Workspace-based, → prod LAW |
| Base URL | `https://opal-portal-staging.azurewebsites.net` | `https://portal.opaltherapy.com.au` (custom) | `opal-portal-prod.azurewebsites.net` until DNS is live |

**Provisioning script**: `deploy/staging-provision.sh` is idempotent and
parameterised via env vars for `APP`, `PG`, `KV`, `SA` — but `RG`, `PLAN`,
`LAW`, `AI`, `NODE_ENV=staging`, `ALLOWED_EMAILS=synthetic.owner@example.test`,
and the output file `staging-resources.txt` are hardcoded. **Create
`deploy/prod-provision.sh` as a copy with prod names and the app-setting
differences in §5**, keeping the same idempotent structure (provider
registration, KV re-run password preservation, `setsecret` never echoing,
role-propagation sleep). Have it write `deploy/prod-resources.txt`. Do not
edit the staging script.

---

## 3. Custom domain + managed certificate

Order matters: the TXT and CNAME must exist before the hostname add; the
CNAME must exist before the managed certificate is issued.

1. **Get the domain verification ID** (after the app exists):
   `az webapp show -g opal-portal-prod-rg -n opal-portal-prod --query customDomainVerificationId -o tsv`
2. **DNS (domain host for opaltherapy.com.au)** — two records:
   - `TXT  asuid.portal  →  <customDomainVerificationId>`
   - `CNAME  portal  →  opal-portal-prod.azurewebsites.net`
3. **Bind hostname**:
   `az webapp config hostname add -g opal-portal-prod-rg --webapp-name opal-portal-prod --hostname portal.opaltherapy.com.au`
4. **Managed certificate** (free, auto-renewing) + SNI bind:
   `az webapp config ssl create -g opal-portal-prod-rg -n opal-portal-prod --hostname portal.opaltherapy.com.au`
   then bind SNI (`az webapp config ssl bind … --ssl-type SNI`).
5. **Update the URL app settings** to the custom domain: `APP_BASE_URL`,
   `ALLOWED_ORIGINS`, `MICROSOFT_REDIRECT_URI` (and `WEBHOOK_BASE_URL` if
   webhooks are ever enabled). Update the production Entra redirect URI to
   match (§6).
6. **Verify**: `curl -I https://portal.opaltherapy.com.au/health` → 200, valid
   certificate, `strict-transport-security` header present (the deploy
   workflow's smoke test also asserts HSTS).

**Pipeline interaction**: `deploy-production.yml` health-gates against
`vars.PRODUCTION_URL || 'https://portal.opaltherapy.com.au'`. If the first
production deploy happens **before** DNS/cert are live, set the GitHub
`production` environment variable `PRODUCTION_URL=https://opal-portal-prod.azurewebsites.net`
temporarily, and remove it once the custom domain works — otherwise the
health gate curls a domain that doesn't resolve and the deploy is marked
failed after it has already shipped.

---

## 4. NODE_ENV=production — what actually changes vs staging

Staging runs `NODE_ENV=staging`. Three behaviours flip only at
`NODE_ENV === 'production'` and have therefore **never run in a deployed
environment**:

| Behaviour | Code | Staging | Production |
|---|---|---|---|
| Session cookie `Secure` flag | `backend/server.js` ~line 243 (`secure: NODE_ENV === 'production'`) | cookie not Secure-flagged | cookie HTTPS-only; requires the trust-proxy handling behind App Service TLS termination (already fixed in the infrastructure test bench) |
| CSRF origin check enforcement | `backend/server.js` ~lines 182–189 | mismatched Origin logs a warning and **passes** | mismatched Origin → **403 "Request origin not permitted"**. `ALLOWED_ORIGINS` must exactly equal the real origin or every POST/PUT/PATCH/DELETE fails |
| `'null'` origin (file://) allowance | `backend/server.js` ~line 180 | allowed | blocked |
| Migration guard | `backend/migrate.js` `guardProduction()` | not triggered | `node migrate.js up` at startup **refuses to run** unless app setting `MIGRATE_ALLOW_PRODUCTION=true` is set (staging already sets it; prod must too or the app never boots) |
| `env-validation.js` strictness | `strict = production \|\| staging` | already strict | same — missing/weak critical config refuses boot in both |

First-login verification after cutover must confirm: login sets a cookie over
HTTPS (Secure works behind the proxy), and a cross-origin POST is rejected 403.

---

## 5. App settings — production vs staging

Baseline: the staging block in `deploy/staging-provision.sh` lines 114–142.
Differences:

| Setting | Staging value | Production value | Why |
|---|---|---|---|
| `NODE_ENV` | `staging` | `production` | §4 effects |
| `APP_BASE_URL` | staging azurewebsites URL | `https://portal.opaltherapy.com.au` | email links, OAuth |
| `ALLOWED_ORIGINS` | staging URL | `https://portal.opaltherapy.com.au` | CSRF 403 is strict in prod — must match exactly |
| `MICROSOFT_REDIRECT_URI` | staging `/auth/oauth/callback` | `https://portal.opaltherapy.com.au/auth/oauth/callback` | must equal the prod Entra registration exactly (env-validation critical) |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_TENANT_ID` | staging registration | **production registration** (§6) | separate app |
| `ALLOWED_EMAILS` | `synthetic.owner@example.test` | Owner's real email **for first registration only**, then **cleared → invite-only** | no synthetic accounts in prod; after the owner exists, all accounts come via owner invites |
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` | not set (staging placeholder secret) | real SMTP values; real password in prod KV `email-pass` | verification/invite/reset emails must actually send in prod (dev fallback is console links) |
| `SESSION_SECRET` | staging KV reference | prod KV reference — **freshly generated** (`openssl rand -base64 48`) | **never reuse staging's**; ≥32 chars enforced at boot |
| `TOKEN_ENCRYPTION_KEY` | staging KV reference | prod KV reference — **freshly generated** (`openssl rand -hex 32`) | **never reuse staging's**; must match `/^[0-9a-f]{64}$/` |
| `DB_PASSWORD` / `webhook-client-state` | staging KV | fresh values in prod KV | full secret separation |
| `DB_HOST` | `opal-portal-staging-pg.…` | `opal-portal-prod-pg.postgres.database.azure.com` | |
| `SPLOSE_API_KEY` | staging KV reference | **same practice key**, stored separately in prod KV (§7) | Splose keys are practice-scoped, not per-environment |
| `AZURE_STORAGE_CONNECTION_STRING` / `AZURE_STORAGE_CONTAINER` | staging account | prod account conn string in prod KV; container `employee-documents` | |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | staging AI | prod AI connection string | |
| `ENABLE_OUTLOOK_WRITE` / `ENABLE_SPLOSE_WRITE` / `ENABLE_AUTOMATIC_REMOTE_DELETE` | `false` | **`false` — all of them** | production launches as a read-only mirror; staged enablement is a separate, later, owner decision (`deploy/EXTERNAL_ACTIONS_CHECKLIST.md` §D) |
| `SYNC_MAX_AUTO_DELETE` / `SYNC_MAX_DELETE_PERCENT` | 25 / 30 | same | mass-deletion guards unchanged |
| `MIGRATE_ALLOW_PRODUCTION` | `true` | `true` | required for startup migrations under `NODE_ENV=production` (§4) |
| `GOOGLE_MAPS_API_KEY` | placeholder | real key in prod KV (or placeholder — feature degrades gracefully) | recommended, not critical |
| `WEBHOOK_BASE_URL` / `WEBHOOK_CLIENT_STATE` | unset (pollers do the mirroring) | keep unset at launch, matching staging posture | if ever set, `WEBHOOK_CLIENT_STATE` becomes required and must not be the hardcoded default (`env-validation.js` CONDITIONAL) |

All secret values go **only** into `opal-portal-prod-kv` and are referenced
via `@Microsoft.KeyVault(SecretUri=…)` — same mechanism as staging. Generate
in-process inside `prod-provision.sh` (never echoed), as
`staging-provision.sh` does.

---

## 6. Entra app registration — recommendation: **separate production registration**

Create **`Opal Portal (Production)`** rather than adding the prod redirect URI
to the staging registration. Justification:

- `deploy/staging-entra.sh` header states the design intent explicitly:
  *"Separate registration from production by design — staging tokens and
  consent never touch the production app."*
- Independent client secrets → independent rotation and expiry; a staging
  secret leak or rotation mistake cannot take production down.
- A single registration with both redirect URIs would let a token issued for
  staging be redeemed against a flow initiated from production tooling —
  needless cross-environment surface for a healthcare app.
- Consent, sign-in logs, and conditional-access policy stay per-environment.

Execution: adapt `deploy/staging-entra.sh` (it is idempotent and already
sources its resource names from `staging-resources.txt`) into
`deploy/prod-entra.sh` sourcing `prod-resources.txt`, with display name
`Opal Portal (Production)` and redirect
`https://portal.opaltherapy.com.au/auth/oauth/callback`. Same delegated Graph
permissions (`openid profile email offline_access User.Read
Calendars.ReadWrite`), client secret written **directly into prod KV**
(never printed), 24-month expiry **recorded in the owner's calendar**, and
admin consent granted (may need Global Administrator —
the script prints the exact consent URL).

Note: if provisioning happens before DNS, register the redirect with the
custom domain anyway — Outlook connection simply won't work until DNS is
live, which is fine because the first Outlook connect is a post-DNS step.

---

## 7. Splose API key

- Production uses the **same practice-scoped durable API key** that staging
  validated against (Splose keys belong to the practice, not to an
  environment). Store it as `splose-api-key` in **prod KV** — separate secret
  object, same value.
- **Durable-key incident (staging bring-up)**: Splose validation only became
  stable once the practice's *durable* key was placed in Key Vault
  (`READ_ONLY_LIVE_TEST_RESULTS.md` baseline). Treat the Splose key as a
  single shared credential: regenerating or replacing it in Splose invalidates
  the key in use, which after cutover means **staging and production break
  simultaneously**. Any key regeneration must be a planned event: new key →
  update **both** KVs → app-setting rewrite + restart on **both** apps (§12
  gotcha), verify both `/ready`.
- Write-path remains provably blocked: staging demonstrated 403
  `feature_disabled` on Splose create **with a working key**; the same flags
  are false in production.

---

## 8. GitHub OIDC — production federated credentials

Already done by `deploy/github-azure-oidc.sh` (idempotent — safe to re-run to
verify):

- Federated credentials for `environment:production` exist in **both** subject
  formats — classic `repo:OWNER/REPO:environment:production` **and** the
  immutable-ID form `repo:OWNER@id/REPO@id:environment:production`. This is a
  real gotcha hit during staging bring-up: newer GitHub repos present the
  immutable-ID subject, and with only the classic form registered,
  `azure/login` fails with a no-matching-federated-identity error. Both forms
  are registered per environment (script lines 28–46). Verify with
  `az ad app federated-credential list --id <deployer appId>`.
- The three `AZURE_*` id secrets are already set on the GitHub `production`
  environment, and `production` has the required-reviewer gate.

**Outstanding (owner, after the prod RG exists):** grant the deployer
Contributor on the production RG — the script deliberately granted staging
only:

```bash
az role assignment create --assignee <deployer appId> --role Contributor \
  --scope /subscriptions/<SUB>/resourceGroups/opal-portal-prod-rg
```

Without this, the first Deploy Production run fails at `azure/webapps-deploy`.

---

## 9. Data separation — staging vs production

| Principle | How it holds |
|---|---|
| **No data migration.** Production starts from an empty `opal_portal` database | Schema is created entirely by startup migrations: `backend/startup.sh` runs `node migrate.js up` (advisory-locked, fail-closed) before `node server.js` on every deploy |
| **No synthetic accounts in production** | Staging's `synthetic.owner@example.test` and everything in `deploy/staging-synthetic.local.txt` stay in staging. Prod `ALLOWED_EMAILS` only ever contains the owner's real address, then is cleared |
| **First owner is created through the normal flow** | Register with the allowed email → verify via real SMTP email → first account becomes owner |
| **Separate secrets everywhere** | New `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, DB password, webhook-client-state; separate KV; separate storage account; separate Entra registration. Nothing cryptographic is shared except the practice's Splose key (§7) |
| **Calendar/Splose data arrives by sync, not by copy** | Once the owner connects Outlook (prod Entra app) and the Splose key is live, the read-only pollers mirror real data into the fresh DB |

---

## 10. Backup & restore

- **Database**: PG Flexible PITR with `--backup-retention 14` (same as
  staging). Restores create a **new** server; the live server is never
  overwritten. Adopt a restore by repointing `DB_HOST` (remember the KV/app-
  setting rewrite gotcha does not apply here — `DB_HOST` is a plain setting).
- **Restore drill — REQUIRED, never executed.**
  `deploy/EXTERNAL_ACTIONS_CHECKLIST.md` item 15 (unchecked) and
  `deploy/AZURE_DEPLOYMENT.md` §6.2 require one drill **before go-live**
  (then quarterly). Run it against the **staging** server first — it proves
  the procedure without touching prod and costs one temporary B1ms server:
  restore to `…-pg-restored`, connect, `node migrate.js status` all applied,
  spot-check row counts, then delete the restored server. **Go/no-go
  blocker** (§16).
- **Blob soft-delete gap**: `deploy/staging-provision.sh` does **not** enable
  blob or container soft-delete — a deleted employee document is gone
  immediately. For production, enable both in `prod-provision.sh`:

```bash
az storage account blob-service-properties update --account-name <SA> -g opal-portal-prod-rg \
  --enable-delete-retention true --delete-retention-days 14 \
  --enable-container-delete-retention true --container-delete-retention-days 14
```

  (Worth back-porting to staging later — separate task, not part of cutover.)

---

## 11. Rollback

- **App**: the deploy bundle is kept **14 days** as a workflow artifact
  (`deploy-production.yml` header). Roll back by re-running Deploy Production
  from the previous known-good commit (full CI + approval gate re-applies), or
  directly: `az webapp deploy -g opal-portal-prod-rg -n opal-portal-prod
  --src-path deploy.zip --type zip`.
- **Schema**: the additive-migrations-only policy
  (`deploy/AZURE_DEPLOYMENT.md` §6.3) — migrations must be backwards-
  compatible one version (new columns nullable/defaulted; no drops/renames in
  the same release that removes the old reader) — means rolling the app back
  one version **never requires a schema rollback**. Data-destructive
  migrations must ship behind a restore-verified backup and be flagged in the
  PR.
- **Bad deploy is caught before traffic matters**: startup migrations are
  fail-closed and the workflow's `/health` → `/ready` gates fail the run.
- **Emergency stop**: `az webapp stop -g opal-portal-prod-rg -n
  opal-portal-prod` — stateless app, sessions persist in PG, pollers drain on
  SIGTERM.

---

## 12. Key Vault reference rotation — operational gotcha (proven on staging)

From `AZURE_STAGING_VALIDATION_REPORT.md` (open item 4): after rotating a
secret in Key Vault, **`az webapp restart` alone is not sufficient** — the app
can come back serving the *cached* old value. The working procedure:

1. Set the new secret version in KV.
2. **Rewrite the app setting** with the same KV reference string
   (`az webapp config appsettings set … "NAME=@Microsoft.KeyVault(SecretUri=…)"`)
   — this forces re-resolution.
3. Expect the **old worker to keep serving for ~100 s** during the swap.
4. Verify against a **fresh worker**: `/health` uptime must have reset, then
   confirm the dependent behaviour (e.g. Splose poller cycles cleanly).

Bake this into every prod secret-rotation runbook step (quarterly rotations,
Entra client-secret renewal, Splose key events).

---

## 13. Single-instance constraint — do not scale out

Keep the production App Service plan at **exactly one instance** (B1 default;
no autoscale rules):

- The Outlook delta poller (~90 s) and Splose poller (15 min) run
  **in-process**. Two instances = two pollers per source: doubled Graph/Splose
  traffic and racing writes into the sync tables, which can distort the
  mass-deletion safety counters (`SYNC_MAX_AUTO_DELETE` /
  `SYNC_MAX_DELETE_PERCENT`).
- Socket.IO per-user rooms have no shared adapter — live calendar pushes
  would only reach users on the instance that processed the sync.
- Startup migrations are the one multi-instance-safe part (advisory-locked),
  but that does not make the runtime safe to scale.

Health check path stays `/ready` (set by provisioning). If capacity is ever a
problem, scale **up** (B1 → B2/B3), never **out**.

---

## 14. Monitoring & alerts — must be recreated by hand

**No IaC exists for alerting.** Staging's three rules were hand-made in the
portal/CLI and live only in the staging resources; provisioning prod creates
zero alerts. Recreate against **prod App Insights** with a fresh email action
group:

| # | Rule | Source |
|---|---|---|
| 1 | HTTP 5xx (`requests | where resultCode >= 500`, >5 in 15 min) | exists on staging (`READ_ONLY_LIVE_TEST_RESULTS.md` baseline: "http-5xx") |
| 2 | Health-check / availability on `/health` (2+ regions, 2 consecutive failures) | exists on staging ("health-check") |
| 3 | Slow response (avg duration > 3 s over 15 min) | exists on staging ("slow-response") |
| 4 | **`sync.safety_block` customEvent — any occurrence** | recommended (`deploy/AZURE_DEPLOYMENT.md` §8): the mass-deletion guard fired; investigate before clearing |
| 5 | **Failed logins — `login_failed` audit events > 20 in 15 min** | recommended (§8): credential stuffing against a real-data portal |
| 6 | `/ready` availability test (expect 200) | §8 table — catches DB/migration/config trouble while the process is alive |

Also verify the prod telemetry uses the same redacting processor (app-side,
ships with the code) and run the sensitive-shape KQL scan once after go-live,
as was done for staging.

---

## 15. Who does what

| Action | Owner (Antony) | Developer (repo work) |
|---|---|---|
| Approve this plan / go decision | ✅ | |
| Write `deploy/prod-provision.sh`, `deploy/prod-entra.sh` (adapted from staging scripts; reviewed, **not run**) | | ✅ |
| `az login` + run prod provisioning | ✅ | |
| Grant deployer Contributor on prod RG (§8) | ✅ | |
| Prod Entra registration + admin consent (may need Global Admin) | ✅ | |
| Splose key, SMTP password, Maps key → prod KV | ✅ | |
| DNS TXT + CNAME at the domain host | ✅ (domain host access) | |
| Hostname bind + managed cert | ✅ | |
| Restore drill (staging) | ✅ | ✅ assist/verify |
| Run Deploy Production (confirmation phrase + environment approval) | ✅ (is the required reviewer) | |
| Post-deploy verification (§16 checks) | ✅ | ✅ |
| Alert rules + availability tests on prod | ✅ | |
| Clear `ALLOWED_EMAILS` after first owner registration | ✅ | |

---

## 16. Cutover sequence (estimated)

Prep (can happen now, no Azure changes):

| Step | Duration |
|---|---|
| 0. Draft + review `deploy/prod-provision.sh` and `deploy/prod-entra.sh` | ~1–2 h |

Execution (each step gated on owner approval):

| # | Step | Duration | Notes |
|---|---|---|---|
| 1 | Run `prod-provision.sh` (RG, LAW/AI, PG, plan+app, KV+secrets, storage+soft-delete, settings) | ~30–40 min (PG create is 5–10 min of it) | idempotent — safe to re-run on partial failure |
| 2 | Deployer Contributor on `opal-portal-prod-rg`; verify federated creds list | ~10 min | §8 |
| 3 | `prod-entra.sh`: registration, secret → prod KV, admin consent | ~20 min | §6 |
| 4 | Real secrets into prod KV: Splose key, SMTP password, (Maps key) + SMTP app settings | ~15 min | §5, §7 |
| 5 | Restore drill on staging PG (if not already done) | ~45–60 min | **blocker for step 8** |
| 6 | DNS TXT + CNAME at domain host | ~15 min work + propagation (minutes–hours) | §3 |
| 7 | Hostname add, managed cert, SNI bind; final URL app settings | ~15 min after DNS resolves | §3 |
| 8 | **Deploy Production** workflow: type `deploy-production`, approve environment gate; CI → deploy → `/health`+`/ready` gates → smoke (HSTS) | ~15–25 min | set `PRODUCTION_URL` var first if deploying before DNS (§3) |
| 9 | Verification pass: cert padlock, `/health` + `/ready` green, owner registration + real verification email, login cookie Secure, cross-origin POST → 403, Outlook connect (prod Entra), Splose mirror appears, blob upload/download/delete smoke test | ~30–45 min | first live exercise of prod NODE_ENV behaviours (§4) |
| 10 | Alert rules + availability tests (§14); log-hygiene KQL scan | ~30–40 min | |
| 11 | Clear `ALLOWED_EMAILS` → invite-only | ~5 min | |

**Total execution: roughly half a day** plus DNS propagation, assuming no
name collisions. Write flags stay `false` — staged enablement
(`ENABLE_OUTLOOK_WRITE` → `ENABLE_SPLOSE_WRITE` →
`ENABLE_AUTOMATIC_REMOTE_DELETE`, in that order) is deliberately **not part of
cutover** and follows the read-only live period per
`deploy/EXTERNAL_ACTIONS_CHECKLIST.md` §D.

---

## 17. Go/no-go checklist

Do not run step 8 (Deploy Production) until every box is ticked:

- [ ] Owner has explicitly approved provisioning and cutover (this plan alone authorises nothing)
- [ ] All prod resources exist; `prod-resources.txt` recorded
- [ ] Prod KV holds **freshly generated** `session-secret`, `token-encryption-key`, `db-password`, `webhook-client-state` — none copied from staging
- [ ] Prod KV holds the real Splose key, SMTP password, Entra client secret (expiry in calendar)
- [ ] `MIGRATE_ALLOW_PRODUCTION=true`, `NODE_ENV=production`, all three write flags `false` — confirmed in app settings
- [ ] `ALLOWED_ORIGINS` / `APP_BASE_URL` / `MICROSOFT_REDIRECT_URI` exactly match the live domain (CSRF is fail-closed in prod)
- [ ] Prod Entra registration consented; redirect URI matches character-for-character
- [ ] Deployer has Contributor on the prod RG; federated credentials verified in both subject formats
- [ ] GitHub `production` environment gate: required reviewer = owner; `PRODUCTION_URL` var set correctly for the DNS state
- [ ] **Restore drill executed and verified** (checklist item 15 — currently never done)
- [ ] Blob soft-delete enabled on the prod storage account
- [ ] Plan instance count = 1; no autoscale
- [ ] DNS + managed cert live (or `PRODUCTION_URL` fallback set)
- [ ] Staging is green (`/health`, `/ready`, tests) — don't cut over on top of an unexplained staging failure
- [ ] Rollback understood: previous artifact retained 14 days; additive-migration policy in force for the release being deployed

Post-deploy (before calling it done): §16 step 9 verification list complete,
alerts firing test-confirmed, `ALLOWED_EMAILS` cleared.

---

*References: `deploy/staging-provision.sh` · `deploy/AZURE_DEPLOYMENT.md` ·
`deploy/EXTERNAL_ACTIONS_CHECKLIST.md` · `deploy/staging-entra.sh` ·
`deploy/github-azure-oidc.sh` · `.github/workflows/deploy-production.yml` ·
`backend/env-validation.js` · `backend/server.js` · `backend/startup.sh` ·
`backend/migrate.js` · `AZURE_STAGING_VALIDATION_REPORT.md` ·
`READ_ONLY_LIVE_TEST_RESULTS.md`*
