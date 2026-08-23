Read `.claude/rules/tests.md`.

Unit (`*.test.js`, no database) and integration (`integration/*.itest.js`, real
local Postgres forced onto a `_test` database, serial) are separate configs. Run
the affected file, not the suite. Concurrent sessions must set
`DB_NAME=therapy_scheduler_<session>` for integration runs.
