---
name: opal-release
description: RELEASE level for the Opal Therapy portal — consolidated release and integration workflow. Integrates completed feature commits, resolves conflicts, validates migrations, runs the full regression suite and browser smoke tests, performs health checks, and deploys to Azure staging only when the release instruction explicitly authorises it. Never invoke as part of ordinary feature work.
---

# opal-release (RELEASE)

**Only run this when the user has explicitly asked for a release or integration
pass.** Deployment additionally requires explicit authorisation in that request —
if the instruction does not say "deploy", stop after validation and report ready.

## Procedure

1. **Establish the tree state.** `git status`, `git log --oneline main..HEAD`,
   `git worktree list`. Identify which commits are in scope. Never absorb another
   session's uncommitted work into the release commit.
2. **Integrate.** Merge or rebase the feature commits onto the release branch.
   Resolve conflicts by understanding both sides — never by taking one wholesale.
   Frontend conflicts in `mockup_v3.html` need both tab blocks kept.
3. **Asset pins.** `node scripts/check-asset-pins.js` (staged mode). Every
   `?v=` pin must match `tests/assessment-surface-guards.test.js`.
4. **Migrations.** From `backend/`: `npm run migrate` against a fresh local
   database, then `npm run migrate:status` — no pending, no drift. Confirm
   migration numbering has no duplicates after the merge.
5. **Full regression.** From `backend/`: `npm run test:all` (unit + integration
   against real Postgres). This is the only level that runs it.
6. **Browser smoke.** `npm run test:e2e:local` from the repo root, or the relevant
   launch config plus the preview tools for the touched surfaces: login,
   scheduler, the changed tab.
7. **Health/readiness.** Start the app and check `/health` and `/ready`
   (`/ready` reports pending migrations).
8. **Deploy — only if explicitly authorised.** Order is fixed:
   **deploy code → run migrations → restart app.** Use the GitHub Actions
   staging workflow, which reuses `ci.yml` as its gate. Never deploy to production
   without a separate, explicit instruction.
9. **Validate staging** with `deploy/staging-validate*.js`, then report.

## Guardrails

- Do not force-push. Do not `git reset --hard` a shared branch.
- Do not deploy on a red suite, a pending migration, or a failed pin check.
- Never print secret values from Azure, GitHub, or local credential files.

## Report

Integrated (commits) · Validation results (each gate, pass/fail) · Deployed
(yes/no, environment) · Staging validation · Outstanding risks.
