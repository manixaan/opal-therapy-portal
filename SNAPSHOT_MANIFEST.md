# SNAPSHOT_MANIFEST.md — Opal Therapy Scheduler transfer snapshot

| Field | Value |
|---|---|
| Git branch | `main` |
| Commit hash | `5581ab1d09e518a7a757276798df5f017f30b286` |
| Creation date | 2026-07-12 |
| Node version | v26.0.0 |
| npm version | 11.12.1 |
| Test result | 3 suites / **47 tests, 47 passed, 0 failed, 0 skipped** (re-run immediately before packaging) |
| SHA-256 of completed ZIP | `cbc24f14dc8e8c2ca8a22c89b2c79f7cf83534f32af86e83f70d5d353c434e97` |

## Contents
Exact tracked tree of commit `5581ab1` (exported via `git archive`) **plus** the untracked `/handover` documentation package (14 files), **minus** the sanitisation exclusions below. Includes all backend/frontend/test source, schema-creation code (`backend/database.js` INIT_QUERIES — no separate migration files exist), `package.json` + `package-lock.json`, redacted `backend/.env.example`, all README/docs, `.gitignore`, `.claude/launch.json` (dev-server launch config, no secrets), and all install/seed/test/run scripts (`backend/setup/seed-users.js`, npm scripts).

## Excluded (never staged or removed before packaging)
- `.git/` — history not included; the commit hash above is the reference
- `node_modules/` — reinstall with `npm ci` in `backend/`
- `backend/.env` — real secrets (API keys, DB password, session secret, encryption key)
- `.claude/worktrees/` — untracked local AI-tooling cache
- `Opal_Therapy_Security_Review.docx`, `write_access_capability_report.docx` — historical binary reports; excluded as unverifiable for personal/clinical content (their substance is superseded by `/handover`)
- `.DS_Store`, `*.log` — none present in the tracked tree
- No database exports, uploaded documents, OAuth/Microsoft/Splose/Google tokens or credentials, or client/participant/clinical records are present anywhere in this archive (verified by pattern scan — see below)

## Sanitisation applied to STAGED COPIES ONLY (the repository itself is unmodified)
Three files differ from commit `5581ab1` by email-address redaction only (no code/behaviour change):
1. `backend/register-routes.js:32` — comment example email → `owner-email@example.com`
2. `frontend/archive/mockup_v2.html:2679` — email in a dead archive mockup label → redacted
3. `docs/archive/PROJECT_HANDOFF.md:3` — email in an archived doc header → redacted

## Known identifying content deliberately retained (flagged, not secret)
- Practice name "Opal Therapy" and the practitioner's public display name appear as UI copy/docs content (it is the practice's own app).
- `backend/outlook-oauth.js` contains a hardcoded Azure **tenant ID** (a directory identifier, not a credential) — see `handover/ENVIRONMENT_VARIABLES.md` for the recommendation to move it to env.
- `backend/setup/seed-users.js` contains clearly-marked DEV-ONLY default passwords, overridable via env; do not use in production.
- Author name in `package.json` and archived docs (standard authorship metadata).

## Verification performed before packaging
1. `git rev-parse HEAD` = `5581ab1…` on `main` ✓  2. `git status`/`git diff` — no uncommitted tracked changes ✓  3. `npm test` — 47/47 pass ✓  4. Secret scans (Google-key/JWT/PEM/hex-assignment/`enc:` token patterns, env-style assignments) — no real secrets ✓  5. `.env.example` — placeholders and safe defaults only ✓  6. PII scans — no real client names (sampled against live data); employee emails redacted as listed ✓

## Reproduce / verify
```bash
unzip opal-scheduler-snapshot-5581ab1.zip && cd opal-scheduler-5581ab1/backend
npm ci                       # install exact locked dependencies
cp .env.example .env         # then fill real values (see handover/ENVIRONMENT_VARIABLES.md)
npm test                     # expect 47/47
npm start                    # boots on PORT (default expectation: 5001)
```
Start reading at `handover/README.md`.
