# Therapist Pilot — Environment Decision

Stage 2 (2026-07-31). **This is an OWNER DECISION (Antony). No production
resources have been created — Option B executes only on your explicit
approval.** Until you decide, Stage 2 proceeds on Option A so nothing
blocks the pilot preparation.

## The decision

### Option A — Pilot on hardened staging (the current working assumption)

The therapist pilots on `https://opal-portal-staging.azurewebsites.net`.

What Stage 2 already did to make this defensible:
- Secure session cookies + strict CSRF enforcement now apply on staging
  (previously production-only — audit H5 closed).
- Invite/verify/reset links use the staging URL (APP_BASE_URL boot-critical).
- Splose RBAC, write gates, per-user Outlook state, honest freshness — all
  deployed and smoke-tested.
- Invites work via **copy-link** without SMTP (email optional, see
  EMAIL_AND_INVITE_SETUP.md).

Remaining Option A caveats (accepted risks, not fixable by code):
- Staging doubles as the CI deploy target: any merge to `main` restarts the
  app users are on. Mitigation: agree a "deploys after 6pm AWST" rule
  during the pilot, or approve Option B.
- The URL says "staging" and `azurewebsites.net` — cosmetic but real.
- Synthetic accounts share the database (cleanup is a separate
  owner-approved task before the real therapist gets access).

### Option B — Provision production now

Execute docs/launch/PRODUCTION_ENVIRONMENT_CUTOVER_PLAN.md:
`opal-portal-prod` App Service + PostgreSQL + Key Vault + Blob + App
Insights (≈ half a day of work, small monthly cost), custom domain
`portal.opaltherapy.com.au` when DNS access is available. No writes
enabled; no synthetic accounts; owner account created deliberately;
health/ready/smoke + rollback documented in the plan.

**Recommendation: Option B before the therapist's first login** (the audit
and hosting docs both recommend it) — but Option A is acceptable for the
first 1–2 pilot weeks if you prefer to see the pilot working first.

## What I need from you (reply with one line)

- **"Option A"** — pilot continues on hardened staging; nothing to provision.
- **"Option B — approved"** — I will provision production per the cutover
  plan (still zero write flags, no data migration, staging untouched) and
  report back with health/smoke evidence before anyone logs in.
- Optionally for B: confirm you can add DNS records for
  `opaltherapy.com.au` (TXT + CNAME), or we launch on
  `opal-portal-prod.azurewebsites.net` and bind the domain later.

## Status log

| Date | Status |
|---|---|
| 2026-07-31 | Decision OPEN. Stage 2 built + validated on staging (Option A posture). No production resources exist. |
