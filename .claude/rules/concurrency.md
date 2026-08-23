# Rule — concurrent sessions & the working tree

Several Claude and Codex sessions share this checkout. The primary tree is the
integration tree, not a scratchpad.

```
main / integration tree
        |
        +-- worktree: feature-A
        +-- worktree: feature-B
        +-- worktree: feature-C
```

## Before you start

- **Do not begin a new feature in a primary tree that already holds unrelated
  uncommitted feature work.** `git status` first. If it is dirty with someone
  else's change, implement in an isolated worktree/branch instead:

  ```
  git worktree add .claude/worktrees/<feature> -b <feature>
  ln -s "$PWD/backend/node_modules" .claude/worktrees/<feature>/backend/node_modules
  ```

  A fresh worktree needs its own `backend/node_modules` — symlink the primary
  checkout's rather than re-installing. Give the session its own test database
  (`.claude/rules/tests.md`).
- A FAST change to one or two files in an otherwise clean tree does not need a
  worktree.

## While you work

- **One task → one focused commit.** `git add` explicit paths only.
- **Never touch another session's dirty files** — no editing, no staging, no
  restaging, no reverting, no stashing, however unrelated they look.
- Never delete a worktree you did not create. Verify with `git -C <path> status`
  and `git merge-base --is-ancestor` first, then `git worktree remove` — never
  `rm -rf`.

## Afterwards

- Integration of completed commits belongs to the integration/release workflow
  (`/opal-release`), not to the feature task that produced them.
- Leave the tree no dirtier than you found it. If your work is done, it is a
  commit; if it is not done, it is a commit on a worktree branch.
