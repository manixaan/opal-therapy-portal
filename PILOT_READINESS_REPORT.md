# PILOT READINESS REPORT — Opal Therapy Employee Portal

**Date:** 2026-07-14 · **Branch:** `production-pilot` · **Head:** `6b84238`
**Target:** portal.opaltherapy.com.au on Azure (Australia East)

---

## Classification

> # READY FOR SYNTHETIC-DATA TESTING

**Exactly one classification applies, and this is it.** What it means and why:

Every locally executable and locally verifiable piece of work is complete:
the codebase passed a 21-category adversarial infrastructure test bench, all
ten discovered defects are fixed with pinned regression tests, 169 automated
tests pass, `npm audit` reports zero vulnerabilities, and production-mode
boot is verified. **Local synthetic-data testing is done and green.**

The classification is not higher because the system has **never executed in
a cloud environment**: no Azure resources exist yet, the GitHub Actions
pipeline has never run on GitHub, the Azure Blob storage backend, Key Vault
references, OIDC deployment login, and Application Insights ingestion have
never been exercised against live Azure. Per the bench's own rule —
*untested external functionality is not converted into a pass* — the honest
next stage is deploying to staging and repeating the synthetic-data pass
there.

**Promotion path (no further code work expected):**
1. Antony completes `deploy/EXTERNAL_ACTIONS_CHECKLIST.md` §A–B → staging runs.
2. Staging synthetic pass green (registration, Outlook mirror, blob document
   round-trip, health gates) → **READY FOR CONTROLLED READ-ONLY LIVE TESTING**
   (flags all off — the portal cannot write into Outlook or Splose).
3. Read-only period clean + write flags staged on → **READY FOR LIMITED PILOT**.
4. Pilot feedback + deferred-list review → **READY FOR EMPLOYEE ROLLOUT**.

---

## 1. Implementation summary

Twelve phases executed on `production-pilot` (15 commits from baseline `7cbbf65`):

| Phase | Commit | Delivered |
|---|---|---|
| 1 Baseline | `7cbbf65` | Verified branch point, working state recorded |
| 2 Test framework | `95f9f24` | Isolated PostgreSQL integration harness (`*_test` DB forced, prod-pattern refusal, TZ pinned) |
| 3 Data-loss controls | `7cb179b` | One assessment function behind all four deletion paths; thresholds; audit + owner notifications; blocked batches re-present |
| 4 Defect repairs | `20016e5` | bcryptjs crash, phantom column, read_only invites, fake "Sync now", onboarding OAuth entry — each pinned by a full-stack test |
| 5 Environment readiness | `1f13334` | All URLs relative; tenant/env config externalised; engines pinned; `.env.example` complete |
| 6 Security hardening | `62bfa8a` | Production CSP; raw-body webhook validation; strict OAuth state; email HTML escaping; upload validation; 0-vuln dependency set |
| 7 Migrations + storage | `69151cb` | Checksummed transactional migration runner (advisory-locked, fresh-DB + existing-DB safe, production-guarded); db/local/blob document storage behind authenticated download route |
| 8 Observability | `1622d01` | `/health` + `/ready`; structured redacting logger with request correlation; optional App Insights; audit gaps closed; graceful shutdown |
| 9 CI/CD + ops docs | `9105096` | Test→migrate-validate→audit→package pipeline; OIDC staging deploy with health gates; manual-approval production deploy; full Azure runbook |
| Freeze | `73ea711` | Infrastructure freeze marker |
| Test bench | `449dfb1` | 21-category adversarial validation; 10 defects fixed (see §2); regression tests |
| 10 Feature flags | `a7c2c67` | Staged-rollout switchboard, fail-safe OFF in cloud environments, enforced at module boundary + routes + poller |
| 11 Portal polish | `6b84238` | Session-expiry redirect; read_only UI honesty; role badges; nav fallbacks |

Architecture decisions that shaped the build: Splose remains the clinical
source of truth (the portal stores scheduling mirrors and employee-profile
data only); the historical INIT_QUERIES schema was frozen as migration
baseline v0 rather than rewritten; document bytes stay in Postgres for
existing rows while the abstraction adds Blob for the future (no forced data
migration); email/password auth retained with Entra SSO groundwork.

## 2. Test summary

| Layer | Count | Status |
|---|---|---|
| Unit suites (jest) | 9 suites, **104 tests** | ✅ all passing |
| Integration suites (real PostgreSQL, real HTTP + sessions + SQL) | 9 suites, **65 tests** | ✅ all passing |
| Infrastructure test bench | 21 categories, ~90 discrete probes | ✅ all PASS or PASS WITH LIMITATION (4 explicitly Azure-gated) |
| Dependency audit | `npm audit` | ✅ 0 vulnerabilities |

The bench found **10 defects** (full register + evidence in
`INFRASTRUCTURE_TEST_BENCH_REPORT.md`): 4 high — production login broken
behind Azure's proxy (trust proxy), read_only writes unenforced server-side,
DB-outage crash loop at boot, documented 5 MB uploads impossible past a
100 KB parser — plus 6 medium/low (non-UUID 500s, orphaned rows on storage
failure, missing-object 500, error-status semantics, bundle hygiene, missing
denial audit). **All ten fixed, each with a regression test, and the entire
bench re-verified clean.** Historically notable: two real bugs (inverted
sync-origin preservation, soft-delete counter inflation) were caught only by
the integration layer after 47 green unit tests missed them — the reason
this project treats integration coverage as non-negotiable.

Explicitly not tested (requires Azure): live Blob operations, Key Vault
resolution, OIDC login from GitHub, App Insights ingestion, real slot/domain
behaviour. Each is listed with its first-verification step in the checklist.

## 3. Security summary

- **Authentication**: bcrypt (cost 12), constant-time comparison against a
  dummy hash (no user enumeration), session regeneration on login, per-IP
  login rate limiting, suspended/deactivated accounts cut off mid-session,
  secure/HttpOnly/SameSite cookies verified working behind a TLS-terminating
  proxy, PostgreSQL-backed sessions with TTL + pruning.
- **Authorisation**: role checks on admin routes; read_only enforced at a
  single server-side choke point (all unsafe methods, auth endpoints exempt);
  document downloads only via the authenticated ownership/role-checked route —
  no public URLs, ever; cross-user access audited (grants *and* denials).
- **Secrets**: none in the repo (verified repeatedly, including in the
  deployment bundle build, which fails if a `.env` sneaks in); Key Vault
  references + OIDC (no long-lived cloud credentials in GitHub); strict env
  validation refuses weak/missing production config at boot.
- **Sync data-loss controls**: every automatic deletion path passes one
  assessment (volume caps, percentage caps, incomplete-fetch refusal,
  empty-result refusal); blocked batches audit, notify owners, and re-present;
  remote-delete additionally behind a default-off flag in cloud environments.
- **Injection/upload surface**: parameterised SQL throughout; MIME/extension/
  traversal/base64 validation with 415s; scoped body-size limits; escaped
  email templates; CSP pinning network destinations (residual: `unsafe-inline`
  for the single-file frontend — deferred, documented).
- **Logging/telemetry**: key-based redaction + token-shape scrubbing; no
  query strings in request logs (OAuth codes/reset tokens travel there);
  telemetry processor redacts before anything leaves the process; audit rows
  carry identifiers, never secrets or clinical content (probed under test).

## 4. Deployment summary

Repository ships: three workflows (CI gate; staging deploy on main with
`/health`+`/ready`+smoke gates; production deploy that is manual-only with a
typed confirmation phrase *and* a protected-environment human approval),
`backend/startup.sh` (advisory-locked migrations → server, fail-closed),
TLS-ready DB layer (`DB_SSL`), and `deploy/AZURE_DEPLOYMENT.md` — the full
runbook (resource CLI, Key Vault/OIDC setup, domain + HTTPS, monitoring/alert
rules, backup/PITR/restore drill, rollback, emergency shutdown, secret
rotation). Rollback: redeploy previous artifact (kept 14 days); migrations
are additive-by-policy so one-version app rollback needs no schema rollback —
proven in the bench by running the previous release against the migrated
schema. **Nothing has been deployed; no Azure resources exist; no live
credentials were fabricated or assumed.**

## 5. External actions required (owner)

Complete list with exact instructions: **`deploy/EXTERNAL_ACTIONS_CHECKLIST.md`**.
In one line each: create Azure resources (staging+prod), set Key Vault
secrets, two Entra app registrations + consent, Splose production key, App
Settings, GitHub push + environments + OIDC federated identity, first staging
deploy + smoke, DNS + certificate, restore drill, then staged flag
enablement. Estimated hands-on time to a running staging environment:
**about 2–3 hours**.

## 6. Final roadmap

**Completed** — everything in §1: test framework, data-loss controls, defect
repairs, env readiness, security hardening, migrations, document storage,
health/logging/audit/telemetry, CI/CD + runbook, adversarial bench + 10
fixes, feature flags, role-aware polish.

**Ready (awaiting only external actions)** — staging deployment, production
deployment, monitoring/alerts, custom domain, staged flag enablement.

**Blocked (external dependency)** — live verification of Blob/Key Vault/
OIDC/App Insights (needs Azure); production Splose key (needs Splose);
admin consent (needs Microsoft admin); DNS records (needs domain host).

**Deferred (deliberate, documented)** — VNet/private endpoints; managed-
identity Blob auth; DB→Blob backfill of existing documents; Entra ID SSO;
CSP `unsafe-inline` removal via frontend modularisation; grouped-navigation
rewrite; env value-format pre-validation.

**Future (post-rollout candidates)** — audit-log UI; document versioning /
retention automation; per-user working-hours sync windows; Splose webhook
ingestion (replacing the 15-min poll); load testing at practice scale.

---
*Supporting evidence: `INFRASTRUCTURE_TEST_BENCH_REPORT.md` (bench detail),
`deploy/AZURE_DEPLOYMENT.md` (operations), `handover/` (system reference).*
