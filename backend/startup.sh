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

# ── Files that used to live beside the code ────────────────────────────────
# With WEBSITE_RUN_FROM_PACKAGE=1 the application folder is a read-only mounted
# zip (that is what makes a deploy take two minutes instead of twenty), so
# anything the app writes lives under /home/data/opal. An earlier deployment
# may have kept Resource Hub files or local documents beside the code: copy
# them across ONCE, never overwriting, before the server starts. Harmless when
# there is nothing to copy, and when the folder is already read-only.
if [ -n "${WEBSITE_SITE_NAME:-}" ]; then
  for pair in ".resource-hub-files:resource-hub-files" "../.local-documents:local-documents"; do
    src="${pair%%:*}"; dst="/home/data/opal/${pair##*:}"
    mkdir -p "$dst"
    if [ -d "$src" ] && [ ! -e "$dst/.copied-from-app-folder" ]; then
      echo "[startup] copying $(find "$src" -type f | wc -l | tr -d ' ') file(s) from $src to $dst"
      cp -an "$src/." "$dst/" || echo "[startup] WARNING: copy from $src was incomplete"
      touch "$dst/.copied-from-app-folder"
    fi
  done
  echo "[startup] run-from-package: ${WEBSITE_RUN_FROM_PACKAGE:-off}"
fi

echo "[startup] applying database migrations…"
node migrate.js up

echo "[startup] starting server…"
exec node server.js
