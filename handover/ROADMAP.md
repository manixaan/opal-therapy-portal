# ROADMAP.md — Prioritised path to production

> Complexity: S ≤ half day · M ≈ 1–3 days · L ≥ several days. "Blocks prod" = must be done before real employees use it.
> Do the phases roughly in order; within a phase, do higher-priority items first.

---

## Phase 1 — Current-state reproducibility
Goal: anyone can clone → run → test identically. (Foundational; low risk.)

| Task | Pri | Risk | Impact | Cx | Deps | Acceptance | Auto tests | Manual tests |
|---|---|---|---|---|---|---|---|---|
| Rewrite `.env.example` to the complete list (ENVIRONMENT_VARIABLES.md) incl. PORT=5001, tenant, webhook vars | High | Low | Dev onboarding | S | — | Fresh clone with filled `.env` boots + passes tests | — | fresh-clone dry run |
| Add a top-level `README` "Run locally in 5 minutes" + point to `/handover` | High | Low | Onboarding | S | — | New dev productive without tribal knowledge | — | — |
| Pin Node engine in package.json (`"engines":{"node":">=20 <=26"}`) + document tested version | Med | Low | Reproducibility | S | — | CI/host use the right Node | — | — |
| Delete/relocate dead files (routes-backup-original, routes-outlook-integration, CLI probes → `/scripts`) after owner sign-off | Med | Low | Clarity | S | — | grep shows no runtime refs | test suite still green | — |
| Add a DB-integration test harness (`pg-mem` or throwaway Postgres) that runs `INIT_QUERIES` then hits a few real routes | High | Med | Catches schema bugs | M | — | The three 🔴 SQL/dep bugs are caught by CI | new suite | — |

## Phase 2 — Broken user-facing functionality (fix the 🔴/🟠 bugs)
Goal: every button that exists works. (High user impact, mostly small.)

| Task | Pri | Risk | Impact | Cx | Deps | Acceptance | Auto tests | Manual tests |
|---|---|---|---|---|---|---|---|---|
| #1 `bcrypt`→`bcryptjs` in change-password | High | Low | Password rotation | S | Phase1 DB test | Change password succeeds | route DB test | Settings→change pw |
| #2 remove `has_outlook_connected` from admin users SELECT | High | Low | Team management | S | Phase1 DB test | Owner user list loads | route DB test | owner→User Mgmt |
| #3 fix/remove base_location check | Med | Low | Notification accuracy | S | — | Notifications load with no swallowed error | — | load notifications |
| #4 onboarding Outlook route → `/auth/outlook-login`, read `authUrl` | High | Low | Onboarding | S | — | Outlook connects during onboarding | — | full onboarding |
| #5 fix "Sync now" (export fn or call delta logic) | Med | Low | Manual sync | S | — | Button triggers a real sync, reports counts | route test | Settings→Sync now |
| #9 allow `read_only` invites | Med | Low | Team roles | S | — | Owner can invite a read_only user | invite test | invite flow |
| Remove/guard dev owner auto-create in OAuth callback (part of #12) | High | Med | Security | S | — | Unknown MS email cannot become owner in prod | callback test | — |

## Phase 3 — Data-loss prevention (do before any production traffic)
Goal: no path can wipe the calendar. (Critical — irreversible Outlook deletes possible today.)

| Task | Pri | Risk | Impact | Cx | Deps | Acceptance | Auto tests | Manual tests |
|---|---|---|---|---|---|---|---|---|
| #7 Splose poller empty/threshold guard | High | Med | Prevents mass delete | S | — | Empty/failed Splose fetch performs zero deletes + alerts | unit: empty set no-delete | simulate empty Splose |
| #8 Outlook reconcile empty/threshold guard | High | Med | Prevents window wipe | S | — | Empty/failed Graph fetch aborts reconcile | unit: empty ids no-delete | simulate empty window |
| Make pollers distinguish "genuinely empty" vs "fetch failed" (require complete pagination + HTTP ok) | High | Med | Correctness | M | above | Partial/failed fetches never drive deletions | unit | — |
| Nightly DB backup before enabling pollers in prod | High | Low | Recoverability | S | Phase6 | Restorable snapshot exists | — | restore drill |

## Phase 4 — Security hardening
Goal: pass a basic security review. (See SECURITY_REVIEW.md.)

| Task | Pri | Risk | Impact | Cx | Deps | Acceptance | Auto tests | Manual tests |
|---|---|---|---|---|---|---|---|---|
| #12 enforce OAuth `state` in prod; validate returnUrl same-origin | High | Med | CSRF | S | — | Mismatched state → 400 in prod | callback test | — |
| Set `TOKEN_ENCRYPTION_KEY` in every env; confirm tokens encrypt at rest | High | Low | Token security | S | — | DB access_token values are `enc:`-prefixed | — | inspect a row |
| #13 HTML-escape email interpolations | Med | Low | Email injection | S | — | Malicious name renders inert | unit | — |
| `npm audit` remediation: apply non-breaking `npm audit fix`; schedule nodemailer/uuid major bumps with testing | High | Med | CVE exposure | M | — | 0 high vulns after safe fixes; majors tracked | full suite after each | send test email |
| Production CSP (remove inline scripts or use nonces) | Med | High | XSS defence | L | Phase9 modularisation | helmet CSP enabled without breaking app | — | full smoke |
| Rate-limit password reset / registration endpoints at the edge too | Med | Low | Abuse | S | — | Bursts throttled | — | — |
| Add security headers verification + secrets-scanning in CI | Med | Low | Hygiene | S | — | CI blocks committed secrets | CI | — |

## Phase 5 — Database & integration consistency
| Task | Pri | Risk | Impact | Cx | Deps | Acceptance | Auto tests | Manual tests |
|---|---|---|---|---|---|---|---|---|
| Adopt a migration tool (node-pg-migrate); freeze INIT_QUERIES as the baseline migration | High | Med | Schema safety | M | — | Migrations versioned, reversible, drift-checkable | migration test | — |
| Backfill `organisation_id` on users+events; simplify org-fallback queries | Med | Med | Multi-tenant correctness | M | migrations | All rows have org; fallbacks simplified | — | — |
| #17 persist Splose appointments to `events` (add source='splose'); serve one unified feed | High | High | Single source of truth | L | migrations | Splose sessions visible to backend features; no double-count with Outlook mirrors | sync tests | cross-check week vs Splose/Outlook |
| #16 move manual address overrides + session notes to DB | Med | Med | No data loss | M | #17 | Overrides/notes survive browser clear + other devices | — | edit then clear browser |
| #6 fix webhook raw-body; verify real-time works on a public host | High | Med | Real-time sync | M | Phase6 domain | Graph notification → delta sync within seconds | webhook test | edit in Outlook, watch app |
| #10/#11 remove orphan/dead routes (local events, busy-times POST) | Low | Low | Clarity | S | — | grep-clean; no 500-only routes | suite green | — |
| Add missing indexes (sync_log status/created_at; events partial) | Low | Low | Perf | S | migrations | Query plans use them | — | — |

## Phase 6 — Production deployment
| Task | Pri | Risk | Impact | Cx | Deps | Acceptance | Auto tests | Manual tests |
|---|---|---|---|---|---|---|---|---|
| #15 remove hardcoded localhost URLs (single API_BASE) | High | Med | **Blocks prod** | M | — | App works served from a real domain | — | run behind domain |
| Choose host (must support long-running Node + WebSocket + in-process timers) — see DEPLOYMENT_READINESS | High | Med | Blocks prod | M | — | Selected + provisioned | — | — |
| Managed PostgreSQL + connection string via env | High | Low | Blocks prod | S | — | App connects to managed DB | — | — |
| Process manager / container + start command; `PORT` from env | High | Low | Blocks prod | S | — | Boots under the host's model | — | — |
| Set ALLOWED_ORIGINS, MICROSOFT_REDIRECT_URI (Azure), APP_BASE_URL, WEBHOOK_BASE_URL for the domain | High | Med | Blocks prod | S | domain, Azure | OAuth + CORS + emails + webhooks target prod | — | login via prod, connect Outlook |
| First-owner bootstrap in prod (set ALLOWED_EMAILS before first boot) | High | Med | Blocks prod | S | — | First owner can register | — | register owner |
| TLS/HTTPS (secure cookies depend on it) | High | Low | Blocks prod | S | domain | https only; secure cookie set | — | — |
| Verify email deliverability (SPF/DKIM on EMAIL_FROM domain) | Med | Med | Onboarding | M | — | Invite/verify/reset land in inbox | — | send to real inbox |

## Phase 7 — Monitoring, backups, incident handling
| Task | Pri | Risk | Impact | Cx | Deps | Acceptance |
|---|---|---|---|---|---|---|
| Error monitoring (Sentry or host-native) on backend | High | Low | Visibility | S | Phase6 | Unhandled errors + 500s captured |
| Structured logs shipped off-box; retain sync_log/audit_logs | Med | Low | Forensics | M | Phase6 | Searchable logs |
| Automated daily DB backups + tested restore runbook | High | Med | Recoverability | M | Phase6 | Restore verified in a drill |
| Uptime/health monitoring on `/health` + alert | Med | Low | Availability | S | Phase6 | Alert on downtime |
| Sync-health alerting (use `/api/sync/diagnostics`: ghost/dup counts, last error) | Med | Low | Sync integrity | S | — | Alert when duplicates>0 or delta stale |

## Phase 8 — Employee pilot testing
| Task | Pri | Impact | Cx | Acceptance |
|---|---|---|---|---|
| Run MANUAL_TEST_PLAN.md end-to-end per role in a staging env | High | Confidence | M | All checklist items pass |
| Single-therapist pilot (Ann's real calendar), 1–2 weeks, monitor diagnostics daily | High | Real validation | M | No dupes/ghosts over 3+ full sync cycles; no data loss |
| Collect + triage pilot feedback; fix blockers | High | Quality | M | Sign-off to add more users |
| Then create real therapist_profiles + backfill org, enable master calendar | Med | Multi-user | M | Master calendar shows real therapists |

## Phase 9 — Frontend maintainability & modularisation
| Task | Pri | Impact | Cx | Acceptance |
|---|---|---|---|---|
| Extract a shared `api.js` (one API_BASE + fetch wrapper + error handling) | High | Kills #15, enables CSP | M | All fetches go through it |
| Split mockup_v3 into modules (calendar engine, SploseSync, booking, settings, profile, notifications) | Med | Maintainability | L | Files <~2 k lines each; app unchanged |
| Introduce a light build step (esbuild) enabling CSP nonces | Med | Security+DX | M | CSP can be enabled |
| Add Playwright happy-path E2E | High | Regression safety | M | login→book→refresh→delete passes in CI |

## Phase 10 — Performance & scale
| Task | Pri | Impact | Cx | Acceptance |
|---|---|---|---|---|
| #18 window `/api/events` by date; frontend fetches per visible range | Med | Boot/memory | M | Boot loads one week, not all history |
| Splose fetch: reduce full-list scans (cache tuning; paginate; incremental) | Med | API load | M | Fewer/cheaper Splose calls; within rate limit |
| #19 documents → object storage | Low | DB size | M | Files off the DB |
| Load-test pollers with 10× events; confirm 90 s budget holds | Low | Scale | M | Delta cycle < interval at scale |
