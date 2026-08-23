Backend work: read `.claude/rules/backend-api.md`.

`server.js` mounts every router — grep it to find the file behind a URL.
`permissions.js` is the authoritative RBAC layer; UI role checks are not enforcement.
Schema changes → `.claude/rules/database-migrations.md`.
AI calls → `.claude/rules/ai-gateway.md` (nothing outside `ai/` may call a model).
Tests → `.claude/rules/tests.md`.
