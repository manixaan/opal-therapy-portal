# Opal Therapy Portal — Claude operating guide

Read this once per session. Everything subsystem-specific lives in `.claude/rules/`
and is read **only** when you touch that subsystem.

## 1. What this is

An internal portal for an Australian NDIS therapy practice: scheduling, clinical
case notes, assessments (FCA / WHODAS), employee onboarding, a Resource Hub,
learning modules, and Xero-backed accounting. Real clinical and employment data
— treat every change as production-adjacent.

Stack: Node 20 + Express + PostgreSQL (`pg`, raw SQL) + Socket.IO on the backend;
static HTML/CSS/vanilla JS on the frontend (no build step, no framework). AI runs
through AWS Bedrock behind an in-repo gateway. Hosting is Azure App Service.

## 2. Repository map

| Area | Location |
|---|---|
| Frontend (live) | `frontend/current/` — `mockup_v3.html` is the app shell; one `<feature>.js/.css` per tab |
| Frontend (dead) | `frontend/archive/` — never edit, exclude from searches |
| Backend entry | `backend/server.js` — mounts every `*-routes.js` (grep here to find a route's file) |
| API routes | `backend/*-routes.js` (+ legacy catch-all `backend/routes.js`) |
| Data access | `backend/database.js` (pool + `INIT_QUERIES` baseline schema), `backend/*-db.js` |
| Auth / RBAC | `backend/auth.js`, `backend/permissions.js`, `backend/session-store.js`, `backend/register-routes.js`, `backend/invite-routes.js`, `backend/outlook-oauth.js` |
| AI gateway | `backend/ai/` — `ai-gateway.js` is the only door to a model |
| Resource Hub | `backend/resource-*.js`, `backend/resources-routes.js`, `frontend/current/resourcehub.js` |
| Learning | `backend/learning-routes.js`, `backend/learning-content.js`, `frontend/current/induction*.js` |
| Assessments | `backend/fca/`, `backend/whodas/`, `backend/assessments/`, `backend/{fca,whodas,assessments,letter}-routes.js` |
| Onboarding | `backend/onboarding-*.js`, `backend/onboarding-policies/`, `frontend/current/onboarding.js` |
| Service agreements | `backend/service-agreement-routes.js`, `backend/service-agreements/` |
| Accounting / Xero | `backend/accounting-*.js`, `backend/xero-*.js` |
| Migrations | `backend/migrations/NNN_*.sql` (+ `README.md`, `backend/migrate.js`) |
| Unit tests | `backend/tests/*.test.js` (jest, no database) |
| Integration tests | `backend/tests/integration/*.itest.js` (real Postgres, serial) |
| E2E | `e2e/tests/*.spec.js` (Playwright, staging or local server) |
| Infra / deploy | `deploy/`, `.github/workflows/`, `backend/scripts/` |
| Docs | `docs/` (architecture, security, per-feature), `backend/docs/` |

## 3. Path-scoped rules — read only when relevant

| Working on | Read first |
|---|---|
| `frontend/current/**` | `.claude/rules/frontend.md` |
| `backend/**` routes/services | `.claude/rules/backend-api.md` |
| `backend/ai/**` or any AI feature | `.claude/rules/ai-gateway.md` |
| `backend/migrations/**`, schema | `.claude/rules/database-migrations.md` |
| `backend/tests/**`, `e2e/**` | `.claude/rules/tests.md` |
| `deploy/**`, `.github/workflows/**` | `.claude/rules/infrastructure.md` |

Directories with their own `CLAUDE.md` pointer will surface the right rule
automatically when you open a file there.

## 4. Default workflow

**Locate → Understand enough → Implement → Targeted validate → Commit → Stop.**

Normal feature implementation ends at the commit. It does **not** include
release integration, staging deployment, or full regression.

## 5. Search behaviour

- Start at the narrowest plausible file. `backend/server.js` maps URL → route file;
  `<!-- ============ X TAB ============ -->` banners map a tab → its block in `mockup_v3.html`.
- Widen only when the narrow search fails. Do not re-run repository-wide discovery
  you already ran this session, and do not re-read a file you have already read.
- Skip by default: `node_modules/`, `frontend/archive/`, `docs/archive/`, `handover/`,
  `reference/`, `test-results/`, `playwright-report/`, `.playwright-mcp/`,
  `.claude/worktrees/`, root `*_REPORT.md` snapshots.
- `rg`/Glob honour `.gitignore` **and** the repo's `.ignore`, so `node_modules`,
  build output and the archived directories above are already out of the way — do
  not add manual excludes for them. Those files stay readable; only search skips them.
- The biggest files and how to navigate them without reading them whole:
  `docs/LARGE_FILE_BASELINE.md`.

## 6. Testing policy — four levels

| Level | When | Validation |
|---|---|---|
| **FAST** | one small isolated edit | only the directly affected test file(s) |
| **FEATURE** | normal feature work | affected unit + integration tests; browser check only where it genuinely proves something |
| **CRITICAL** | auth, permissions, clinical/sensitive data, AI governance, audit logging, Xero/accounting, migrations, shared infra | broader validation proportionate to risk; still not the full suite unless the risk warrants it |
| **RELEASE** | explicit release task only | full regression, migration validation, browser smoke, health checks, deploy |

Commands (run from `backend/`):

```
npx jest tests/<file>.test.js                                   # one unit file
npm test                                                        # all unit tests (fast, no DB)
npx jest --config jest.integration.config.js tests/integration/<file>.itest.js --runInBand
npm run test:integration                                        # all integration (real Postgres)
npm run test:all                                                # unit + integration = RELEASE gate
node ../scripts/check-asset-pins.js                             # before any frontend commit
```

E2E (repo root): `npm run test:e2e:local` — RELEASE only.

## 7. Deployment rule

Normal development tasks must not deploy to Azure staging or production, run
`deploy/*.sh`, or trigger a deploy workflow. Deployment belongs to an explicit
RELEASE task authorised by the user.

## 8. Git rule

One logical task → one focused commit. `git add` explicit paths only: this tree is
routinely dirty with other sessions' work. Never revert or restage another
session's changes because they look unrelated. Never edit a `git rebase -i` /
force-push path without being asked.

## 9. Worktrees

`.claude/worktrees/` is gitignored and may hold live work from another session.
Never delete a worktree you did not create; verify with `git -C <path> status` and
`git merge-base --is-ancestor` before removing anything, and remove it with
`git worktree remove`, never `rm -rf`. A fresh worktree needs its own
`backend/node_modules` — symlink the primary checkout's rather than re-installing.

## 10. Completion behaviour

Finish with only:

**Implemented** · **Files changed** · **Validation** · **Commit** · **Integration notes** (if any)

No retrospectives, no restating the plan, no summarising what the user can read in
the diff. Explain at length only when a material problem needs it.

## 11. Skills

`/opal-fast-change` · `/opal-feature` · `/opal-critical` · `/opal-release` —
each carries the full procedure for that class of task so it stays out of this file.
