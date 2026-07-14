# External Actions Checklist — for Antony

Everything in the repository is complete and tested. The items below are the
only things standing between the current code and a running staging
environment, and they all require accounts, credentials, or DNS that only you
control. Work top-to-bottom; each step says exactly where the detailed
commands live (§ references are to `deploy/AZURE_DEPLOYMENT.md`).

> ⚠️ Never paste secrets into the repo, chat logs, or workflow files. Secrets
> go into Azure Key Vault (steps 3/6) and nowhere else.

## A. One-time platform setup

| ✅ | # | Action | How | Time |
|---|---|---|---|---|
| ☐ | 1 | **Create the Azure resources for staging** (resource group, PostgreSQL Flexible Server, App Service B1 + plan, Key Vault, Storage account + private `employee-documents` container, Application Insights — all Australia East) | §2 — copy/paste CLI block (swap in a strong PG admin password) | ~30 min |
| ☐ | 2 | **Repeat for production** (`opal-portal-prod` names) | §2 with prod substitutions | ~20 min |
| ☐ | 3 | **Put secrets in Key Vault** (db-password, generated session-secret + token-encryption-key + webhook-client-state, SMTP password, Google Maps key) | §3 CLI block — the `openssl rand` commands generate the values | ~15 min |
| ☐ | 4 | **Entra app registrations** — one for staging, one for production: redirect URIs, delegated permissions (`openid profile email offline_access User.Read Calendars.ReadWrite`), admin consent, client secret → Key Vault. Record client-secret expiry in your calendar | §4 step-by-step | ~20 min |
| ☐ | 5 | **Splose production API key** → Key Vault `splose-api-key` (ask Splose support if you don't have one scoped for production) | §3 | ~10 min |
| ☐ | 6 | **App Settings on each App Service** (environment values + Key Vault references — copy/paste block; set `ALLOWED_EMAILS` to your email so the first owner account can register) | §3 second CLI block | ~15 min |
| ☐ | 7 | **GitHub deployment identity (OIDC)** — deployer app registration, two federated credentials (`environment:staging`, `environment:production`), Contributor on both resource groups | §5.1 CLI block | ~15 min |
| ☐ | 8 | **GitHub repo settings** — push this repo to GitHub (private); create environments `staging` and `production`; on `production` add **yourself as required reviewer** (this is the manual production gate); add the three `AZURE_*` id secrets to each environment | §5.2 | ~10 min |

## B. First deployment (staging)

| ✅ | # | Action | How |
|---|---|---|---|
| ☐ | 9 | Merge/push `production-pilot` → `main` (or run the **Deploy Staging** workflow manually) | GitHub → Actions |
| ☐ | 10 | Watch the run: CI (tests + migration validation + audit) → deploy → automated `/health` + `/ready` gates → smoke tests. A red run stops before anything breaks | GitHub → Actions |
| ☐ | 11 | **First-login check**: register with your `ALLOWED_EMAILS` address → verify email → you become the first owner → connect Outlook (staging Entra app) → confirm calendar mirror appears | browser |
| ☐ | 12 | **Blob smoke test**: upload one synthetic PDF in My Profile → download it → delete it (this is the first live exercise of the Azure Blob backend) | browser |
| ☐ | 13 | Set up the two availability tests + alert rules on staging App Insights | §8 table |

## C. Before real data (production)

| ✅ | # | Action | How |
|---|---|---|---|
| ☐ | 14 | **DNS**: CNAME `portal` → `opal-portal-prod.azurewebsites.net` + TXT verification at your domain host; bind the managed certificate; update the four URL app-settings + production Entra redirect URI | §7 |
| ☐ | 15 | **Restore drill** on the staging database (proves backups actually restore before anything real depends on them) | §6.2 |
| ☐ | 16 | Run **Deploy Production** (workflow dispatch → type `deploy-production` → approve the environment gate) | GitHub → Actions |
| ☐ | 17 | Verify: `https://portal.opaltherapy.com.au/health` and `/ready` green, HTTPS padlock valid | browser |

## D. Staged rollout switches (deliberate, in order)

All three integration flags default **OFF** in staging/production — the portal
starts as a read-only mirror. Turn them on per environment via App Settings
(each change = app restart, ~30 s):

1. `ENABLE_OUTLOOK_WRITE=true` — portal can create/update/delete Outlook events
2. `ENABLE_SPLOSE_WRITE=true` — portal can create/update Splose appointments
3. `ENABLE_AUTOMATIC_REMOTE_DELETE=true` — sync may push deletions to remote calendars (leave until last; the mass-deletion safety thresholds still apply on top)

## Also required from others

- **Microsoft admin** (likely you): admin consent on both Entra registrations (step 4); production redirect URI update (step 14).
- **Domain host**: the two DNS records (step 14).
- **Splose**: production API key (step 5).

## Explicitly deferred (fine for the pilot, revisit after)

- VNet integration + private endpoints for PG/Storage/Key Vault (§11)
- Managed-identity Blob auth replacing the connection string (§12)
- Migrating existing DB-stored documents into Blob (backend/migrations/README.md — new uploads already go to Blob once configured)
- Entra ID SSO for employee login (email/password is the pilot auth; groundwork is in place)
- CSP `unsafe-inline` removal (needs frontend modularisation)
