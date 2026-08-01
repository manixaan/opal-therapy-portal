# Browser QA Results — Opal Therapy Portal

**Date:** 2026-08-01 · **Target:** `https://opal-portal-staging.azurewebsites.net`
(staging only) · **Browser:** Playwright MCP (Chromium) ·
**Build at start:** `188334d` · **Build after fixes:** `b7e3308`
**Production:** NOT tested. Deploy run 30696346861 remains `waiting` at the
owner approval gate; `opal-portal-prod` served 503 throughout (undeployed).

## Accounts used (no passwords recorded)

| Role | Account | Notes |
|---|---|---|
| Owner | `synthetic.owner@example.test` | Synthetic |
| Therapist (established) | `synthetic.therapist@example.test` | Unmapped |
| Read-only | `synthetic.readonly@example.test` | Synthetic |
| Scratch therapist | `qa.ui.therapist@example.test` | **Created during QA via the real invite→copy-link→register UI; suspended at the end** |

## Flow-by-flow results

| Flow | Checks | Result |
|---|---|---|
| A — Login/logout/invalid | Base URL redirects to /login; title `Opal Therapy Portal`; standards mode (`CSS1Compat`); invalid login → "Invalid email or password"; owner login → real identity ("Antony", not Ann); logout ends session (401 after) | ✅ 7/7 |
| B — Invite/copy-link/registration | Modal copy is honest ("emailed automatically when configured, otherwise shown here to copy"); treating-therapist toggle present + pre-checked; submit → **"Invite created — email NOT sent"** + copyable staging link (no localhost); registration in a new tab pre-filled + role-confirmed; account created; owner approved from Team list → active with therapist profile auto-created | ✅ 9/9 |
| C — Onboarding/profile chain | Login routes new therapist to `/onboarding`; review step 200; setup card renders truthfully: ✅ onboarding, ✅ profile, ⚠ Splose link "Pending — set up by the practice owner", ⚠ Outlook "Not connected", ⚠ travel base, with ordered next steps; state persists after reload | ✅ 7/7 |
| D — Outlook state | Therapist sees `outlookConnected:false`, `connectedAs:null`, `status:not_connected` — **never another user's mailbox**; connect path is understandable (Settings → Integrations); no mailbox connected (per instruction) | ✅ 4/4 |
| E — Calendar/shell | Title professional; no hardcoded Ann anywhere in rendered text; Travel & Flights tab disabled ("Coming soon"); Outlook-only toggle hidden for therapist, present for owner in the toolbar; freshness pill shows real state ("Outlook: not connected · Splose: checked recently") and updates on click | ✅ 6/6 |
| F — Splose boundaries | Therapist: patients/invoices/payments 403; appointments 403 `practitioner_mapping_required` (fail-closed); write `POST /api/splose/patients` 403 | ✅ 4/4 |
| G — Resource Hub | Therapist sees 16 approved starter resources across 14 folders; no non-official external URLs; folder-create 403 | ✅ 4/4 |
| H — Accounting extraction status | Therapist: tab hidden, section hidden, `/api/accounting/*` 403 (exceptions, xero/status, candidates). Read-only: hidden + 403. Owner: tab visible and gated by `data-owner-only="1"`; Xero `connected:false`, `xeroWrite:false`, `draftInvoiceCreate:false`; **no Xero connection attempted, no write action exercised** | ✅ 9/9 |
| I — Leave/CPD/documents | Setup card + profile sections render; no fake-success strings in the served build; disabled features read "Coming soon"/"Preview only — not saved" | ✅ 3/3 |
| J — Direct URL/permission | Unauthenticated: `/api/auth/me`, accounting, splose, events, invites → **all 401**. Read-only: accounting 403, splose services 403, splose patients 403, event write 403, resources 200 (correct). Therapist: admin team-setup 403 | ✅ 11/11 |

**Totals: 64 checks · 62 passed on first run · 2 failed → both fixed and re-verified · 0 open failures.**

## Defects found (both FIXED and re-verified during this QA)

### QA-1 · CRITICAL launch blocker — cross-role practice-data cache leak *(fixed)*

Signing in as a therapist on a machine where the **owner** had previously
been signed in rendered the owner's cached practice financials in the
Billing tab: total billed **$594,725.45**, collected, outstanding, and an
invoice table with a CLIENT column. Every live API correctly returned 403 —
the data came from `sessionStorage` `splose_swr_billing` (2.4 MB),
`splose_swr_activity` (858 KB) and `splose_swr_dormant`, which survived
logout. This is exactly the owner-sets-up-then-hands-over-the-laptop flow
in the onboarding runbook.

*Fix (`b7e3308`)*: `signOut()` now clears all `splose_swr_*` entries, and
`initAuth` records the signed-in user id and drops those caches whenever a
**different** user resolves in the same browser session (covers session
switches that bypass the sign-out button).
*Re-verified live*: owner populated the cache → sign out → caches `[]` →
therapist signed in → caches `[]`, Billing view renders no money, tab
hidden.

### QA-2 · HIGH — role-based nav gating silently no-oped *(fixed)*

Therapists saw **Billing, NDIS Cases and Dormant Cases** tabs. Cause:
`initAuth`'s single-shot `typeof initMasterCalendarAccess === 'function'`
check can run before the later script block defining it has parsed, so
gating never applied (the function worked when called manually).

*Fix (`b7e3308`)*: gating applied via a short retry that falls back to
`applyNavRoleVisibility` directly.
*Re-verified live*: therapist now sees none of the three; owner still sees
all three plus Accounting.

## Console errors observed

| Error | Assessment |
|---|---|
| `GET /api/auth/me 401` on the login page | Expected — the page probes for an existing session. **Low** (cosmetic noise) |
| `GET /favicon.ico 404` | **Low** — no favicon shipped |
| `GET /api/outlook/categories 500` (×3, owner session) | **Medium** — owner has no Outlook connection on staging; the endpoint 500s instead of returning an empty/"not connected" result. Cosmetic today (categories are decoration) but should return 409/empty |
| Google Maps `InvalidKey` warning | **Medium** — the Maps key is a placeholder in staging KV (pre-existing, documented); travel-time features degraded |
| Deliberate 401/403s from permission probes | Expected — these are the tests passing |

## Network errors

None unexpected. All non-2xx responses were the intended permission
boundaries (401 unauthenticated, 403 role-denied, 403 `feature_disabled`
for the Splose write) plus the two console items above.

## Broken buttons

None found. Travel & Flights is correctly disabled; the previously dead
flight/manual-travel buttons no longer reference missing functions.

## Permission issues

QA-1 and QA-2 above — both closed. Backend RBAC was correct throughout
(it is what limited QA-1 to a client-side exposure).

## UX issues

| Issue | Severity |
|---|---|
| `/api/outlook/categories` 500 for users without Outlook | Medium |
| Google Maps placeholder key → console warnings, degraded travel features | Medium |
| No favicon (404 on every page load) | Low |
| Approve action uses a native `confirm()` dialog | Low |

## Security concerns

QA-1 was the only material one and is fixed. Positively confirmed: every
unauthenticated route 401s; read-only cannot write or read practice data;
therapists are practitioner-scoped and fail closed; no tokens appear in any
payload; Resource Hub exposes no public file URLs; all write flags remain
false (`outlookWrite`, `sploseWrite`, `automaticRemoteDelete`, `xeroWrite`,
`contactCreate`, `draftInvoiceCreate`).

Environment note: the Playwright browser shared a profile with live
personal browsing (unrelated Gmail tabs appeared mid-session). Those tabs
were never touched. For future runs, prefer an isolated browser profile.

## Accounting/Xero extraction status

Not part of the therapist experience: hidden and 403 for therapist and
read-only, at both the nav and API layers. Owner retains a read-only,
owner-gated view with Xero unconnected and every write flag false. Nothing
Xero-related was connected, created or written. See §Recommendation in the
final report for the pre-pilot option.

## Screenshots

None retained — findings were captured as structured DOM/API state to
avoid storing practice financial data in the repo.

## Verdict

**READY FOR LIMITED THERAPIST PILOT — maintained**, and materially
strengthened: the QA found and closed a real data-exposure path that
existed in every prior stage (backend tests could not see it, because the
leak was in the browser). Remaining items are Medium/Low polish.
