# Security & Privacy Checklist — Opal Therapy Scheduler

**Last updated:** June 2026
**Applies to:** Any deployment beyond localhost (cloud, shared network, Ann's device)

---

## Why this matters

This app handles **sensitive information** under the Australian Privacy Act 1988:
- Health information (diagnoses, NDIS numbers)
- Personal identifiers (DOB, addresses, phone numbers)
- Financial data (invoices, payments)
- Minor patient data (some clients are children)

NDIS participants have additional protections under the NDIS Act 2013. Breaches must be reported to the OAIC within 30 days.

---

## ✅ Already done (June 2026)

- [x] Splose API key stored in `.env`, never in code
- [x] Microsoft OAuth credentials stored in `.env`
- [x] Session secret replaced with 96-char random value
- [x] Session timeout set to 8 hours with rolling reset
- [x] `httpOnly` cookies (JS cannot read the session token)
- [x] CORS locked to localhost only
- [x] Patient PII removed from server console logs
- [x] Duplicate sync requests blocked (concurrency guard)

---

## ⚠️ Before giving Ann access (or any second user)

- [ ] **HTTPS** — Deploy behind a reverse proxy (nginx/Caddy) with a valid TLS certificate. Never serve the app over plain HTTP outside localhost.
- [ ] **Strong DB password** — `DB_PASSWORD=postgres` must be changed to a random password before cloud deployment.
- [ ] **Role-based access** — Add a `role` field to users (admin / therapist). Antony sees billing + all client data; Ann sees only scheduling and her own clients.
- [x] **Session store** — Sessions are PostgreSQL-backed (`backend/session-store.js`, the `sessions` table) and survive restarts.
- [x] **Login rate limiting** — In-memory, no extra dependency (`backend/request-safety.js`): 10 login attempts per client IP per 15 minutes (the IP is normalised, so Azure's `ip:port` forwarding cannot bypass it), plus 10 failed attempts per submitted email per 15 minutes from any IP (same generic message, so it does not reveal whether an account exists). `/api/auth/check-invite` has its own per-IP limit. Counters are per instance and reset on restart. Splose proxy endpoints are not rate limited.
- [ ] **Audit log** — Log every access to patient data (who, what endpoint, when). Store in a `audit_log` table. Required for Privacy Act compliance.
- [ ] **Data minimisation** — Patient list endpoint should return only fields needed for the UI (name, suburb, NDIS number) — not emergency contacts, diagnoses, birthdates — unless the full profile is explicitly requested.

---

## ⚠️ Before cloud deployment

- [ ] **Australian data residency** — Host PostgreSQL in an Australian region (AWS Sydney / Azure Australia East). Patient health data must stay in Australia under the Privacy Act.
- [ ] **Encrypt sensitive fields at rest** — NDIS numbers, diagnoses, DOBs should be encrypted in the database (not just secured at the OS level).
- [ ] **Rotate secrets** — Generate new SESSION_SECRET, DB_PASSWORD, and SPLOSE_API_KEY for production. Never reuse dev credentials.
- [ ] **Environment separation** — Use separate Splose API keys and Microsoft OAuth apps for dev and production.
- [ ] **Automated backups** — Daily DB backups with 30-day retention, stored encrypted in a separate AWS/Azure region.
- [ ] **Error tracking** — Set up Sentry (or similar) so errors are captured without logging patient data. Configure `beforeSend` to scrub PII from error payloads.
- [ ] **Security headers** — Add `helmet` middleware: `X-Frame-Options`, `Content-Security-Policy`, `Strict-Transport-Security`.
- [ ] **Dependency audit** — Run `npm audit` before deployment and resolve any high/critical vulnerabilities.
- [ ] **Privacy policy** — Publish a plain-English privacy policy explaining what data is collected, why, and how long it's kept. Required under APP 1.

---

## 🔴 Never do

- Never log patient names, diagnoses, NDIS numbers, or financial amounts to the console or error tracking tools.
- Never store the Splose API key or OAuth secrets in code, git history, or Slack messages.
- Never expose the backend port (5001) directly to the internet — always put it behind a reverse proxy.
- Never use `origin: true` in CORS config outside localhost.
- Never disable HTTPS in production.

---

## Contacts

- **OAIC (Privacy regulator):** oaic.gov.au · 1300 363 992
- **NDIS Commission (NDIS-specific privacy):** ndiscommission.gov.au
- **Notifiable Data Breaches scheme:** Must report eligible breaches within 30 days.
