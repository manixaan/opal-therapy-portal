# Opal Therapy Portal — Product Readiness & Launch Audit

Audit date: 2026-07-31 · Code at `main` = `8c893bf` (= deployed staging) ·
Method: 10 parallel evidence readers over the full repo + a completeness
critic + live read-only Azure config checks. Every claim in this audit set
is backed by file:line evidence. No code was changed; staging untouched.

**Companion documents (this folder):**
[FEATURE_INVENTORY_AND_GAP_MATRIX](FEATURE_INVENTORY_AND_GAP_MATRIX.md) ·
[NEW_THERAPIST_DAY_ONE_WORKFLOW](NEW_THERAPIST_DAY_ONE_WORKFLOW.md) ·
[HOSTING_AND_APP_DELIVERY_RECOMMENDATION](HOSTING_AND_APP_DELIVERY_RECOMMENDATION.md) ·
[SECURITY_PRIVACY_READINESS_AUDIT](SECURITY_PRIVACY_READINESS_AUDIT.md) ·
[UX_POLISH_AND_LAUNCH_BLOCKERS](UX_POLISH_AND_LAUNCH_BLOCKERS.md) ·
[ROADMAP_TO_POLISHED_LAUNCH](ROADMAP_TO_POLISHED_LAUNCH.md) ·
[THERAPIST_LAUNCH_CHECKLIST](THERAPIST_LAUNCH_CHECKLIST.md)

---

# Decision dashboard

**1. Overall readiness score: 5 / 10.**
The infrastructure, sync engine, safety flags, CI and audit trail are 8/10;
the therapist-facing product surface, identity lifecycle, privacy boundary
and documentation are 3/10. The average understates how fixable it is: the
gap list is long but shallow — mostly small, known, evidenced defects.

**2. Ready for the therapist today? NO.**

**3. Why not (the five structural reasons):**
1. **The identity lifecycle can't run**: the app cannot send email in any
   environment, so invite/verify/reset all dead-end into server logs while
   the UI claims success — and an invited therapist gets no
   therapist_profile, hence a permanently empty calendar with no UI fix.
2. **No internal privacy boundary**: any authenticated account can pull
   every client's name, address, NDIS number and all practice financials
   (Splose proxy has no RBAC), plus one Splose WRITE route bypasses the
   read-only flag entirely.
3. **The product lies in places**: fake booking success, fake case-noting
   and gap-block persistence, fake "Synced · 14s ago", false "leave blocks
   Splose" and "staff will be notified" copy, false token-expiry warnings —
   with no live data refresh at all after page load (CSP-blocked socket,
   zero polling).
4. **Single-pilot assumptions**: bookings hardcode Ann's practitioner ID;
   the connect-state API masks a second user's not-connected Outlook; the
   header identity is hardcoded Ann.
5. **No launch environment or user documentation**: production doesn't
   exist, real users ride the CI deploy target with staging-weakened
   cookies/CSRF, synthetic accounts share the DB with real mailbox data,
   and there is zero end-user/onboarding/support documentation.

**4. Top 10 blockers** (fix order; details in matrix/security docs):
1. Email dead everywhere + APP_BASE_URL localhost links + invite UI hiding
   the failure (P0, small)
2. Splose proxy RBAC absent — whole-practice PII + financials to any
   account (Security C1)
3. Ungated `POST /api/splose/patients` write bypassing the read-only flag
   (Security C2)
4. Invited therapist gets no therapist_profile → empty calendar, no UI
   fix; invite/approval flow contradictions
5. Bookings attributed to `practitioners[0]` (Ann) for every user + fake
   booking-success toast
6. Outlook connect-state masked by org-wide sync-status + broken re-auth
   (raw JSON page) + no disconnect anywhere
7. No data refresh post-load (CSP-blocked socket.io, zero polling) + fake
   sync pill — frozen-snapshot calendar presented as live
8. routes.js bypasses the permissions choke point (read_only can write;
   role model unenforced on its 25+ routes)
9. No launch environment (production absent; staging weakened + CI-target
   + synthetic accounts + azurewebsites URL)
10. Stored-XSS surfaces (leave/CPD/credentials/resources/Splose names)
    under an unsafe-inline CSP — one crafted string = owner session

**5. Top 10 polish items** (after blockers; full list in UX doc):
1. Corrupted DOCTYPE/quirks mode + stray button (XS fix)
2. "v2 Mockup" browser title + mockup_v3.html served name
3. Dead Travel & Flights tab (undefined functions)
4. Frozen April-2026 dates in booking header, block dialogs, move-confirm,
   plan-expiry logic
5. Hardcoded "Ann Mary Mathew" identity badge + Today-view headings
6. Cancelled-session "reschedule" blank-screen dead end
7. Duplicate showToast breaking 34 call sites' styling
8. Therapist lands on the broken booking wizard; no home/dashboard
9. Notification badge fetched once per session; approval events invisible
10. localStorage clinical notes shown as "Saved" (honesty label short-term,
    server persistence proper)

**6. Top 10 things already working well:**
1. Outlook delta sync engine: 90s cadence, seriesMaster guard, fail-closed
   deletion safety, periodic reconciliation — validated 65=65 against a
   real clinician mailbox
2. Fail-closed flag architecture (sync flags + finance double-gate, proven
   at unit/route/deployed levels)
3. Auth core: bcrypt(12), session regeneration, enumeration-safe, PG
   sessions with correct flags in production mode
4. Token crypto (AES-256-GCM at rest) + log/telemetry redaction discipline
5. CI/CD: real-PG integration tests, migration validation, zero-vuln gate,
   OIDC, health-gated deploys — 151u + 104i green
6. Checksummed, advisory-locked, fail-closed migration system (000–006)
7. Audit logging breadth (auth, lifecycle, documents, approvals, sync
   safety, finance) with no clinical content
8. The accounting module's engineering quality + its full extraction plan
   (Opal Finance transfer pack, verified zip)
9. Leave/CPD/documents/credentials backend flows with hardened uploads and
   3 storage backends
10. Health/ready split, graceful shutdown, poller resilience, structured
    ops scripts — the platform layer is honest engineering

**7. This week:** Stage 1 items 1.1–1.3 (email + environment decision +
Splose RBAC with tests-first) and the XS frontend integrity fixes (DOCTYPE,
dead tab, title, landing tab). These unblock everything else.

**8. Next week:** Stage 1 items 1.4–1.12 (identity chain, Outlook state,
refresh channel, fake-success removal, XSS pass, offboarding, Resource Hub
unblock + cleanup), then Stage 2 runbook + dry-run.

**9. Defer:** mobile/responsive; MFA (decide, don't build); frontend
decomposition; PWA; write-back flags; Resource Hub R2; all AI features;
Opal Finance build (separate repo); leave balances; dashboards.

**10. Recommended final target before therapist starts:**
**READY FOR LIMITED THERAPIST PILOT** on a production environment
(portal.opaltherapy.com.au), all ⛔ boxes in THERAPIST_LAUNCH_CHECKLIST
checked, dry-run passed with a scratch account, write flags off, weekly
reconcile + pilot log running.

---

# Part 8 — Remove, park or separate

| Item | Category | Rationale / action |
|---|---|---|
| Accounting/Xero module | **Extract to Opal Finance** (decided) | Transfer pack complete: 7 docs on branch `opal-finance-transfer` (d80238e) + verified `opal-finance-transfer-pack.zip`. Until cutover: **keep active, owner-only** — it is backend-enforced (403 for therapist proven on staging), hidden from non-owners in nav, write-gated at three levels, and Xero has never been connected, so it adds no therapist risk. Do NOT build Phase 2B here. Remove from this repo only after Opal Finance is live (handover §13 checklist; note the shared `.acct-*` CSS used by Resource Hub) |
| Travel & Flights tab | **Keep hidden** (now) → remove later | 100% dead stub; both buttons call nonexistent functions. Hide pre-launch (one line); delete with the cleanup PR |
| Smart Booking for therapist role | **Park (hide) for launch** — needs owner decision on timing | Books as Ann (practitioners[0]); fake success path; writes flag-disabled anyway. Land therapists on Calendar; re-enable per-role after practitioner resolution is built and write policy decided |
| Case-noting scheduler + idle-gap "Add block" | **Park/disable** | DOM-only fake persistence with success toasts. Disable or make explicit "coming soon" until they write somewhere real |
| Billing / NDIS / Dormant tabs | **Keep hidden for therapists + backend-gate** | Currently frontend-hidden only; the Splose endpoints behind them are open (Security C1). Keep for owner/admin after gating |
| Activity tab financial amounts | **Needs owner decision** | Either backend-strip amounts for therapist role or move tab admin-only |
| Legacy Today view, MOCK_CLIENTS, renderPatientsTable, hidden auto-fit view | **Remove later** (cleanup PR) | Dead frontend code confusing every future edit |
| routes-backup-original.js, routes-outlook-integration.js, check-*/discover-*/inspect-* scripts (~1,140 lines) | **Remove later** (cleanup PR) | Dead; two probe scripts hit live APIs with real keys if ever run — a footgun |
| May-2026 aspirational docs (ARCHITECTURE_SUMMARY, PRODUCTION_ARCHITECTURE, both roadmaps, README front door) | **Archive + rewrite README** | They describe a React/JWT/SendGrid product that never existed and mark unbuilt features "COMPLETE"; actively mislead |
| handover/ folder | **Keep with stale banner** | Honest but frozen at 2026-07-12; contradicts current state on backups/migrations/vulns |
| frontend/archive (mockup v1/v2), snapshot zip + manifest | **Remove/archive later** | 512K+ of dead weight |
| opal-finance-transfer-pack.zip at repo root | **Move out of repo** when the new project starts | Deliberate, untracked; belongs to the Opal Finance project |
| Xero write flags / webhooks / Phase 2B+ | **Park permanently in this repo** | All future Xero work happens in Opal Finance |
| ENABLE_RESOURCE_* R2 flags, AI/client-sharing concepts | **Park** | Documented only; keep fail-closed; post-pilot at earliest |

**Could the accounting module confuse therapists?** No — they cannot see
the tab (role-gated in nav) and every API returns 403 (verified on staging
2026-07-27). The confusion risk sits with the *visible* broken surfaces
(Travel & Flights, fake successes), which is why those are P0.

---

# Final classification

## NOT READY FOR THERAPIST (today) — credibly READY FOR LIMITED THERAPIST PILOT within the month

The distance is ~2 weeks of focused, well-defined fixes (Stage 1) plus one
week of onboarding polish and a dry-run (Stage 2). Nothing on the blocker
list is architecturally hard; most items are small and precisely located.
The single biggest risk to the timeline is attempting new features instead
of executing this list.
