# SECURITY_REVIEW.md

> Reviewed against code at `5581ab1` + `npm audit` run 2026-07-12. Ratings: ✅ good · ⚠ gap · 🔴 must-fix-before-prod.

## npm audit result (verified 2026-07-12)
**8 vulnerabilities: 5 moderate, 3 high.** Do NOT auto-apply breaking upgrades. Details:

| Package | Severity | Issue | Fix |
|---|---|---|---|
| nodemailer ≤9.0.0 | **high** | Multiple: SMTP command injection, header injection, TLS cert validation in OAuth2 token fetch, addressparser DoS, file/URL access bypass | `npm audit fix --force` → nodemailer@9.0.3 (**breaking** — test all email flows after) |
| ws 8.0.0–8.20.1 (via socket.io/engine.io) | **high** | Uninitialised memory disclosure; memory-exhaustion DoS | `npm audit fix` (non-breaking transitive bump) |
| form-data 4.0.0–4.0.5 | **high** | CRLF injection via unescaped multipart field names | `npm audit fix` (non-breaking) |
| qs 6.11.1–6.15.1 | moderate | DoS in qs.stringify | `npm audit fix` (non-breaking) |
| uuid <11.1.1 | moderate | Missing buffer bounds check (v3/v5/v6 with buf) | `npm audit fix --force` → uuid@14 (**breaking** — the app uses uuidv4 w/o buf; low real risk; test) |

**Recommended action**: run `npm audit fix` (safe transitive fixes for ws/form-data/qs) now; schedule nodemailer + uuid major bumps behind a test pass (ROADMAP Phase 4). Track all in a ticket; re-run audit in CI.

## Authentication ✅ (with one 🔴)
- bcryptjs cost 12; timing-safe compare with dummy hash for unknown users (auth.js:105); session regeneration on login; distinct account-status codes.
- 🔴 OAuth `state` not enforced ("lenient mode", routes.js:183) + dev auto-create of an **owner** for unknown Microsoft emails (routes.js:201) — both must be locked down for prod (KNOWN_ISSUES #12).

## Password handling ✅
- Hashing cost 12 everywhere passwords are set (register, reset). Reset tokens single-use, 1 h, all-session invalidation on reset. Policy: ≥8 chars, upper/lower/number (validatePassword). 🔴 in-app change-password is broken by the bcrypt import (#1) but not insecure.

## Session security ✅
- httpOnly, sameSite=lax, secure-in-prod cookies; 8 h rolling; PostgreSQL-backed (revocable); mass-invalidation on reset/suspend/sign-out-all. Shared safely with Socket.IO.
- ⚠ Rate-limiter and webhook-subscription state are in-memory (per-instance) — fine single-instance, breaks if scaled horizontally.

## CSRF ✅
- Origin/Referer allowlist check on all POST/PUT/PATCH/DELETE (server.js:106-138), strict in prod, exemptions only for OAuth callback + email verify. Combined with sameSite cookies. ⚠ depends on `ALLOWED_ORIGINS` being set correctly for the prod domain.

## CORS ✅
- Allowlist-based, credentials true, no wildcard; mirrored for Socket.IO. ⚠ must set prod origins.

## Rate limiting ⚠
- Login only (10/15 min/IP, in-memory). Registration, password-reset, resend-verification have per-email cooldowns but no IP throttle. Add edge/IP rate limiting for auth endpoints in prod (Phase 4).

## RBAC ✅ (strong)
- Central `permissions.js`; server-side `requireRole`/`requirePermission`; therapist calendar isolation enforced in the query layer, not just middleware (calendar-routes.js:281); covered by tests.
- ⚠ Four duplicate `requireAuth` copies — consolidate to avoid drift (not a vuln today).

## Financial-data restriction ✅
- `stripFinancials` removes rate/revenue/billing fields for non-owners; applied in calendar formatting; unit-tested.

## Account enumeration ✅
- Generic errors on login, forgot-password, resend-verification, register-exists; timing-safe login compare. Good.

## SQL injection ✅
- Parameterised queries throughout ($1,$2…). No string-concatenated user input into SQL found. Dynamic `updateCredential` builds `SET` from a **whitelist** of column names (database.js:1701) — safe. `search` uses parameterised `LIKE`. ✅

## XSS ⚠
- Backend serves a static SPA; main risk is DOM injection in the 23.9k-line frontend. It builds a lot of HTML via template strings + innerHTML with data from Splose/Outlook/user input. Not audited line-by-line here — **needs a dedicated frontend XSS pass** (patient names, event titles, notes rendered into innerHTML). CSP is **disabled** (helmet contentSecurityPolicy:false, server.js:76) because of inline scripts, removing a key mitigation. Enable CSP after modularisation (Phase 9).

## HTML email injection ⚠ (KNOWN_ISSUES #13)
- Names/org/email interpolated into email HTML unescaped (email.js). Escape before prod.

## File uploads ⚠
- PD documents: base64 in JSON, 5 MB cap, mime stored but **not validated/sniffed**, no AV scan, stored in DB TEXT. Low exposure (own-user, owner/admin view) but validate mime + size server-side rigorously and move to object storage (Phase 10). List endpoint correctly excludes file bytes.

## Secret handling ✅
- No secrets in frontend (Maps key proxied; verified an old hardcoded key was scrubbed from archive). `.gitignore` covers `.env`. Startup guards refuse weak SESSION_SECRET / missing TOKEN_ENCRYPTION_KEY in prod. ⚠ Azure tenant ID hardcoded (config, not a secret).

## Token encryption ⚠
- AES-256-GCM for OAuth access/refresh tokens **when TOKEN_ENCRYPTION_KEY is set**; otherwise plaintext pass-through with a warning — **the current local DB stores tokens in plaintext**. 🔴 Must set the key in prod (enforced at boot).

## Microsoft webhook validation ⚠
- `clientState` is checked (routes.js:746) ✅, but the notification body can't be parsed due to the raw-body bug (#6), so notifications are dropped rather than mis-processed — fail-safe but non-functional. Fix + then verify clientState + subscription-id mapping.

## Logging of sensitive info ✅ (mostly)
- Tokens are never logged; emails and user IDs appear in server logs (acceptable operationally, but PII — restrict log access in prod). Splose patient debug routes are owner-only and dev-oriented. `audit_logs` stores actor/action/ip — appropriate. ⚠ ensure prod log storage is access-controlled (health/PII).

## Production CSP 🔴
- Disabled. Enabling it is gated on removing inline scripts (Phase 9). Until then, XSS defence-in-depth is weaker than it should be.

## Overall posture
Backend security fundamentals are **solid** (parameterised SQL, RBAC, CSRF, enumeration defence, encrypted tokens, audit trail). The gaps that matter for go-live: enforce OAuth state + remove owner auto-create (#12), set token-encryption key, escape emails (#13), a frontend XSS pass + CSP, IP rate-limiting, and the npm-audit remediation (nodemailer/ws especially). None are architectural rewrites; all are Phase-4 sized.
