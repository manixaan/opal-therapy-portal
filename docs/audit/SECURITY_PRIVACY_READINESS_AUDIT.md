# Security, Privacy & Compliance Readiness Audit

Scope: is the portal appropriate for a real second therapist with access to
real client-adjacent data? Context: Australian Privacy Act (APPs), NDIS
Practice Standards, health-adjacent data (client names, addresses, NDIS
numbers, appointment content in a mirrored clinician calendar).

**Verdict: the cryptographic/session/infrastructure core is genuinely
strong; the internal privacy boundary is missing. Two Critical and six
High findings must be addressed (or consciously accepted by the owner in
writing) before a second person gets an account.**

## What is genuinely solid (verified in code)

- Sessions: PG-backed, httpOnly, sameSite=lax, rolling 8h, fixation-safe
  (regenerate on login), logout + sign-out-all destroy server-side rows
  (`server.js:235-249`, `auth.js:159-267`).
- Passwords: bcrypt(12), timing-safe dummy-hash compare, enumeration-safe
  401s, complexity policy on register/reset (`auth.js:35-125`).
- Tokens (Microsoft + Xero) AES-256-GCM encrypted at rest; decrypt only at
  API choke points; loud dev-only passthrough (`crypto-utils.js:48-122`).
- Fail-closed env guards: production refuses weak/missing secrets
  (`server.js:196-227`, `env-validation.js`).
- Log + telemetry redaction (Bearer/JWT/hex/secret-keys; paths only, never
  query strings); App Insights processor scrubs before egress
  (`logger.js:34-151`, `telemetry.js:25-60`).
- Upload hardening: MIME+extension allowlist, agreement check, traversal
  rejection, 5MB cap, script-capable formats refused; integration-tested
  (`profile-routes.js:333-366`, `security.test.js:189-207`).
- Webhooks: Graph clientState verified; Xero HMAC with timingSafeEqual;
  OAuth state hard-403 pre-token-exchange in prod/staging (tested).
- Owner-only surfaces genuinely enforced: /api/admin/*, all accounting,
  master calendar, Splose debug routes.
- Audit logging with IP and no clinical content across auth, lifecycle,
  documents, approvals, sync safety, finance.
- Write-to-external-systems posture: Outlook/Splose/Xero writes all
  fail-closed via flags in cloud environments — with one exception (C2).

## Findings

### CRITICAL

**C1 — No RBAC on the Splose proxy: whole-practice PII + financials to any
authenticated account.** Every `/api/splose/*` read route is
requireAuth-only: patients (names, home addresses, NDIS numbers, mobiles,
emails — `routes.js:1930`, field map `splose-api.js:447-484`; `/:id` even
returns the raw Splose record), all practitioners' appointments incl. notes
(`routes.js:1563`, practitionerId is a client-supplied param), cases,
contacts, invoices, payments (`routes.js:1977-2076`). `requirePermission`
is imported and used zero times in routes.js. The permission model
(`permissions.js:20-85`) is aspiration, not enforcement; the frontend hides
tabs but therapist-visible tabs (Activity, Contacts, Smart Booking,
Logbook) fetch the same data anyway, including invoice/payment dollar
amounts (`mockup_v3.html:17853-17866`). Under APP need-to-know framing this
is indefensible for a compromised or careless account, and it contradicts
`docs/SECURITY_CHECKLIST.md`'s own data-minimisation item.
*Fix:* role-gate the Splose routes at the backend (financials → owner/admin
only; patient list → decide caseload model or accept-with-signoff);
add the missing therapist/read_only 403 assertions to permissions tests.

**C2 — Ungated Splose WRITE path bypassing the feature flag.**
`POST /api/splose/patients` calls axios directly with the raw org API key,
skipping `splose-api.js` and `ENABLE_SPLOSE_WRITE` entirely
(`routes.js:1943-1958`) — live even on staging today, usable by any
therapist account (read_only is blocked only because the choke point in
`permissions.js` catches POSTs — but see H3). A mistyped test creates a
real patient in the production practice-management system.
*Fix:* route through the flag-gated client or delete the route.

### HIGH

**H1 — Offboarding does not revoke Microsoft tokens.** Deactivate/suspend
delete sessions but never clear `access_token/refresh_token`
(`app-routes.js:1446-1471`); no Graph-side revocation exists anywhere.
**H2 — The poller keeps syncing deactivated users' mailboxes** — user
selection is `WHERE access_token IS NOT NULL` with no is_active filter
(`server.js:573-575`); a departed staffer's mailbox is ingested
indefinitely and their refresh token kept alive.
**H3 — routes.js bypasses the read_only/permission choke point** with its
own bare `requireAuth` (`routes.js:72-92`); read_only can POST /api/events;
therapists can hit Splose/Outlook write routes whenever env flags allow
(they default ON in NODE_ENV=development).
**H4 — Stored XSS surface × unsafe-inline CSP.** User-authored fields are
rendered via unescaped innerHTML in the owner's approval views (leave
reasons, CPD titles, credential names — `mockup_v3.html:8516-9055`),
resource cards (`6849-6861`, plus unsanitised external_url href), and
Splose-sourced names (`7608-7615`). CSP allows 'unsafe-inline' scripts
(`server.js:100`), so one stored XSS = full session of whoever views it —
including the owner from a therapist-authored record (privilege escalation
across the trust boundary). An `escapeHtml` helper exists and is unused.
**H5 — The only live environment runs weakened.** NODE_ENV=staging turns
OFF the secure cookie flag and CSRF 403 enforcement (`server.js:243,183`)
on the app real users touch.
**H6 — PII in server logs.** Missing-address appointments log the
patient's full name + raw address fields (`routes.js:1617`); sync paths
console.log staff emails outside the redacting logger — production log
access becomes a de-facto patient register.

### MEDIUM

- No per-account lockout; one in-memory per-IP limiter (10/15min) shared by
  the whole clinic NAT; resets on restart; X-Forwarded-For spoofable if
  ever deployed without a proxy (trust proxy=1 unconditional).
- change-password: no other-session invalidation, no rate limit, length-8
  only (weaker than register/reset policy) (`app-routes.js:942-980`).
- No rate limiting beyond auth (register, check-invite, reset, Splose
  proxy, billable Maps proxy).
- No MFA anywhere (the Settings menu label advertises it); no break-glass
  owner recovery (forgotten owner password ⇒ Azure logs or SQL).
- Email-verification and reset tokens stored plaintext and matched raw
  (`auth.js:332-337,508-513`) — DB read compromise = account takeover links.
- Clinical session notes in browser localStorage only; Splose SWR caches in
  sessionStorage are not cleared on logout (shared-machine exposure).
- Plaintext client_name / ndis_plan_expiry in events rows (no field-level
  encryption — accepted risk to date, unrecorded).
- Blob storage: no soft-delete/versioning — deleted employee documents are
  unrecoverable; `check-invite` returns an account-exists oracle;
  `_patientRawAddress` debug fields attached whenever NODE_ENV≠production.
- No data-retention/pruning policy for tombstones, notifications, audit
  logs (only expired sessions are pruned).

### LOW

- CSP connect-src allows bare ws:/wss: to any host; CSRF middleware passes
  Origin-less requests; committed fallback Entra tenant id; hardcoded dev
  webhook clientState (blocked in prod/staging by env-validation); OAuth
  error page interpolates error.message unescaped; Content-Disposition
  non-RFC5987.

## Specific questions answered

- **Therapist sees only what they should?** No — see C1. Calendar events
  are correctly per-user isolated (the local mirror IS scoped:
  `calendar-routes.js:280-296`, financial strip for non-owners), but the
  Splose surface gives everyone everything.
- **Outlook token storage?** Encrypted at rest, decrypt-at-choke-point,
  never logged. Good — but not revoked on offboarding (H1/H2).
- **Xero/accounting risk?** Minimal to the therapist: owner-only enforced
  at the backend, writes triple-gated + proven, never connected. Extraction
  to Opal Finance planned; nothing needed pre-launch.
- **Resource Hub file access?** Auth-only downloads, governance lifecycle,
  role checks — good. XSS in card rendering (H4) and 100KB upload trap.
- **Backups?** PG PITR 14d confirmed live; never restore-tested; blob
  documents unprotected (Medium).
- **Staging vs production data?** One environment holds synthetic accounts
  + the owner's real mailbox mirror + live Splose data simultaneously —
  neither properly staging nor production. Clean-up + environment split is
  part of launch (see HOSTING doc).
- **What happens when staff leave?** Sessions die; tokens live on (H1/H2);
  no offboarding checklist exists. Write one alongside the fix.
- **Read-only integrations safe?** Splose reads: transport yes, exposure
  no (C1). Outlook read pipeline: yes, validated, deletion-safe.
- **Clinical/client data stored unnecessarily?** Event rows store client
  names (needed for display); localStorage notes are the real problem —
  clinical text on unmanaged devices outside any backup/audit boundary.
- **Appropriate for real therapist access?** After C1/C2 + H3/H4/H5 are
  fixed and the environment decision is executed: yes, for a supervised
  pilot. Today: no.

## Pre-second-user requirement list (minimum)

1. C1: backend role-gates on Splose routes (financial routes owner/admin;
   caseload decision for patients/appointments).
2. C2: gate or remove the direct patient-create route.
3. H3: single requireAuth (permissions.js) everywhere.
4. H4: escape user-authored/Splose-sourced rendering (helper exists);
   allowlist http(s) on external_url.
5. H5: strict cookies/CSRF outside development (or move users to
   production).
6. H1/H2: clear tokens + skip inactive users in the poller (2 small
   changes); write the offboarding checklist.
7. Owner sign-off (written) on remaining Mediums as accepted pilot risk.
