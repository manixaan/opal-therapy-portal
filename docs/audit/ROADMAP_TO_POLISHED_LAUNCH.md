# Roadmap to a Polished Launch

Staged plan to take the portal from today's state (engine strong, cockpit
not therapist-ready) to a controlled pilot within the month, and beyond.
Effort: XS <½day · S ½–1day · M 2–4days · L 1–2wks. Owner = who must act
(Owner = Antony; Dev = Claude-driven build sessions; Both = decision+build).

## Stage 0 — Freeze risky scope (now)

Do NOT before the therapist starts: enable any external write flag
(Outlook/Splose/Xero); build Phase 2B accounting here (moved to Opal
Finance); add AI/client-sharing/suggestion features; start the mobile
responsive rewrite; refactor the frontend into a framework; connect Xero.
Also freeze: no more feature tabs. Everything below is fixing, gating,
seeding, documenting.

## Stage 1 — Launch-critical fixes (weeks 1–2)

| # | Item | Priority | Owner | Depends on | Effort | Risk | Prompt/action |
|---|---|---|---|---|---|---|---|
| 1.1 | Email: configure SMTP (M365 recommended) + APP_BASE_URL in cloud env; invite UI handles emailSkipped + shows copyable link; test invite→verify→approve chain | P0 | Both (owner: mailbox/app-password; dev: config+UI) | — | S | Low | "Configure portal email via M365 SMTP + surface invite links in UI; prove the full invite chain on staging" |
| 1.2 | Environment decision + execution (recommended: provision production, custom domain, managed cert; else harden staging incl. NODE_ENV strictness fix) | P0 | Both | DNS access | M | Med | "Provision opal-portal-prod per HOSTING doc; bind portal.opaltherapy.com.au; keep flags off" |
| 1.3 | Splose privacy boundary: role-gate financial routes (invoices/payments/cases/contacts → owner/admin); route routes.js through permissions.requireAuth (read_only choke point); gate/delete POST /api/splose/patients (C2); decide caseload posture for patient/appointment reads (gate or written owner acceptance) | P0 | Dev (+Owner decision on caseload) | — | M | Med (regression) — mitigated by adding the missing 403 tests first | "Enforce backend RBAC on the Splose proxy per SECURITY audit C1/C2/H3, tests first" |
| 1.4 | Therapist identity chain: invite modal isTreatingTherapist toggle → therapist_profile creation (or minimal owner UI calling POST /api/therapists with splosePractitionerId); fix invited-user approval flow to match intent | P0 | Dev | — | M | Low | "Make a UI-invited therapist get a working profile + calendar end-to-end" |
| 1.5 | Outlook connect truth: per-user sync-status (kill org-wide fallback); fix re-auth JSON redirect; add disconnect endpoint + Settings button; fix token-expiry check to refresh-token age | P0 | Dev | — | M | Low | "Fix the four Outlook connect-state defects from the audit (masked state, re-auth, disconnect, false expiry)" |
| 1.6 | Live refresh: self-host socket.io (CSP-compliant) or 60s calendar+notifications poll; remove/realise the 'Synced · 14s ago' pill; self-host or drop Chart.js | P0 | Dev | — | S | Low | "Give the deployed app a real data-refresh channel and honest sync indicators" |
| 1.7 | Kill fake successes: booking incomplete-state toast, case-noting scheduler, idle-gap Add block, leave 'blocks Splose'/'will be notified' copy → real or explicit not-available | P0 | Dev | — | S | Low | "Remove every success message for actions that do nothing (audit list)" |
| 1.8 | Frontend integrity pass: repair DOCTYPE; hide Travel & Flights tab; retitle from 'v2 Mockup'; land therapist on Calendar; block booking for unmapped practitioners (or hide Smart Booking for therapist role at launch) | P0 | Dev | — | S | Low | "Apply the P0 items from UX_POLISH_AND_LAUNCH_BLOCKERS" |
| 1.9 | XSS hardening: apply existing escapeHtml to leave/CPD/credentials/resources/Splose-name renderers; allowlist http(s) external_url | P0/P1 | Dev | — | S | Low | "Escape all user-authored innerHTML sinks listed in SECURITY H4" |
| 1.10 | Offboarding + poller: clear tokens on deactivate/suspend; poller skips inactive users; write offboarding checklist | P1 | Dev | — | S | Low | "Implement SECURITY H1/H2 + a one-page offboarding checklist" |
| 1.11 | Resource Hub unblock: body-limit carve-out for resources upload + 5MB cap; minimal authoring path (thin admin UI preferred, else a tested seed-script runbook) | P0(content) | Dev | — | M | Low | "Make Resource Hub seedable end-to-end, then seed the 12-folder pack" |
| 1.12 | Synthetic cleanup on the user-facing env: remove @example.test accounts, stale ALLOWED_EMAILS, tombstone remnants noted; document what was removed | P1 | Dev (owner approval — destructive) | 1.2 | S | Med | "Owner-approved cleanup of synthetic accounts per report-first rule" |

## Stage 2 — Therapist onboarding polish (weeks 2–3, before login details go out)

| # | Item | Priority | Owner | Depends | Effort | Risk | Prompt/action |
|---|---|---|---|---|---|---|---|
| 2.1 | Owner onboarding runbook (the 8-step sequence incl. M365 + Splose pre-work) — one page | P0 | Dev writes, Owner rehearses | 1.1–1.4 | S | Low | "Write ONBOARDING_RUNBOOK.md and dry-run it with a scratch account end-to-end" |
| 2.2 | Therapist quick-start guide (2–4 pages: login, wizard, connect Outlook, calendar toggles, leave/CPD, Resources, who to call) + support/escalation one-pager | P0 | Dev | Stage 1 | S | Low | "Write the therapist user guide + support one-pager from the audit's day-one doc" |
| 2.3 | Full dry-run: scratch therapist account through the entire day-one workflow on the launch environment; fix what snags | P0 | Both | all Stage 1 | S | — | "Execute NEW_THERAPIST_DAY_ONE_WORKFLOW as a test script; log results" |
| 2.4 | Seed Resource Hub content (12 folders, 2–3 items each incl. policies/induction docs the owner supplies); leave policy note (types, expectations) | P1 | Owner (content) + Dev (loading) | 1.11 | M | Low | Use RESOURCE_HUB_CONTENT_SEEDING_PLAN |
| 2.5 | Notifications that matter: leave/CPD submit+decision notifications (in-app + email now that SMTP exists); remove false expiry warnings | P1 | Dev | 1.1 | S | Low | "Wire approval-flow notifications; fix expiry-warning logic" |
| 2.6 | P1 UX list from UX_POLISH doc (dates, identity, toasts, reschedule dead-end, notification polling, PD download button, raw role labels) | P1 | Dev | — | M | Low | "Apply the P1 UX list" |
| 2.7 | Ops guardrails: one PG restore drill (timed, documented); blob soft-delete on; 2 extra alerts (safety-block fired, 5+ failed logins); fix runbook rotation instructions | P1 | Dev | 1.2 | S–M | Low | "Execute the ops hardening items from the deploy audit" |
| 2.8 | Docs truth pass: rewrite README as accurate front door; stale-banner handover/ + May-2026 aspirational docs → archive; fill or formally restart READ_ONLY_LIVE_TEST_RESULTS; update SECURITY_CHECKLIST to reality | P2 | Dev | — | S | Low | "Doc hygiene pass per docs-state audit" |

## Stage 3 — Controlled therapist pilot (week 4 + first weeks of employment)

What the first therapist tests, in order: login+onboarding wizard; Outlook
connect + 1 week of calendar accuracy vs their real Outlook (repeat the
65=65 reconcile for THEIR mailbox); weekend/day/month views; leave request
→ owner approval round-trip; CPD entry; credential upload incl. download-back;
Resource Hub browse/download + one draft submission via whatever authoring
path shipped; travel-base + travel overlay sanity; notifications arriving.
Rules: write flags stay OFF; weekly check-in; issues logged to a running
PILOT_LOG.md; owner monitors audit log + alerts; explicit rollback = suspend
account, nothing else changes. Exit criteria: 2 clean weeks, therapist
sign-off on calendar accuracy, no Critical/High security items open.

## Stage 4 — Wider staff rollout (post-pilot)

Second wave needs: per-account lockout + MFA decision; caseload-scoping
implemented (not just accepted); responsive/tablet pass; leave balances +
notification emails; PD document owner-visibility; Resource Hub authoring
UI proper; monitoring on-call notes; production deploy cadence agreed;
frontend decomposition plan (the 24k-line file is the biggest long-term
tax on every change above).

## Stage 5 — Future modules (sequenced, not scheduled)

- **Opal Finance**: proceeds in its own repo from the transfer pack
  (branch `opal-finance-transfer`); portal keeps owner-only read-only
  accounting until cutover, then removal per handover §13.
- **Write-back** (Outlook/Splose): only after pilot exit criteria + the
  documented go/no-go gate with evidence log; start with Outlook
  travel-blocks (already built behind flag).
- **Resource Hub R2**: client-facing suggestions/AI/external sharing —
  after therapist feedback session (session pack exists) and only behind
  their exclusion rules.
- **Mobile/PWA**: after responsive pass + refresh mechanism proven.
- **AI features**: last; nothing before privacy boundary + data-retention
  policy exist.
