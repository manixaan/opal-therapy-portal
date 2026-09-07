# Two machines, one repo — local-first development workflow

Each developer runs the portal on their **own** localhost with their **own**
PostgreSQL. GitHub is the only thing the machines share. Nothing on one laptop
can affect the other until it is pushed, and nothing pushed reaches staging
until it is merged to `main`.

```
 laptop A                      GitHub                        laptop B
 ─────────                     ──────                        ─────────
 local main  ──push──▶  origin/develop  ◀──push──  local main
 localhost:5001                 │                            localhost:5001
 own Postgres                   │  /opal-release only        own Postgres
                                ▼
                           origin/main  ──GitHub Actions──▶  Azure staging
```

## 1. Branch map — read this twice

| Where | Name | Meaning |
|---|---|---|
| GitHub | `develop` | The shared integration line. Everything finished lands here. |
| GitHub | `main` | **What staging runs.** A push here deploys (`deploy-staging.yml`). |
| Each laptop | `main` | Your local integration tree. It **tracks `origin/develop`**, not `origin/main`. |
| Each laptop | `<feature>` branches / worktrees | Work in progress. |

The local branch is still called `main` so every existing rule, skill and memory
that says "commit on main, release from main" keeps working unchanged. Only its
upstream differs: `git pull` and `git push` on local `main` move `origin/develop`.
Moving `develop` → `origin/main` is a release, done by `/opal-release` with an
explicit `git push origin main:main`, and never by accident.

## 2. Setting up a second machine (macOS)

Prerequisites, once:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

```bash
brew install nvm postgresql@14 gh && brew services start postgresql@14
```

```bash
nvm install 26 && nvm use 26
```

```bash
gh auth login
```

Then the repo:

```bash
git clone https://github.com/manixaan/opal-therapy-portal.git "Therapy Scheduling Application" && cd "Therapy Scheduling Application"
```

```bash
git checkout -b main origin/develop
```

```bash
npm run setup -- --demo
```

```bash
npm start
```

Open <http://localhost:5001> and sign in as `owner@opaltherapy.dev` with
password `OwnerDev2026!`. Those are local-only accounts created by the seed;
the database is empty of real practice data and has no integration keys.

`npm run setup` is safe to re-run at any time. It never overwrites an existing
`backend/.env`, so any keys you add by hand survive. `npm run setup -- --check`
reports what is missing without changing anything.

**Claude Code on the second machine.** `CLAUDE.md`, `.claude/rules/`, the
skills and the hooks are all in the repo, so a session there behaves the same.
Claude's *memory* directory is per machine and is not shared; the second laptop
starts without this one's recollections. `.claude/launch.json` is committed but
holds machine-specific absolute paths — edit the `opal-backend` entry there if
your checkout lives somewhere else.

## 3. The daily loop

Before starting anything:

```bash
git checkout main && git pull
```

```bash
npm run setup -- --check
```

(the check catches a migration someone else added — run `npm run setup` to apply it.)

Work on a branch or worktree, exactly as `.claude/rules/concurrency.md` describes.
Commit as often as you like. Nobody sees local commits until you push.

When a piece of work is finished:

```bash
git checkout main && git pull && git merge --ff-only <feature>
```

If fast-forward fails, `git rebase main <feature>` first, then merge. Then:

```bash
git push
```

That push takes a few seconds and lands on `origin/develop`. The other laptop
picks it up on its next `git pull`. No deploy happens.

## 4. Releasing to staging

Only through `/opal-release`, only when Antony says so. The release task
validates the tree, then:

```bash
git push origin main:main
```

GitHub Actions runs the full CI (unit, integration, migration validation, audit)
and deploys to `opal-portal-staging` only if it is green. Migrations run on the
App Service at startup. Either laptop *can* do this; the agreement is that one
person does, after saying so.

## 5. Conflicts — what actually happens

Two people editing the same file at the same time is normal and safe. Git only
objects when both changed the **same lines**; then the second person to merge
resolves it by hand (Claude Code does this well). In this repo the files that
everyone touches are:

- `frontend/current/mockup_v3.html` — the `?v=` cache-bust pins
- `backend/tests/assessment-surface-guards.test.js` — the pin assertions
- `backend/server.js` — router mounts

Those conflicts are mechanical: keep both sides, bump the pin once more, run
`node scripts/check-asset-pins.js`.

The conflict git **cannot** see is two people creating the same migration
number. `backend/migrations/NNN_*.sql` numbers are claimed by saying so before
you start a schema change. `migrate.js status` on the merged tree shows a
duplicate immediately.

## 6. Never

- `git push origin main:main` outside a release. That is a deploy.
- `git push --force` on `develop` or `main` (GitHub blocks it on `main`).
- Commit `backend/.env`, `.env.e2e`, or anything under `deploy/*.local.txt`.
  They are gitignored; `git status` should never show them.
- Turn on `ENABLE_SPLOSE_WRITE`, `ENABLE_OUTLOOK_WRITE`, `ENABLE_SPLOSE_DRAFT_SYNC`
  or `ENABLE_XERO_WRITE` on a machine that also holds real integration keys
  without an explicit decision. `npm run setup` pins all of them to `false`.
- Point a local server at any database whose name does not belong to you.
  Integration tests refuse non-`_test` names; the app does not.

## 7. GitHub-side guard rails (current state)

| Branch | Protection today |
|---|---|
| `main` | Pull request required, CI check "Unit + integration tests" must pass, no force-push, no deletion. Admins may bypass. |
| `develop` | None yet — the shared line is protected by convention only. |
| `azure-staging` | None. Not a deploy trigger; historical. |

Recommended next step, done in *Settings → Branches* on GitHub or with
`gh api`: add a rule for `develop` that blocks force-pushes and deletions. Keep
"require pull request" **off** for `develop` so the daily `git push` stays a
one-step action.
