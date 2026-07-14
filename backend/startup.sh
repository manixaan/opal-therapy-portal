#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  Azure App Service startup command (Linux):
#      bash /home/site/wwwroot/backend/startup.sh
#
#  Applies pending database migrations, then starts the server.
#  - Fail-closed: if a migration fails the app does NOT start (a wrong-schema
#    app serving traffic is worse than a failed deploy — /ready would report
#    pending migrations anyway).
#  - Multi-instance safe: migrate.js holds a Postgres advisory lock, so when
#    several instances start simultaneously only one applies migrations.
#  - Requires app setting MIGRATE_ALLOW_PRODUCTION=true (deliberate opt-in;
#    protects against accidental local runs against the production DB).
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

echo "[startup] applying database migrations…"
node migrate.js up

echo "[startup] starting server…"
exec node server.js
