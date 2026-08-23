# Agent instructions

This repository's operating guide for AI coding agents is **`CLAUDE.md`** at the
repository root. Read it first: it carries the repository map, the default
workflow, search behaviour, the four testing levels, and the deployment and git
rules.

Subsystem-specific guidance lives in `.claude/rules/` and is indexed in
`CLAUDE.md` §3 — read only the rule matching the files you are changing.
Directories that need it (`frontend/`, `backend/`, `backend/ai/`,
`backend/migrations/`, `backend/tests/`, `deploy/`) carry a short `CLAUDE.md`
pointer of their own.

Two rules bind every agent regardless of tool:

- **Do not deploy.** No Azure deployment, no `deploy/*.sh`, no workflow trigger
  outside an explicitly authorised release task.
- **Do not touch another session's work.** This tree is routinely dirty and holds
  live git worktrees. Stage explicit paths; never revert, restage, or delete work
  you did not create.
