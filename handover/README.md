# Handover Package — Opal Therapy Scheduler

Generated 2026-07-12 from the actual repository at commit `5581ab1` (branch `main`), with live boot / test / `npm audit` / database verification. Where anything could not be verified it is flagged "needs verification" rather than guessed.

**Start here if you're continuing the project:** `AI_CONTINUATION_NOTES.md`, then `CURRENT_STATE.md`.

## Contents
| File | What it covers |
|---|---|
| `CURRENT_STATE.md` | Git/runtime facts, boot+test status, the honest implemented/broken/dead ledger, live data snapshot |
| `PROJECT_TREE.md` | Full tree; every important file's purpose + used/legacy/dead status; authoritative vs obsolete frontend |
| `ARCHITECTURE.md` | All subsystems + 15 step-by-step data flows (FE fn → API → BE fn → tables → external API) |
| `API_INVENTORY.md` | Every route: method, file, auth, role, body, DB, external API, status; duplicates/orphans |
| `DATABASE_SCHEMA.md` | Live schema (columns/types/keys/constraints/indexes), per-table ownership + row counts, code↔schema drift |
| `ENVIRONMENT_VARIABLES.md` | Redacted complete `.env.example`; per-var behaviour; every hardcoded URL/port/tenant |
| `FRONTEND_MAP.md` | mockup_v3 structure, all globals/state/storage/socket events, flows, modularisation targets |
| `TEST_REPORT.md` | 47/47 pass; per-file coverage; the workflows with NO automated tests |
| `KNOWN_ISSUES.md` | 20 revalidated issues (severity, exact file:line, repro, fix, tests) + FIXED log with evidence |
| `ROADMAP.md` | Phases 1–10 with priority/risk/complexity/acceptance/tests per task |
| `DEPLOYMENT_READINESS.md` | Hosting needs + the 10 production blockers |
| `MANUAL_TEST_PLAN.md` | Role-based E2E checklist (owner/admin/therapist/read-only + shared + failure modes) |
| `SECURITY_REVIEW.md` | 20-area review + verified `npm audit` (8 vulns) with a safe remediation plan |
| `AI_CONTINUATION_NOTES.md` | Rules, sources of truth, high-risk paths, change order, post-change commands |

## The one-paragraph summary
A single-process Node/Express + PostgreSQL app with a single-file vanilla-JS frontend, syncing an internal calendar bi-directionally with Outlook (Microsoft Graph) and one-way-plus-cancellations with Splose. The **core sync loop is solid and tested** (idempotent upserts, tombstones, loop prevention, ~90 s freshness, no duplicates/ghosts). It runs cleanly locally and all 47 tests pass. It is **not production-ready**: there are six broken user-facing features (three from SQL/dependency bugs that the mocked tests don't catch), two dangerous mass-delete paths lacking safety guards, hardcoded localhost URLs in the frontend, no deployment artefact/host/backups, and unaddressed security/audit items. The prioritised path to production is in `ROADMAP.md`; do Phase 1 (reproducibility + a DB-integration test harness) before anything else, because it's what makes the rest verifiable.
