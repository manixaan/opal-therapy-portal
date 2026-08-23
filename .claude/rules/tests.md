# Rule — tests (`backend/tests/**`, `e2e/**`)

## Execution-level contract — what each level may run

This is the authoritative table. CLAUDE.md §6 sets the level; this decides the
commands. Under FAST and FEATURE a `PreToolUse` hook
(`.claude/hooks/test-level-guard.js`, registered from those two skills'
frontmatter) denies the complete-suite commands outright.

| Level | May run | Must not run |
|---|---|---|
| **FAST** | `npx jest tests/<file>.test.js` · `node scripts/check-asset-pins.js` | any complete suite; integration; E2E |
| **FEATURE** | the above, plus `npx jest --config jest.integration.config.js tests/integration/<file>.itest.js --runInBand` | any complete suite; E2E |
| **CRITICAL** | the above, plus a whole related group (`npx jest tests/ai-`, every permission test), migrations on a throwaway database — broad but purposeful, proportionate to the risk | deploy, staging validation |
| **RELEASE** | everything: `npm test`, `npm run test:integration`, `npm run test:all`, `npm run test:e2e:local` | — |

**Running the complete unit/regression suite is not an optional extra confidence
step. At FAST and FEATURE it is prohibited** unless the user explicitly overrides
the level. Never run one:

- as a baseline before implementing;
- as a sweep after implementing;
- "just to be safe";
- because the targeted tests passed;
- because the change feels structurally broad.

Instead: identify the smallest relevant existing tests → run those → add or extend
a regression test for the behaviour you changed → defer complete regression to
RELEASE. If the risk genuinely warrants more, escalate the level (`/opal-critical`)
rather than widening the command.

The user overrides a level by saying so. Then, and only then, prefix the command
with `OPAL_ALLOW_FULL_SUITE=1` — which is the guard's audit trail, not a
workaround to reach for on your own initiative.

## Two suites, two contracts
- **Unit** — `backend/tests/*.test.js`, config `jest.config.js`, setup
  `tests/setup.js`. No database: env vars point at deliberately unreachable hosts.
  Mock `pg`, do not connect.
  `npx jest tests/<file>.test.js` from `backend/`.
- **Integration** — `backend/tests/integration/*.itest.js`, config
  `jest.integration.config.js`, `--runInBand`. Real local Postgres.
  `tests/integration/env.js` forces `DB_NAME` to end in `_test` and refuses
  production-looking names or non-local hosts. `globalSetup.js` creates the
  database, applies `INIT_QUERIES`, then runs migrations.
  `npx jest --config jest.integration.config.js tests/integration/<file>.itest.js --runInBand`.

## Concurrent sessions
The integration suite truncates between tests and `maxWorkers: 1`. Two sessions
sharing one `_test` database will corrupt each other's runs. Give your session its
own database, and select the file you actually need:

```
DB_NAME=therapy_scheduler_<session> npx jest --config jest.integration.config.js tests/integration/<file>.itest.js --runInBand
```

(env.js appends `_test`, globalSetup creates it.) See `.claude/rules/concurrency.md`
for the working-tree side of running alongside another session.

## Writing tests
- Match the neighbouring file's idiom; `supertest` against the mounted router is
  the house pattern for route tests.
- Assert the guard, not only the payload: an endpoint test that never checks the
  403 path is half a test.
- `tests/assessment-surface-guards.test.js` pins frontend asset versions — when it
  fails, the fix is usually a missed `?v=` bump, not the test.
- Don't run the whole suite to validate one file. Level the validation to the
  change — the table above is the contract.
