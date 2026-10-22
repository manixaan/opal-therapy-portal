# Production Go-Live Checklist — Opal Therapy Portal

*Drafted 22 Oct 2026. Tick top to bottom; each section assumes the one before
it is done. Background and exact values: `PRODUCTION_ENVIRONMENT_CUTOVER_PLAN.md`
(settings §5, Entra §6, Splose §7, backups §10) and
`ACCOUNTS_AND_SIGN_IN_MANUAL.md`.*

---

## Where production stands today (checked 22 Oct 2026)

| Fact | Detail |
|---|---|
| Production app | `https://opal-portal-prod.azurewebsites.net` — running, `/health` ok, `/ready` ok, HTTPS + security headers present |
| Code it runs | **`bd1aa84`, deployed 1 Aug 2026** — the only production deploy ever made |
| Gap to staging/`main` | **527 commits** and **68 database migrations (007 → 076)** behind |
| What that means | Production has none of: the calendar/booking/travel work, invoicing, onboarding, credentials, Resource Hub library, WHODAS/FCA, the 18 Oct accounts & sign-in fixes, Graph email |
| Its app settings | Not checked from here (Azure access was declined) — Section B lists what must be confirmed |
| Accounts on it | Unknown (cannot sign in from here) — Section D covers both cases |

Production updates **only** when someone runs the **Deploy Production** workflow
in GitHub, types `deploy-production`, and approves it. It never deploys on a push.

---

## A. Decide before anything else

- [ ] **Go-live date** and who the first real users are (Owner first, then which therapists/admin).
- [ ] **Which staging version to promote.** Pick a commit that has been on staging and been tested — today that is `d997b47`.
- [ ] **Resource Hub content.** Production starts with an empty database. Staging's library (≈6,000 rows across 18 content tables + 996 stored files) was copied into staging by hand in August; nothing copies it to production automatically. Decide: copy the approved library to production (a one-off, owner-approved transfer), or launch production with the Hub empty.
- [ ] **What stays switched off at launch** (recommended: all of these OFF until separately approved):
  - Writing to Outlook / Splose and automatic remote deletes (`ENABLE_OUTLOOK_WRITE`, `ENABLE_SPLOSE_WRITE`, `ENABLE_AUTOMATIC_REMOTE_DELETE` = `false`)
  - WHODAS assessments (`ENABLE_WHODAS_ASSESSMENT` unset/false — WHO licensing for production is not confirmed)
  - Xero write actions (all finance write flags false; read-only Xero is fine)
  - AI features (fail closed unless the production AWS/Bedrock settings are deliberately added)
  - Microsoft 365 account provisioning (`M365_PROVISIONING_ENABLED` unset)
  - The induction assistant's direct-AI waiver (`INDUCTION_AI_ENABLED` unset)

## B. Production settings (Azure → `opal-portal-prod` → Environment variables)

Confirm each exists and is a **production** value — never copied from staging
except the Splose key. Secrets belong in the production Key Vault.

- [ ] `NODE_ENV=production`
- [ ] `APP_BASE_URL` = the address people will use (`https://opal-portal-prod.azurewebsites.net` until the custom domain is live)
- [ ] `ALLOWED_ORIGINS` = exactly that same address (anything else → every save fails with "Request origin not permitted")
- [ ] `MIGRATE_ALLOW_PRODUCTION=true` (without it the app refuses to start once it has migrations to run)
- [ ] `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, DB password — freshly generated for production, not staging's
- [ ] `ONBOARDING_ENCRYPTION_KEY` — **new since 1 Aug**; separate from `TOKEN_ENCRYPTION_KEY`; without it onboarding cannot collect tax/bank/ID details
- [ ] **`BOOTSTRAP_OWNER_EMAIL` = your own email** — **new since 18 Oct**; if production has no active Owner yet, nobody can create the first account without it (see D)
- [ ] `ALLOWED_EMAILS` = that same email only (cleared after the Owner exists)
- [ ] `ORG_NAME` = "Opal Therapy" (or the practice's legal trading name)
- [ ] `SPLOSE_API_KEY` = the practice key (Splose issues one per practice — the same key as staging is expected)
- [ ] `GOOGLE_MAPS_API_KEY` — needed for address suggestions, travel times and the setup wizard
- [ ] Storage: `AZURE_STORAGE_CONNECTION_STRING` / container, and if the Resource Hub library is copied: `RESOURCE_HUB_STORAGE_BACKEND=blob`, `RESOURCE_HUB_STORAGE_CONTAINER=resource-hub`
- [ ] `APPLICATIONINSIGHTS_CONNECTION_STRING` (production monitoring)
- [ ] Microsoft: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID=ab55fe6c-cf70-4452-87aa-5c017960d362`, `MICROSOFT_REDIRECT_URI` = `<APP_BASE_URL>/auth/oauth/callback`
- [ ] The Section A switches set as decided

## C. Microsoft (Entra admin centre)

- [ ] Confirm which app registration production uses (its client ID = `MICROSOFT_CLIENT_ID` above). Recommended: its own production registration, not "Opal Portal (Staging)".
- [ ] Its **Redirect URI** = `<APP_BASE_URL>/auth/oauth/callback`
- [ ] API permissions granted: Calendars.ReadWrite, offline_access, User.Read (delegated); **Mail.Send (application)** for email; Mail.ReadWrite (delegated) only if Outlook drafts will be used
- [ ] **Limit Mail.Send to `adminteam@opaltherapy.com.au`** (Exchange Online application access control) so the app cannot send as anyone else
- [ ] Email settings on production: `EMAIL_TRANSPORT=graph`, `EMAIL_SENDER=adminteam@opaltherapy.com.au`, `EMAIL_FROM=Opal Therapy <adminteam@opaltherapy.com.au>`

## D. Deploy and first sign-in

- [ ] Check the production database backup is on (14-day point-in-time restore) and note today's restore point
- [ ] GitHub → Actions → **Deploy Production** → Run workflow → type `deploy-production` → approve
- [ ] Watch it: CI (full test suite) → deploy → the app applies migrations 007–076 on start
- [ ] `https://<APP_BASE_URL>/ready` shows `database`, `migrations`, `config` all `ok`
- [ ] **First Owner** — either:
  - Production has no Owner yet → go to `/register`, use the `BOOTSTRAP_OWNER_EMAIL` address → you are Owner immediately and the practice organisation is created; **or**
  - An Owner already exists from August → sign in with it (or reset its password via Forgot password)
- [ ] Then clear `BOOTSTRAP_OWNER_EMAIL` and `ALLOWED_EMAILS` (invite-only from here)
- [ ] Settings → Integrations: Splose shows **Connected**; connect your Outlook
- [ ] Invoicing → Settings: ABN `49 699 791 958`, footer with ACN `699 791 958`, phone `0484 827 212`, email — production's settings are separate from staging's and localhost's
- [ ] Settings → Organisation: practice phone/email; no placeholder address

## E. Smoke test before inviting anyone (as Owner, ~15 minutes)

- [ ] Calendar loads your week; Outlook events appear after the first sync
- [ ] Book one test appointment on yourself, check travel and the "What next?" prompt, then delete it
- [ ] Send yourself an invite to a personal address → the email arrives from adminteam@ → the link opens the right site
- [ ] Forgot password on that test account → email arrives → reset works → then deactivate the test account
- [ ] Resources tab: shows the library (or is intentionally empty, per Section A)
- [ ] No test or synthetic accounts exist (Settings → Users & Roles)

## F. Invite real staff

- [ ] Invite each person from Users & Roles with the right role (most staff: **Therapist** — Owner sees all client data)
- [ ] Each completes the setup wizard (work location, credentials) on first sign-in
- [ ] Link each therapist to their Splose practitioner (Users & Roles → person → Splose practitioner) — until then they see no clients
- [ ] Each connects Outlook (Settings → Integrations)

## G. After go-live — how releases work from now on

- Changes go to **staging** first (automatic on push), you test there, then **Deploy Production** is run deliberately for a staging version you are happy with — never straight to production.
- Prefer production deploys outside clinic hours: a deploy restarts the app.
- Rollback: `PRODUCTION_ROLLBACK_AND_RECOVERY.md` (re-run the deploy for the previous good commit; database restore from backup if a migration misbehaves).
- Open items to schedule (not blocking): hashing stored reset/invite tokens, case-insensitive email uniqueness, maximum session length, two-factor sign-in, a custom domain (`portal.opaltherapy.com.au`).
