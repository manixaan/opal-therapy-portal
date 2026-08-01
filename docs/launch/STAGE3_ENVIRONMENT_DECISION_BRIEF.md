# Stage 3 Environment Decision Brief (owner: Antony)

One decision remains before the therapist's first login. **Nothing is
provisioned until you approve** — this brief exists so the decision takes
five minutes, not an evening. Full detail:
PRODUCTION_ENVIRONMENT_CUTOVER_PLAN.md · THERAPIST_PILOT_ENVIRONMENT_DECISION.md.

## Option A — Pilot on hardened staging (available today)

**Pros:** zero delay — everything is already deployed, smoke-tested and
dry-run-validated there; copy-link invites work now; Secure cookies +
strict CSRF already enforced (Stage 2); one environment to watch during
the pilot.

**Cons:** staging is still the CI target — any merge to `main` restarts
the app mid-day (mitigation: deploy freeze or after-hours rule during the
pilot); the URL says `staging.azurewebsites.net` to a real employee;
synthetic test accounts and dry-run artifacts share the database (they are
suspended/inert, but it isn't a clean room); test and real data are not
separated at the infrastructure level.

## Option B — Provision production first (~half a day + DNS)

**Pros:** clean environment with only real accounts; proper staff URL
(`portal.opaltherapy.com.au`); `NODE_ENV=production` posture throughout;
staging returns to being purely a test bed — merges can't interrupt staff;
the right long-term footing and it has to happen eventually.

**Cons:** ~half a day of provisioning + secrets duplication (new
SESSION_SECRET/ENCRYPTION_KEY, Entra redirect, Splose key into prod KV) +
DNS/cert steps needing your registrar access; production smoke + one
restore drill before go-live; slightly more monthly cost.

## Recommendation

- **Preferred: Option B**, timed so provisioning + smoke completes before
  the therapist's first login (it is scripted and planned; the half-day is
  real but bounded).
- **Minimum acceptable: Option A** for the first 1–2 pilot weeks ONLY, with
  two conditions agreed in writing: (1) a deploy freeze or after-6pm-AWST
  deploy rule while the pilot runs, and (2) a scheduled Option B cutover
  date so staging-as-production does not become permanent.

## What must be true before EITHER goes live

1. SMTP configured (or you explicitly accept copy-link invites + owner-
   assisted password resets for the pilot).
2. The therapist's M365 mailbox + Splose practitioner ID exist (runbook
   pre-work).
3. Quick-start guide + first-login checklist handed to the therapist.
4. For Option B additionally: production smoke green + one timed PG
   restore drill + rollback noted.
5. All external write flags remain false (they are, everywhere).

## How to answer

Reply with **“Option A”** or **“Option B — approved”** (for B, add whether
you can edit DNS for opaltherapy.com.au now or we start on the
azurewebsites.net URL and bind the domain later).

| Date | Status |
|---|---|
| 2026-08-01 | Brief issued. Decision OPEN. No production resources exist. |
