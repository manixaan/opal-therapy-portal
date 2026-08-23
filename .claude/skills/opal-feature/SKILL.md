---
name: opal-feature
description: FEATURE level for the Opal Therapy portal — normal feature development spanning a route, its data access, and its frontend tab. Understand only the affected subsystem, implement, run affected unit and integration tests, verify in the browser only where it proves something, one focused commit. Use for ordinary feature or fix work that is not release integration.
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: 'node "${CLAUDE_PROJECT_DIR}/.claude/hooks/test-level-guard.js" FEATURE'
          timeout: 10
          statusMessage: Checking test level
---

# opal-feature (FEATURE)

## Procedure

0. **Start clean.** If the primary tree holds unrelated uncommitted feature work,
   implement in an isolated worktree — see `.claude/rules/concurrency.md`.
1. **Scope the subsystem, not the repo.** Read the matching `.claude/rules/` file,
   the route file, its `*-db.js`, and the frontend `<feature>.js`. Resolve
   dependencies only where the change actually crosses a boundary.
2. **Plan briefly in-head.** No written design document unless the user asked.
3. **Implement.** Follow the house patterns: `requireAuth` + a permission/role
   guard on every route, parameterised SQL, `safe()` handler wrappers, globals on
   `window` for frontend, no new dependencies without asking.
4. **Schema?** A new column or table is a new `backend/migrations/NNN_*.sql` —
   append-only, never edit an applied file. Run `npm run migrate` locally.
5. **Validate — targeted only:**
   - affected unit files: `npx jest tests/<file>.test.js`
   - affected integration files:
     `npx jest --config jest.integration.config.js tests/integration/<file>.itest.js --runInBand`
   - add or extend a test for the behaviour you added, including its 403 path
   - frontend change → bump `?v=` pins, then `node scripts/check-asset-pins.js`
6. **Browser check only when it proves something** a test cannot — new rendering,
   a layout, an interaction. Use the launch config for the relevant port
   (`.claude/launch.json`) and the preview tools. Skip it otherwise.
7. **Commit** explicit paths, one message. **Stop.**

## Do not

- **Run a complete suite.** `npm test`, `npm run test:all`,
  `npm run test:integration` and E2E are prohibited at this level — not
  discouraged, and not an optional extra confidence step. A `PreToolUse` hook
  denies them while this skill is active. See the execution-level contract in
  `.claude/rules/tests.md`.
- Deploy, validate staging, or run anything in `deploy/`.
- Refactor adjacent code that is not part of the change.
- Modify, restage or revert another session's dirty files.
- Write a report file unless asked.

## Report

Implemented · Files changed · Validation · Commit · Integration notes (only if
another session or a follow-up task is affected).
