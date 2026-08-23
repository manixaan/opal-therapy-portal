# Rule — backend / API (`backend/**`)

## Finding things
- `backend/server.js` mounts every router. Grep it for the feature name to get the
  file; most routers are mounted at `'/'` and declare their own `/api/...` paths.
- `backend/routes.js` is the legacy catch-all mounted at `/api` — new endpoints go
  in a focused `*-routes.js`, not here.
- Data access sits in `database.js` (pool) and per-feature `*-db.js`. Raw
  parameterised SQL, no ORM. Never interpolate values into SQL.

## Route conventions
- Guard first: `const { requireAuth, requirePermission, requireRole } = require('./permissions')`,
  then `router.use('/api/<feature>', requireAuth)` and a per-route permission or
  role middleware. An endpoint with no guard is a defect.
- `backend/permissions.js` is the authoritative RBAC layer
  (`read_only → therapist → admin → owner`, plus the delegated `onboarding.*` and
  `interviews.*` permissions that are **not** in any role's defaults except owner).
  Adding a permission means adding it there, not checking a role inline.
- Handlers are wrapped in the file's `safe()` async helper — follow the local idiom.
- Error responses must not leak internal detail, SQL, or client data.

## Boundaries
- No AI SDK import outside `backend/ai/` — see `.claude/rules/ai-gateway.md`.
- Schema changes are migrations — see `.claude/rules/database-migrations.md`.
- Sensitive-data endpoints (clinical notes, credentials, employment records)
  are CRITICAL-level work: check auditing and permissions, not just the happy path.
