---
name: opal-fast-change
description: FAST level for the Opal Therapy portal — a small, isolated change (copy fix, one guard, one query, one style rule). Locate the narrow implementation, edit, run only the directly affected tests, make one focused commit, stop. Use when the change is confined to one or two files and carries no auth, migration, AI, or accounting risk.
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/test-level-guard.js" FAST'
          timeout: 10
          statusMessage: Checking test level
---

# opal-fast-change (FAST)

## Procedure

1. **Locate narrowly.** One targeted search. Backend: grep `backend/server.js` for
   the route file. Frontend: grep the `============ TAB` banners in
   `mockup_v3.html`, then read a bounded slice. Stop searching once you have the file.
2. **Read only what you edit** plus its immediate caller if the contract is unclear.
3. **Edit.** Match the surrounding idiom exactly — comment density, naming, guard style.
4. **Validate, narrowly.** From `backend/`: `npx jest tests/<affected>.test.js`.
   If you touched a `frontend/current/*.js` file: bump its `?v=` pin in
   `mockup_v3.html` and in `tests/assessment-surface-guards.test.js`, then
   `node scripts/check-asset-pins.js` after staging.
5. **Commit** the changed paths explicitly (`git add <paths>`), one focused message.
6. **Stop.**

## Start clean

Do not start a FAST change in a primary tree that already holds unrelated
uncommitted work — see `.claude/rules/concurrency.md`.

## Do not

- Audit architecture, map the subsystem, or read files "for context".
- Spawn subagents or run broad fan-out searches.
- **Run a complete suite.** `npm test`, `npm run test:all`,
  `npm run test:integration`, bare `npx jest`, or E2E are prohibited at this
  level — not discouraged. A `PreToolUse` hook denies them while this skill is
  active. See the execution-level contract in `.claude/rules/tests.md`.
- Open a browser or start a dev server.
- Deploy anything, or touch `deploy/**`.
- Restage or revert unrelated dirty files.

## Escalate

If the change turns out to touch auth, permissions, clinical data, AI, migrations,
or accounting, stop and switch to `/opal-critical`.

## Report

Implemented · Files changed · Validation · Commit. Nothing else.
