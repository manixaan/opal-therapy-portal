# Rule — tests (`backend/tests/**`, `e2e/**`)

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
own database:

```
DB_NAME=therapy_scheduler_<session> npm run test:integration
```

(env.js appends `_test`, globalSetup creates it.)

## Writing tests
- Match the neighbouring file's idiom; `supertest` against the mounted router is
  the house pattern for route tests.
- Assert the guard, not only the payload: an endpoint test that never checks the
  403 path is half a test.
- `tests/assessment-surface-guards.test.js` pins frontend asset versions — when it
  fails, the fix is usually a missed `?v=` bump, not the test.
- Don't run the whole suite to validate one file. Level the validation to the
  change (see CLAUDE.md §6).
