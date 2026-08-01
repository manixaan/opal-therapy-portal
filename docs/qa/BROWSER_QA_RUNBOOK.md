# Browser QA Runbook

How to (re)run the browser QA against staging. Companion to
`BROWSER_QA_TEST_PLAN.md`; results go to `BROWSER_QA_RESULTS.md`.

## Prerequisites

- Playwright MCP registered for the session:
  `claude mcp add --scope user playwright -- npx @playwright/mcp@latest`
  then **restart the session** (servers connect at session start), and
  `npx playwright install chromium` once.
- Synthetic credentials available locally in the gitignored
  `deploy/staging-synthetic.local.txt` (never pasted into docs).
- Verify before starting: staging `/health` ok; production deploy gate
  untouched (`gh run view <run> --json status` = waiting) if one is
  pending; all write flags false
  (`/api/sync/diagnostics` + `/api/accounting/xero/status` as owner).

## Session hygiene

- One browser session per role; log out (or close the tab) before
  switching roles. The scratch account is created through the REAL
  invite→copy-link→register UI each time and **suspended afterwards**
  from Settings → Users & Roles.
- Direct-URL permission checks run as in-page `fetch()` with session
  cookies (browser_evaluate) so they exercise the same auth path as the
  UI without downloading data.
- Read console messages (`level: error`) after each major page, and the
  network log at the end of each role session; deliberate 401/403s from
  permission checks are expected entries, anything else is a finding.

## Order of execution

1. Unauthenticated: base URL redirect, title, invalid login.
2. Owner: identity, invite modal (truthful email state + copy link),
   team setup, Accounting parked-check (visibility only), logout.
3. Scratch registration in a fresh tab via the copied link; owner
   approves from Team list.
4. Scratch therapist: onboarding → setup card → calendar empty states →
   Outlook not-connected → Resource Hub → leave draft (create+delete) →
   nav/tab assertions → direct-URL checks.
5. Read-only: nav assertions + direct-URL checks.
6. Cleanup: suspend scratch account; verify no pending QA invites.

## Formal E2E suite

`npm run test:e2e` (Playwright Test, `backend/../e2e/`). Configuration
needs `.env.e2e` (copy `.env.e2e.example`) — **never committed**. The
suite covers the highest-value checks (login/logout, invite/copy-link,
onboarding chain, Outlook not-connected, Resource Hub, Splose denials,
write blocks, Accounting invisibility, identity/title/freshness guards)
and skips gracefully when credentials are absent.

## Stop conditions

Stop and report rather than continue if: staging is unhealthy; any write
flag reads true; a permission check unexpectedly RETURNS data (potential
exposure — treat as Critical, do not keep pulling data); or the pending
production gate shows anything other than `waiting` when it should be
untouched.
