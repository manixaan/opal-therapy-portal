# Second laptop bootstrap — step by step

Paste this whole file into Claude Code on the new machine. It is written for
that session: follow the steps in order, stop at any ✗, and report the exact
output. Nothing here deploys anything or touches the practice's live systems.

**Context.** The Opal Therapy Portal repo lives at
`https://github.com/manixaan/opal-therapy-portal`. Development happens on each
person's own localhost with their own PostgreSQL. GitHub branch `develop` is the
shared line of finished work. GitHub branch `main` is what Azure staging runs,
and a push to it deploys, so **never push to `origin/main`**. Full rules:
`docs/TWO_MACHINE_DEV_WORKFLOW.md` once the clone exists, plus `CLAUDE.md`.

---

## Step 0 — Where the repo should live

Antony's primary machine keeps it at
`~/Documents/Claude/Projects/Therapy Scheduling Application`. Use the same path
if possible: `.claude/launch.json` in the repo contains that absolute path, and
matching it means the preview launcher works without edits.

```bash
mkdir -p ~/Documents/Claude/Projects && cd ~/Documents/Claude/Projects
```

## Step 1 — Homebrew

Skip if `brew --version` already works.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

On Apple Silicon, follow the two "Next steps" lines Homebrew prints to add it to
the shell PATH, then open a new terminal.

## Step 2 — Node 26, PostgreSQL 14, GitHub CLI

```bash
brew install nvm postgresql@14 gh
```

```bash
brew services start postgresql@14
```

```bash
brew link --force postgresql@14
```

Set nvm up in the shell (Homebrew prints the exact lines; they are usually these):

```bash
mkdir -p ~/.nvm && printf '\nexport NVM_DIR="$HOME/.nvm"\n[ -s "$(brew --prefix nvm)/nvm.sh" ] && . "$(brew --prefix nvm)/nvm.sh"\n' >> ~/.zshrc && source ~/.zshrc
```

```bash
nvm install 26 && nvm alias default 26
```

Verify:

```bash
node --version && npm --version && psql --version && psql -U postgres -d postgres -Atc 'select current_user'
```

Expected: `v26.x`, an npm 10 or 11, `psql (PostgreSQL) 14.x`, and the word
`postgres` on the last line. If the last command says the role `postgres` does
not exist, create it and re-run the check:

```bash
createuser -s postgres
```

## Step 3 — Sign in to GitHub

This must be done by Antony at the keyboard, not by Claude. Choose GitHub.com,
HTTPS, and "Login with a web browser".

```bash
gh auth login
```

```bash
gh auth status
```

Expected: `Logged in to github.com account manixaan`.

## Step 4 — Clone and point local `main` at `develop`

```bash
git clone https://github.com/manixaan/opal-therapy-portal.git "Therapy Scheduling Application" && cd "Therapy Scheduling Application"
```

```bash
git checkout -b main origin/develop
```

Verify the upstream is `develop`, not `main`:

```bash
git rev-parse --abbrev-ref main@{upstream}
```

Expected output: `origin/develop`. If it says `origin/main`, fix it now:

```bash
git branch --set-upstream-to=origin/develop main
```

Because the local branch is called `main` and the remote one `develop`, git's
default refuses a bare `git push`. Tell this clone to push to the upstream
branch regardless of name (repo-local setting, one time):

```bash
git config push.default upstream
```

## Step 5 — One-command setup

```bash
npm run setup -- --demo
```

This runs `scripts/dev-setup.js`. It checks the toolchain, writes
`backend/.env` with fresh random secrets and every remote-write flag set to
false, runs `npm install` in `backend/` and the root, creates the local
`therapy_scheduler` database, applies all migrations (through 063 at the time
of writing), seeds the three dev logins, seeds a demo week of appointments, and
loads the authored content from `seeds/content/` — the inductions, onboarding
packages, walkthroughs and Resource Hub catalogue the primary machine
exported. After that, `npm run content:import` after each pull keeps them
current (docs/TWO_MACHINE_DEV_WORKFLOW.md §3a).

The Resource Hub's uploaded files are not in git: resources list and open, but
a download needs the `RESOURCE_HUB_STORAGE_PATH` folder copied from the
primary machine.

Every step prints ✓ or ✗. A ✗ line is followed by a `→` line with the fix.
Common ones:

| ✗ line | Fix |
|---|---|
| cannot connect to PostgreSQL as "postgres" | `brew services list` should show postgresql@14 started; else `createuser -s postgres` |
| node outside the supported range | `nvm use 26` in this terminal, then re-run |
| psql / createdb not found | `brew link --force postgresql@14`, open a new terminal |

Re-running `npm run setup` is always safe. It never overwrites an existing
`backend/.env`.

Confirm the state afterwards:

```bash
npm run setup -- --check
```

Expected: six sections, all ✓, a migration list ending in
`063_onboarding_document_checks.sql`, then `Everything checks out.`

## Step 6 — Start the portal

```bash
npm start
```

Open <http://localhost:5001> and sign in as:

| Login | Password | Role |
|---|---|---|
| `owner@opaltherapy.dev` | `OwnerDev2026!` | owner |
| `admin@opaltherapy.dev` | `AdminDev2026!` | admin |
| `therapist@opaltherapy.dev` | `TherapistDev2026!` | therapist |

These accounts exist only in the local database. There is no real client data
and no Splose, Outlook or Xero key on this machine. Warnings at boot about
missing `MICROSOFT_CLIENT_ID` or `SPLOSE_API_KEY` are expected and harmless.

Stop the server with Ctrl+C when done. In Claude Code, the `opal-backend` entry
in `.claude/launch.json` starts the same server through the preview pane; if
the checkout is not at the Step 0 path, edit that entry's `RESOURCE_HUB_STORAGE_PATH`
to a folder that exists here.

## Step 7 — Confirm the git loop works, without changing anything

```bash
git pull
```

Expected: `Already up to date.` (or new commits from the other laptop).

```bash
git log --oneline -3
```

The top commit should be `bc4d90c chore(dev): one-command local setup…` or newer.

Do **not** push anything as part of this test. When real work starts, the daily
loop is: branch → commit → `git checkout main && git pull && git merge --ff-only <branch>` → `git push`.
That push lands on `origin/develop` and deploys nothing.

---

## Report back

Tell Antony which step you reached, and paste the output of:

```bash
npm run setup -- --check && git rev-parse --abbrev-ref main@{upstream} && git log --oneline -1
```

## Notes from the primary machine (7 Sep 2026)

- `npm run setup -- --check` passed there with all six steps green and
  migrations through 063 applied. The script had not yet been run against a
  truly empty machine; this bootstrap is that test.
- Files that make this possible: `scripts/dev-setup.js`,
  `docs/TWO_MACHINE_DEV_WORKFLOW.md`, `README.md`, root `package.json`. Commit
  bc4d90c on `origin/develop`.
- `.claude/launch.json` carries absolute paths from the primary Mac (see Step 0).
- `develop` has no GitHub branch protection yet, only convention. A rule that
  blocks force-push and deletion is a pending decision for Antony.
