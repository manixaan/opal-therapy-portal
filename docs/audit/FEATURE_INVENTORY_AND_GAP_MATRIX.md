# Opal Portal — Feature Inventory & Gap Matrix

Audit date: 2026-07-31 · Repo at `main` = `8c893bf` (= deployed staging build).
Evidence-based: every claim was verified against code (file:line) by a
10-reader audit pass; nothing below is taken from docs on trust.

---

## Part 1 — Current application inventory

### Application foundation

| Item | State |
|---|---|
| Stack | Node 22 + Express 4 + PostgreSQL 16 (pg, no ORM), vanilla-JS frontend |
| Backend | ~16,900 lines across route modules (`routes.js` 2,572 lines is the largest); Socket.IO server (per-user rooms); background pollers in-process (Outlook delta 90s, Splose cancellations 15min) — single-instance only |
| Frontend | ONE 24,460-line file `frontend/current/mockup_v3.html` served behind auth, plus 7 standalone auth pages (login/register/onboarding/verify/reset/forgot/pending). No build step, no framework, no tests, `<title>` literally says "v2 Mockup", and the DOCTYPE at HEAD is corrupted (quirks mode) with a stray button spliced into line 1–2 |
| Database | PG Flexible Server B1ms, PG 16, 32 GB, **14-day PITR backups (never restore-tested)**, no HA, no geo-redundancy. Migrations: checksummed `NNN_*.sql` ledger 000–006, advisory-locked, run at container start (fail-closed) |
| Hosting | Azure App Service B1 Linux (`opal-portal-staging`), Always On, TLS≥1.2, HTTPS-only, health check on `/ready`. **Staging is the ONLY environment — production has never been provisioned** |
| CI/CD | GitHub Actions: syntax check, 151 unit + 104 integration tests on a real PG16 container, migration validation, zero-vuln npm audit, .env-leak grep, OIDC deploys, health-gated. Push to `main` auto-deploys staging; production workflow exists but targets a nonexistent app |
| Environments | `NODE_ENV=staging` on the live app — which silently disables the `secure` cookie flag and CSRF 403 enforcement (both production-only in `server.js:243,183`) while env-validation treats staging as strict. The only environment real users touch runs with weakened protections |
| Secrets | Azure Key Vault (RBAC) + managed-identity references; OIDC (no stored cloud creds); tokens AES-256-GCM at rest; known gotcha: KV reference rotation requires app-setting rewrite (runbook still wrongly says restart suffices — `AZURE_DEPLOYMENT.md:336`) |
| Health | `/health` liveness (dependency-free) + `/ready` (DB, migrations, env, drain-aware 503) — solid |
| Logging/monitoring | Redacting structured logger + redacting App Insights telemetry; 3 hand-made alert rules → one email; no IaC for alerts; no alert for the mass-deletion safety block or login attacks |
| Audit logging | Real and broad: auth events, account lifecycle, document access, approvals, sync safety, finance actions — with IP, no clinical content |
| Storage/documents | db/local/private-Azure-Blob backends, authenticated downloads only, hardened upload validation (MIME+extension+traversal+5MB). **Blob has no soft-delete/versioning — deleted documents are gone forever** |

### Authentication and users

- **Login**: bcrypt(12), timing-safe, session regeneration, per-IP rate limit (10/15min — shared by the whole clinic NAT), account-status gating. Solid.
- **Invite flow**: full API + owner UI (modal, list, revoke, resend)… but **the app cannot send email** — no EMAIL_* config exists in any environment (staging sets only EMAIL_PASS as a KV ref, never EMAIL_HOST — `staging-provision.sh:131`), so every invite/verification/reset/approval email silently degrades to a console.log on the server, while the UI says "✓ Invite sent!" and never shows the registration link the backend actually returns (`invite-routes.js:151` vs `mockup_v3.html:22050`).
- **Onboarding**: genuine 9-step wizard with backend-persisted resume. Works.
- **Password reset**: implemented end-to-end, but the reset link only ever appears in server stdout (no SMTP), and without APP_BASE_URL links read `http://localhost:5001/...`.
- **Roles**: owner / admin / therapist / read_only with a real permission map — but enforcement is split: `permissions.js` has the read_only write-block choke point, while `routes.js` uses its **own** `requireAuth` without it, and none of its ~25 Splose proxy routes check roles at all.
- **Contradictions**: invited users still land in `pending_approval` despite code comments saying invites skip it (`auth.js:350`); the invite UI can't set `isTreatingTherapist`, so an invited therapist gets **no therapist_profile → empty calendar, and no UI exists to fix it** (owner-only API `POST /api/therapists` has zero frontend callers).
- **Manual owner steps to add a therapist today**: (1) M365 mailbox in the practice tenant, (2) Splose practitioner record, (3) send invite from Settings, (4) **fish the registration link out of Azure log stream**, (5) therapist registers + verifies via another logged link, (6) owner approves in Settings→Team, (7) **owner crafts a curl to POST /api/therapists with splosePractitionerId** (no UI), (8) therapist connects Outlook. Steps 4–5 and 7 are the killers.

### Core therapist portal

- **Dashboard**: none — default landing is the Smart Booking wizard headed "Ann · Mon 20 Apr – Fri 24 Apr 2026" (hardcoded).
- **Calendar**: genuinely good underneath — Day/Week/Month + owner Master view, real synced data, category colours, conflict/rural badges, weekend toggle, Outlook-only filter. See gaps in matrix rows 6–9.
- **Profile**: real leave/CPD/PD-documents/credentials sections, wired end-to-end (see rows 13–15).
- **Travel bases**: work-location schedule + travel bases persisted per user (JSONB, autosave); Google Routes travel overlays via backend proxy.
- **Leave/availability**: submit + owner approve/reject works; **approved leave affects nothing** (no calendar block, no availability change) despite UI copy claiming it blocks Splose scheduling; no balances; no notifications on decisions ("staff will be notified" toast is false).
- **CPD/PD**: activity logging + approval + 30h-target notifications work; dollar allowance is concept-only; PD documents upload but **cannot be downloaded from the UI** (no button), and owner/admin cannot view employees' documents at all.
- **Resources**: read-only list works; **no authoring/approval UI at all** (API-only) and the resources file-upload API is capped by the global 100KB body limit — unusable for real PDFs (`server.js:140-142`). Content: zero folders, zero resources everywhere.
- **Documents/employee info**: PD documents as above. Induction, policies, supervision, staff emergency contacts: **do not exist in any form**.
- **Missing day-one functions**: usable invite→login path without log-fishing, therapist-profile creation UI, a truthful landing page, seeded Resource Hub, working notifications on approvals.

### Integrations

- **Outlook**: the most mature subsystem. 90s delta sync + seriesMaster guard + fail-closed deletion safety + periodic reconciliation + optional Graph webhooks; validated mirror 65=65 (2026-07-27); per-user isolation sound. Gaps: **no disconnect endpoint anywhere**; `/api/sync-status` reports connected if ANY org member is connected, masking the new therapist's own not-connected state behind a green pill showing someone else's email; the calendar's re-auth path navigates to a raw JSON page; token-expiry warnings fire false daily alarms (they check the 1-hour access token); refresh-token death is silent.
- **Splose**: transport layer solid (server-side key, throttle, pagination, fail-closed cancellation poller). **No privacy boundary**: all ~20 read routes are requireAuth-only → any authenticated account can pull every client's name/address/NDIS number/phone plus all invoices/payments; `splose_practitioner_id` mapping exists but is never used to scope a single query; **POST /api/splose/patients bypasses the write flag entirely** via direct axios (`routes.js:1943-1958`). Clinical session notes live in browser localStorage only.
- **Google Maps/Places**: backend-proxied routes/places/geocode + travel overlays; key server-held; no rate limit on the billable proxy.
- **Xero/Accounting**: owner-only, backend-enforced, read-only, writes triple-gated and proven fail-closed (READY FOR STAGING REVIEW at 8c893bf). **Decision made to extract to a separate Opal Finance app** — transfer pack complete on branch `opal-finance-transfer` + `opal-finance-transfer-pack.zip`. Xero has never been connected; all finance tables empty.
- **Resource Hub**: covered above.
- **Socket.IO live refresh**: server side real and room-scoped; **client side dead in the deployed app** — socket.io and Chart.js load from CDNs that the unconditional helmet CSP blocks (`server.js:95-101` vs `mockup_v3.html:15137,18797`), and the file contains **zero setInterval** — so no open tab ever refreshes after page load. The header pill "Synced with Splose · 14s ago" is static decoration.

### Deployment

- Runs at **https://opal-portal-staging.azurewebsites.net** (HTTPS-only, valid cert). No custom domain bound (portal.opaltherapy.com.au documented, never executed). No production. Staging doubles as CI target — any merge to main redeploys the app real users are on, mid-day. Before therapist access: environment decision (see HOSTING doc), email, synthetic-account cleanup (4 @example.test accounts sharing one password), stale `ALLOWED_EMAILS=synthetic.owner@example.test` setting.

---

## Part 2 — Readiness matrix

Statuses: READY · MOSTLY READY · PARTIALLY READY · BUILT BUT NEEDS POLISH · PROTOTYPE ONLY · PARKED · NOT BUILT · RISKY / NEEDS FIX

| Area | Current status | Evidence | Risks / holes | Required before therapist starts | Priority |
|---|---|---|---|---|---|
| 1. Login/auth | MOSTLY READY | bcrypt/session-regen/rate-limit/status-gating (auth.js:105-180) | Shared-IP 10/15min lockout for whole clinic; no per-account lockout; no MFA; change-password weak policy + keeps other sessions | Accept for pilot; raise IP limit or per-account limiter; align change-password policy | P1 |
| 2. User invitation | RISKY / NEEDS FIX | Full API+UI exists (invite-routes.js, mockup 5726-5760) but **email cannot send**; UI lies "Invite sent!"; link only in server logs; localhost links without APP_BASE_URL | Day-one stall in front of the new hire, ×3 (invite, verify, approval) | Configure SMTP (e.g. M365) + APP_BASE_URL; surface registerUrl in UI as fallback | **P0** |
| 3. Therapist onboarding | PARTIALLY READY | 9-step wizard solid (onboarding.html:707-903) | Invitee lands in pending_approval anyway; **no therapist_profile from UI invite** → empty calendar; order-sensitive undocumented sequence | Fix invite→active + isTreatingTherapist/profile creation (UI or documented API step); write the runbook | **P0** |
| 4. Profile page | MOSTLY READY | Real sections wired (mockup 8484-9271) | Stored-XSS in approval views; drafts are dead ends; no download button on documents | Escape rendering; add document download | P1 |
| 5. Address/travel base | MOSTLY READY | Work-location + travel bases persisted (profile-routes.js:640-683) | Manual Splose addresses in localStorage only | Acceptable; note limitation | P2 |
| 6. Outlook connection | RISKY / NEEDS FIX | OAuth solid, session-safe (routes.js:203-330) | Masked not-connected state (org-wide sync-status, routes.js:1055-1077); re-auth lands on raw JSON (mockup 15349); **no disconnect**; wrong-mailbox recovery undocumented | Per-user sync-status; fix re-auth redirect; add disconnect (or documented recovery) | **P0** |
| 7. Outlook sync accuracy | READY | 65=65 validated; seriesMaster guard; deletion safety tested (docs/calendar/*, sync-safety.test.js) | Refresh-token death is silent; false daily expiry warnings train users to ignore alerts | Fix expiry check to refresh-token; surface sync-dead state | P1 |
| 8. Calendar views | MOSTLY READY | Day/Week/Month/Master real (mockup 15788-16388, 18190) | Month lazy-load quirks minor; travel overlays Mon–Fri only | None blocking | P2 |
| 9. Calendar polish/usability | BUILT BUT NEEDS POLISH | Real data, colours, badges | **No live refresh at all** (CSP-blocked socket + zero polling); fake "Synced · 14s ago" pill; stale April-2026 labels in detail/move dialogs | Self-host socket.io or add polling; kill fake pill; fix date labels | **P0** |
| 10. Splose read-only integration | MOSTLY READY (transport) | Throttle/pagination/poller fail-closed (splose-api.js:38-157) | 10-min cache staleness invisible on booking screen | Staleness indicator | P1 |
| 11. Splose client/appointment visibility | RISKY / NEEDS FIX | All routes requireAuth-only (routes.js:1563-2101); whole-practice PII to any account; therapists see invoice amounts via Activity tab | Privacy Act/NDIS need-to-know indefensible; reportable-breach-shaped if an account is compromised | Backend role-gating on Splose routes (minimum: financials owner/admin-only; decide caseload model) | **P0** |
| 12. Scheduling workflow | PROTOTYPE ONLY | Books under practitioners[0] = Ann for everyone (mockup 7794, 8363); fake success toast on incomplete state (9633-9640); writes flag-disabled in cloud | Second therapist's bookings would be attributed to Ann; fake success = trust destroyed | Hide/repair booking for therapist role at launch; land therapists on Calendar | **P0** |
| 13. Leave / availability | PARTIALLY READY | Submit/approve/reject wired (profile-routes.js:78-172) | Approved leave blocks nothing (UI claims it does); no balances; no notifications; flows never exercised | Fix false copy; add notification on decision; exercise once end-to-end; write policy note | P1 |
| 14. PD / CPD allowance | PARTIALLY READY | Hours tracking + approvals work (profile-routes.js:197-305) | Dollar allowance absent; 30h hardcoded; draft/approved counts disagree | Acceptable for pilot; document | P2 |
| 15. Employee documents | PARTIALLY READY | Hardened upload; 3 backends; authenticated download route (profile-routes.js:335-477) | **No download UI**; owner can't view staff docs; 5MB cap; blob no soft-delete | Add download button; owner visibility; enable blob soft-delete | P1 |
| 16. Resource Hub | PARTIALLY READY | Governed backend + tests (resources-routes.js); read UI | **No authoring UI**; upload API 413s >~75KB (server.js:140-142); zero content; XSS in cards | Fix body limit; minimal authoring path (UI or tested seed script); seed 12 folders; escape rendering | **P0** (content) / P1 (code) |
| 17. Notifications/reminders | PARTIALLY READY | Centre + badge + dedupe exist (app-routes.js:70-102) | Fetched once per session (no polling); false expiry warnings; no leave/CPD notifications; no email channel | Add polling; fix false warnings; wire approval notifications | P1 |
| 18. Admin/owner controls | MOSTLY READY | Team mgmt, approve/suspend/role, invites, org settings (mockup 21740-22160) | Role labels show raw `read_only`; no therapist-profile UI; no admin password-reset fallback | Add profile-creation control (even minimal) | P1 |
| 19. Therapist permissions | RISKY / NEEDS FIX | permissions.js map is good; routes.js bypasses it (own requireAuth, zero role checks) | read_only can POST events; therapist can write Splose whenever flags on; model ≠ enforcement | Route routes.js through permissions.requireAuth; role-gate Splose | **P0** |
| 20. Audit logs | READY | Broad coverage w/ IP, no clinical content (auth.js, profile-routes.js, accounting) | Unbounded retention (policy gap only) | None | P3 |
| 21. Security/privacy | PARTIALLY READY | Strong core (sessions, crypto, redaction, fail-closed env) | See SECURITY_PRIVACY_READINESS_AUDIT.md — 2 Critical, 6 High | Fix Criticals + top Highs | **P0** |
| 22. Backups/restore | PARTIALLY READY | PG PITR 14d confirmed live (az query 2026-07-31); procedure documented | **Never restore-tested**; blob docs unrecoverable (no soft-delete); stale handover claims no backups exist | Run one timed restore drill; enable blob soft-delete | P1 |
| 23. Error handling | BUILT BUT NEEDS POLISH | Retry states on data tabs; graceful shutdown; poller resilience | Raw flag-error toasts; blank-screen dead ends (reschedule, mockup 12688); fake successes | Fix the specific dead ends + false toasts | P1 |
| 24. Mobile/tablet usability | NOT BUILT | 1 @media query in 24,460 lines; 13-tab nav no wrap (mockup 846-854) | Desktop-only; unusable on phone | Accept for launch (laptop-only pilot); state it explicitly | P2 |
| 25. Deployment/hosting | PARTIALLY READY | Staging solid, scripted, health-gated | No production; staging=CI target=user env; NODE_ENV=staging weakens cookies/CSRF; azurewebsites.net URL | Environment decision + execute (see HOSTING doc) | **P0** |
| 26. Monitoring/support | PARTIALLY READY | App Insights + 3 alerts + redaction | No safety-block/login alerts; one email; no on-call/support doc; no user-facing help | Add 2 alerts; write 1-page support/escalation doc | P1 |
| 27. Accounting/Xero module | PARKED (in this app) | READY FOR STAGING REVIEW @8c893bf; owner-only; writes triple-gated; never connected | None to therapist (hidden + backend-enforced) | Nothing — keep owner-only; do not build further here | — |
| 28. Opal Finance extraction | READY (plan) | Transfer pack: 7 docs on branch `opal-finance-transfer` (d80238e) + verified zip at repo root | Coupling risks documented (Splose access, auth, shared CSS) | Nothing before therapist; extraction proceeds in the new repo | — |

---

### Bottom line

The **engine room is genuinely good** (sync engine, safety flags, migrations,
CI, crypto, audit) and the **cockpit is not ready for a second pilot**: the
identity lifecycle depends on email that doesn't exist, the privacy boundary
inside the practice is absent, the booking surface books as Ann, the
calendar never refreshes, and several features report success for actions
that never happened. All of it is fixable in the available month — see
ROADMAP_TO_POLISHED_LAUNCH.md.
