# Controlled Read-Only Live Test — Results Log

Companion to `READ_ONLY_LIVE_TEST_PLAN.md`. One row per observation; keep
entries short. **No client names or appointment content in this file** —
use counts, times, and event IDs only.

## Baseline (pre-connection, recorded 2026-07-19)

| Item | State |
|---|---|
| Staging build | branch `azure-staging`, deployed via health-gated pipeline |
| `/health` / `/ready` | 200 / 200 (database ok, migrations ok, config ok) |
| Feature flags | `outlookWrite:false, sploseWrite:false, automaticRemoteDelete:false` (app settings + runtime diagnostics agree) |
| Outlook (validation mailbox) | Connected as `adminservices@opaltherapy.com.au` — 3 events mirrored, delta cycling 90 s, refresh proven |
| Splose | Connected with the practice's durable API key (Key Vault); 2 practitioners / 1 location / 16 services; 1,610-record pagination verified; portal↔Splose sample fidelity exact |
| Write-block proofs | Outlook create/update 403 · Splose create 403 (`feature_disabled`) — with working credentials |
| Alerts configured | http-5xx, health-check, slow-response → email action group |
| Test suite | 109 unit + 73 integration passing |

## Phase 0 — Connection record

| Field | Value |
|---|---|
| Date/time connected | _(fill in)_ |
| Therapist portal account | _(fill in — portal email)_ |
| Connected mailbox | _(fill in — shown under Settings → Integrations)_ |
| Initial 14-day event count — portal | _(fill in)_ |
| Initial 14-day event count — Outlook | _(fill in)_ |
| Counts match? | _(Y/N)_ |

## Phase 1 — Daily checks

| Date | D1 new-event mirrors | D2 reschedule mirrors | D3 cancellation mirrors | D4 counts match | D5 health | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |

## Phase 2 — Deliberate probes (once)

| # | Probe | Result | Notes |
|---|---|---|---|
| 1 | Create → rename → delete in Outlook mirrors correctly | | |
| 2 | Recurring event mirrors sensibly | | |
| 3 | Live push with portal tab open (no refresh needed) | | |
| 4 | Splose appointment matches portal view | | |
| 5 | Portal write attempt refused with clear message | | |

## Phase 3 — Weekly integrity checks

| Check | Week 1 (date: ) | Week 2 (date: ) |
|---|---|---|
| /health + /ready green | | |
| Flags still all false | | |
| 14-day counts portal = Outlook | | |
| 5-event field spot-check clean | | |
| No duplicates | | |
| No ghost events | | |
| No unexplained alerts | | |

## Incidents / observations

| Date | What happened | Severity | Action taken | Resolved? |
|---|---|---|---|---|
| | | | | |

## Outcome

- [ ] **PASS** — exit criteria met on ____ ; proceed to write-back planning
- [ ] **FAIL/PAUSED** — reason: ____
