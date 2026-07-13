# ENVIRONMENT_VARIABLES.md

> All values below are placeholders. The real `.env` lives at `backend/.env`, is gitignored, and must never be committed or copied into documentation.

## Redacted `.env.example` (complete — supersedes the checked-in one, which is missing several vars)

```bash
# ===== Server =====
PORT=5001                        # code default is 5000; ALL frontend hardcoded URLs assume 5001
NODE_ENV=development             # 'production' activates: strict CSRF, secure cookies, secret guards, TLS cert checks

# ===== PostgreSQL =====
DB_HOST=localhost
DB_PORT=5432
DB_NAME=therapy_scheduler
DB_USER=postgres
DB_PASSWORD=REPLACE_ME

# ===== Sessions & token encryption =====
SESSION_SECRET=REPLACE_WITH_48_RANDOM_BYTES_HEX      # ≥32 chars enforced in prod (server.js:144-165)
TOKEN_ENCRYPTION_KEY=REPLACE_WITH_64_HEX_CHARS       # 32 bytes hex; REQUIRED in prod (server.js:168-174)
                                                     # generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# ===== Microsoft OAuth (Azure App Registration) =====
MICROSOFT_CLIENT_ID=REPLACE_ME
MICROSOFT_CLIENT_SECRET=REPLACE_ME
MICROSOFT_REDIRECT_URI=http://localhost:5001/auth/oauth/callback   # must EXACTLY match Azure config

# ===== Splose =====
SPLOSE_API_KEY=REPLACE_ME
SPLOSE_BASE_URL=https://api.splose.com

# ===== Google Maps =====
# APIs required on the key: Routes API, Places API (New), Geocoding API, Maps JavaScript API
GOOGLE_MAPS_API_KEY=REPLACE_ME

# ===== Email (SMTP) — optional in dev (links are logged instead) =====
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_SECURE=false               # true only for port 465
EMAIL_USER=REPLACE_ME
EMAIL_PASS=REPLACE_ME
EMAIL_FROM="Opal Therapy <noreply@example.com>"
APP_BASE_URL=http://localhost:5001    # used to build verify/reset/invite links in emails

# ===== Registration allowlist (production MUST set at least the first owner) =====
ALLOWED_DOMAINS=                 # comma-separated, e.g. example.com.au
ALLOWED_EMAILS=                  # comma-separated exact addresses — REQUIRED for first-owner bootstrap

# ===== CORS / CSRF =====
ALLOWED_ORIGINS=http://localhost:5001,http://127.0.0.1:5001   # set to https://your-domain in prod

# ===== Outlook webhooks (production only — needs public HTTPS) =====
WEBHOOK_BASE_URL=                # e.g. https://app.example.com (no trailing slash); empty = polling only
WEBHOOK_CLIENT_STATE=REPLACE_WITH_RANDOM_SECRET
```

## Per-variable reference

| Variable | Required | Referenced in | Missing ⇒ |
|---|---|---|---|
| PORT | optional | server.js:371 | listens on 5000 — **breaks frontend hardcoded 5001 URLs** |
| NODE_ENV | optional | server.js (guards, cookie.secure, CSRF strictness, error detail), email.js (TLS), routes.js (debug field) | dev behaviour everywhere |
| DB_HOST/PORT/NAME/USER | optional | database.js:43-48 | localhost/5432/therapy_scheduler/postgres defaults |
| DB_PASSWORD | required | database.js:48 | pool auth failure → boot logs DB init error; API 500s |
| SESSION_SECRET | **required (prod: enforced)** | server.js:152-182 | dev: warning + insecure default; prod: process exits |
| TOKEN_ENCRYPTION_KEY | **required in prod (enforced)** | crypto-utils.js, server.js:168 | dev: tokens stored **plaintext** with warning (current local state); prod: exit |
| MICROSOFT_CLIENT_ID/SECRET | required for Outlook | outlook-oauth.js:20-21 | OAuth flow fails at authorize/token step |
| MICROSOFT_REDIRECT_URI | required | outlook-oauth.js:22 | defaults to `http://localhost:5001/auth/oauth/callback` — prod must override AND match Azure |
| SPLOSE_API_KEY | required for Splose | splose-api.js:26, routes.js (2 direct-axios spots: raw-patient debug, create-patient) | every Splose proxy route 500s |
| SPLOSE_BASE_URL | optional | splose-api.js:20, routes.js debug routes | defaults to https://api.splose.com |
| GOOGLE_MAPS_API_KEY | required for travel features | maps-routes.js:32; status check reads GOOGLE_API_KEY as alt name (app-routes.js:917) | maps routes return 503; travel/geocode UI degrades |
| EMAIL_HOST/PORT/SECURE/USER/PASS/FROM | optional | email.js:31-60 | transport skipped; verify/reset/invite links printed to server console (current dev workflow) |
| APP_BASE_URL | required when email on | email.js:61 | links point at localhost:5001 |
| ALLOWED_DOMAINS / ALLOWED_EMAILS | required for self-registration | register-routes.js:36-40 (read at require-time!) | nobody can self-register; **fresh prod deploy cannot create its first owner** without one of these |
| ALLOWED_ORIGINS | required in prod | server.js:47 (CORS + Socket.IO + CSRF check) | localhost-only allowlist; prod cross-origin requests 403 |
| WEBHOOK_BASE_URL / WEBHOOK_CLIENT_STATE | optional | server.js:613-709, routes.js:743 | polling-only (logged at boot); CLIENT_STATE falls back to a **hardcoded default string** — always set it when webhooks are on |

Note: `ALLOWED_DOMAINS`/`ALLOWED_EMAILS` are read **at module load**, so changing them requires a server restart (tests set them before requiring modules for this reason — `tests/setup.js`).

## Hardcoded configuration that should move to env / a config module

| What | Where | Value style | Action |
|---|---|---|---|
| **Azure tenant ID** | `backend/outlook-oauth.js:23-27` — `tenantId` field **and** embedded in `authorizationUri`/`tokenUri` | a GUID literal, 3 occurrences | Add `MICROSOFT_TENANT_ID`; build URLs from it. Currently binds the app to one Azure tenant. |
| **`http://localhost:5001` in frontend** | `frontend/current/mockup_v3.html` — 9 occurrences (verified): lines ~6853 (splose appointments in scheduler), 6983, 7065, 7213, 7231, 7241, 7301 (bootstrap config: patients/cases/services/practitioners/locations/outlook-categories), 9074, 9184, 14816, 15593, 15836, 16589, 16785, 16961 (event loading + travel/logbook/billing loaders) | absolute URLs | Replace with relative paths (same-origin — the backend serves the frontend) or a single `API_BASE = ''` constant. **Deployment blocker.** |
| Fallback port 5001 in OAuth redirect default | outlook-oauth.js:22 | URL literal | covered by MICROSOFT_REDIRECT_URI |
| Webhook clientState fallback `'opal-scheduler-webhook'` | server.js:629,656; routes.js:743 | string literal | require env in prod |
| Practice defaults ('Opal Therapy', km rate 0.88, org_id 'opal') | email.js, app-routes.js:866, org_settings PK default | literals | acceptable; single-tenant by design |
| Perth timezone offset (+08:00) | frontend time maths (`+08:00` ISO suffixes, UTC+8 conversions) & `Australia/Perth` in backend queries | literals | acceptable for a Perth-only practice; document as a constraint |
| Splose practitioner/location seed IDs & service-ID map | mockup_v3.html:7199-7205 (`TYPE_SERVICE_ID`, SPLOSE_CONFIG) | numeric literals, overwritten at boot by live bootstrap | acceptable (bootstrap corrects them); do not rely on the literals |
