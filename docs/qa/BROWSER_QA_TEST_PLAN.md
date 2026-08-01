# Browser QA Test Plan — Opal Therapy Portal (staging)

Written 2026-08-01 for the pre-pilot Playwright MCP click-through audit.
Target: `https://opal-portal-staging.azurewebsites.net` (build `8b92979`,
head `188334d`). Production exists but is undeployed and awaiting the
owner's approval gate — it is explicitly OUT of scope.

## 1. Roles under test

| Role | Account | Notes |
|---|---|---|
| Owner | `synthetic.owner@example.test` | Synthetic staging account |
| Therapist (established) | `synthetic.therapist@example.test` | Unmapped — exercises fail-closed states |
| Read-only | `synthetic.readonly@example.test` | Deny-everything checks |
| Scratch/new therapist | `qa.ui.therapist@example.test` | Created DURING this QA via the real invite→register UI flow; suspended afterwards |
| Admin | `synthetic.admin@example.test` | Spot-checks only (shares most owner surfaces) |

Passwords come from the gitignored `deploy/staging-synthetic.local.txt`
(synthetic) and a QA-session-generated value for the scratch account —
never written into docs or committed files.

## 2. Pages/features in scope

Login · logout · invalid login · invite modal (truthful email states +
copy-link) · registration via invite link · onboarding wizard · My Profile
(setup-status card, leave, CPD, PD documents, credentials) · therapist
profile status · home/travel base status · Calendar (week view, empty
states, freshness pill, weekends setting) · Settings (integrations,
users & roles, team setup panel) · Outlook connect-state (per-user, no
wrong mailbox) · Splose access boundaries · Resource Hub (folders, starter
content, role limits) · owner/admin controls · **Accounting: visibility
and extraction status ONLY** (see §3).

## 3. Accounting/Xero handling (module is being extracted to Opal Finance)

Accounting is NOT tested as a feature. The only assertions:
- Therapist sees no Accounting navigation; direct URL/API access fails.
- Read-only sees no Accounting navigation; direct access fails.
- Owner access (if visible) is owner-only, read-only toward Xero, with no
  active write action (draft/contact-create buttons locked, flags off).
- No Xero connection is attempted at any point; no invoice/contact/
  payment/expense/timesheet/leave-export/pay-run action exists or is
  clicked.
- Output includes a recommendation on hiding the tab entirely pre-pilot.

## 4. Safety rules

Staging only (prod URL is 503 and out of scope) · scratch/synthetic
accounts only · no external writes (all write flags verified false before
and during) · no Outlook mailbox connection · no Splose/Xero mutation ·
no secrets or passwords in docs/commits · screenshots only where useful
and never of unnecessary sensitive data (staging Splose panels are
owner-only and not screenshotted).

## 5. Expected behaviours (the pass bar)

1. Therapist cannot reach owner-only routes (Accounting, admin, team-setup API).
2. Read-only cannot write anything.
3. Unmapped therapist fails closed on Splose appointments
   (`practitioner_mapping_required` — not an error page, not data).
4. Broad Splose data (patients directory, invoices, payments) denied to
   therapist role.
5. Resource Hub shows the 14 starter folders / 16 approved items to
   therapists, with no authoring or public URLs.
6. Outlook status is strictly per-user; a never-connected account shows
   "not connected" and never another user's mailbox.
7. No hardcoded "Ann" identity anywhere; header shows the signed-in user.
8. No fake freshness ("Synced · 14s ago") — the pill shows real state.
9. Travel & Flights tab is disabled ("Coming soon"), not broken.
10. Title is **Opal Therapy Portal**; page loads in standards mode.
11. Accounting is not part of the therapist experience in any way.
12. No unexplained console errors on core pages; no failing network calls
    outside deliberate 401/403 permission checks.

## 6. Flows (A–J)

A login/logout+invalid · B invite→copy-link→register→approve ·
C therapist onboarding/profile chain · D Outlook state ·
E calendar · F Splose boundaries · G Resource Hub ·
H Accounting extraction status · I leave/CPD/documents honesty ·
J direct-URL permission checks (in-page fetch, same session cookies).

Every check records: role, page, action, expected, actual, pass/fail,
severity (Critical/High/Medium/Low) on failure, console/network errors,
and a recommended fix. Results land in `docs/qa/BROWSER_QA_RESULTS.md`.
