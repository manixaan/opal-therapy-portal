# DEPLOYMENT_READINESS.md

> Assessed 2026-07-12. **Verdict: NOT production-ready.** Runs cleanly on localhost; multiple hard blockers before a real deployment. Blockers listed at the end.

## Application shape (what a host must support)
- **Single long-running Node process** (Express + Socket.IO on one HTTP server, `server.js`).
- **Stateful in-process background timers**: 90 s Outlook delta poller, 15 min Splose poller, webhook renew (2 days), hourly Friday-alarm check. These are **not external cron** — they live in the process and die if it restarts or if the host scales to multiple instances.
- **WebSocket (Socket.IO)** for live calendar refresh — the host and any proxy must allow WS upgrades and sticky/single-instance routing.
- ⚠ **Do not run more than one instance** without refactoring: the pollers would run N times, the webhook subscription→user map is in-memory per instance, and the login rate-limiter is per-instance. Single-instance (vertical scale) only, until Phase 5/10.

## Intended hosting
Not yet chosen. Requirements: persistent Node process, WebSocket support, ability to reach outbound HTTPS (Graph, Splose, Google, SMTP), env-var config, a managed PostgreSQL. Suitable: a small VM (systemd) or a container platform that keeps one always-on instance (Render/Railway/Fly/a VPS). Serverless/edge is **not** suitable (long-lived timers + WS + in-memory state).

## PostgreSQL hosting
- Any Postgres 13+ reachable via `DB_*` env vars. Schema self-applies on boot (`INIT_QUERIES`) — no separate migration step today (change this in Phase 5).
- Connection pool max 20. Timezone pinned to UTC by the app.
- Local dev DB currently holds ~5.5 k events; migrate/seed strategy for prod = start empty, connect Outlook, let the initial sync populate.

## Build / start
- **Build command**: none (no bundler/transpile). `npm ci` in `backend/` to install.
- **Start command**: `node server.js` (from `backend/`). No Procfile / Dockerfile / systemd unit exists yet — **must be created**.
- `PORT` from env (code default 5000; everything assumes 5001 locally). The frontend's hardcoded `http://localhost:5001` URLs must be removed first (blocker).

## WebSocket support
Required. Socket.IO handshake shares the Express session cookie. Proxy must forward `Upgrade`/`Connection` headers and (if ever multi-instance) use sticky sessions — but single-instance is the supported model.

## Background jobs
In-process timers (above). No external scheduler needed, but this means **exactly one instance** must run them. If the platform restarts the process, jobs resume on boot (delta re-bootstraps from the stored token; Splose/Friday jobs re-run on their next tick).

## Persistent storage
- All state is in PostgreSQL (events, sessions, tokens, HR data, notifications). No local disk writes except transient logs.
- **Exception**: `pd_documents.file_data` stores uploaded files as base64 in the DB (no object storage). Acceptable at zero/low volume; migrate for scale (ROADMAP Phase 10).
- Frontend-only state (localStorage manual addresses + session notes) is **not** persisted server-side — a data-durability gap, not a storage-provisioning one (KNOWN_ISSUES #16).

## Email
SMTP via `EMAIL_*`. If unset, links are logged to the server console (dev mode) — **not acceptable for prod**: invite/verify/reset flows depend on delivered email. Needs a real SMTP provider and SPF/DKIM on the `EMAIL_FROM` domain for deliverability.

## Microsoft Graph
- **Redirect URL**: `MICROSOFT_REDIRECT_URI` must be `https://<domain>/auth/oauth/callback` AND registered in the Azure App Registration. Localhost value won't work in prod.
- **Tenant**: currently hardcoded (KNOWN_ISSUES #14) — parameterise before deploying to a different tenant.
- **Scopes**: `Calendars.ReadWrite offline_access User.Read` — admin consent may be required depending on tenant policy.
- **Client secret** rotation: has an expiry in Azure; track it.

## Microsoft Graph webhooks (optional, real-time)
- Needs a **public HTTPS URL** (`WEBHOOK_BASE_URL`) reachable by Microsoft; won't work on localhost.
- Subscriptions expire ~3 days; the app renews every 2 days (in-memory map — lost on restart, re-registered on boot).
- **Currently broken by the raw-body bug (KNOWN_ISSUES #6)** — fix before relying on webhooks. Until then, the 90 s poller provides sync (max ~90 s lag).

## Splose
- `SPLOSE_API_KEY` (server-side only). ~2 req/s limit — the client queue respects it, but heavy multi-user load could still approach it (all appointment reads fetch the full list).
- No webhook from Splose — cancellations detected only by the 15 min poller.

## Google Maps
- `GOOGLE_MAPS_API_KEY` with Routes, Places (New), Geocoding, Maps JS enabled. Restrict the key (HTTP referrer/IP + API restrictions) in the Google console for prod. Without it, travel features return 503 (rest of app fine).

## Domain / TLS
- A domain with valid TLS is required: secure session cookies (`cookie.secure` in prod) only send over HTTPS; OAuth redirect and webhooks require HTTPS; CORS/CSRF allowlist must list the prod origin (`ALLOWED_ORIGINS`).

## Health checks
- `GET /health` → `{status:'healthy'}` (verified). No dependency checks inside it (doesn't test DB/Graph/Splose) — consider a `/health/deep` for real readiness.

## Logs
- Currently `console.log`/`console.error` to stdout/stderr with emoji tags. No structured logging, no log shipping, no correlation IDs. `sync_log` and `audit_logs` tables provide durable app-level trails. Add centralised logging in Phase 7.

## Error monitoring
- None. Global Express error handler hides messages in prod but doesn't report anywhere. Add Sentry/host-native (Phase 7).

## Database backups & restore
- **None configured.** No automated backups, no tested restore. **Must exist before enabling the pollers in prod** (the empty-response delete bugs make backups doubly important). Restore procedure to define: point-in-time or nightly snapshot → restore to a new instance → repoint `DB_*`.

## Deployment rollback
- Git-based (revert to a prior commit + redeploy). Because the schema self-migrates forward-only with no down-migrations, a code rollback that expects an older schema could mismatch — adopt real migrations (Phase 5) before this is safe. Keep the previous release image/commit ready.

## Database migration procedure
- Today: implicit — every boot runs `INIT_QUERIES` (idempotent, additive). No versioning, no rollback, no drift detection. **Blocker for safe iterative deploys.** Target state (Phase 5): node-pg-migrate with the current schema captured as migration 0001, forward + reversible thereafter.

---

## Production blockers (must clear before go-live)
1. **Hardcoded `http://localhost:5001` in the frontend** (KNOWN_ISSUES #15) — app is unusable off localhost.
2. **Data-loss guards** on the Splose poller and Outlook reconcile (KNOWN_ISSUES #7, #8) — plus backups (below).
3. **Three broken user-facing features** (change-password #1, admin user list #2, onboarding Outlook #4) — core admin/account flows.
4. **No deployment artefact** (Procfile/Dockerfile/systemd) and **no chosen host**.
5. **No database backups / restore runbook.**
6. **OAuth state not enforced + dev owner auto-create** (KNOWN_ISSUES #12) — security hole in prod.
7. **Email must be real** (not console) for invite/verify/reset.
8. **Env not set for a domain** (redirect URI, ALLOWED_ORIGINS, APP_BASE_URL, first-owner allowlist, TOKEN_ENCRYPTION_KEY).
9. **npm audit**: 8 vulnerabilities (3 high incl. nodemailer, ws) — apply safe fixes; plan the breaking ones (SECURITY_REVIEW).
10. **No migration tooling** — forward-only self-migration makes rollbacks risky.

Non-blocking but strongly recommended before real users: fix webhook raw-body (#6) so real-time works, and run the full MANUAL_TEST_PLAN in staging.
