---
name: opal-critical
description: CRITICAL level for the Opal Therapy portal — changes to authentication, authorisation/RBAC, clinical or employee-sensitive data, the AI gateway and its governance, audit logging, Xero/accounting, database migrations, or shared infrastructure. Allows deeper investigation and broader validation proportionate to risk. Still does not deploy.
---

# opal-critical (CRITICAL)

Use when the change touches: `backend/auth.js`, `backend/permissions.js`, session
or invite/registration flow, `backend/ai/**`, audit logging, case notes or
credential/clinical documents, `backend/accounting-*.js` / `backend/xero-*.js`,
`backend/migrations/**`, or anything every feature depends on.

## Procedure

1. **Read the rule file first** — `.claude/rules/ai-gateway.md`,
   `.claude/rules/database-migrations.md`, or `.claude/rules/backend-api.md`.
2. **Establish the current invariant before changing it.** Find the test that
   encodes it (`tests/ai-gateway-boundary.test.js`, permission guard tests,
   `tests/integration/*`). If no test encodes it, that is a finding — say so.
3. **Enumerate the blast radius**: every caller of the function or middleware you
   are changing, and every role whose access it decides. A targeted
   `grep -rn` over `backend/` is justified here; a repo-wide audit is not.
4. **Implement fail-closed.** Denial is the default; an unresolved question denies.
   Never widen a permission as a side effect. Never log clinical or employee data.
5. **Validate broadly but purposefully:**
   - the full related test group, e.g. `npx jest tests/ai-` or every permission test
   - the affected integration tests with a real database
   - migrations: `npm run migrate` then `npm run migrate:status` on a local
     throwaway database, plus an integration test that exercises the new schema
   - add a regression test for the exact failure you are preventing
6. **State the risk explicitly** in the commit message and the report.
7. **Commit** explicit paths. **Stop.**

## Do not

- Deploy, or run staging validation. That is RELEASE, even for a security fix.
- Weaken or delete a guard test to make a change pass.
- Print, echo, or commit a secret, token, or credential file.

## Report

Implemented · Files changed · Validation · Commit · Risk and residual gaps.
