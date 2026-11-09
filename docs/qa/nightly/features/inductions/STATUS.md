# Inductions

Tracker stage: idea · Tracker environment: none
Evidence label: **proven**
Addressed in this change window: **no** · Created: **yes**

## Located files

- `backend/learning-routes.js` — owner CRUD/assign/versioning + employee "My Learning" (self-scoped exception, documented in the file header)
- `backend/learning-content.js` — pure helper
- `backend/tutorial-routes.js` — per-user tutorial/walkthrough progress
- `backend/walkthrough-routes.js` — owner authoring of walkthroughs
- `backend/induction-assistant-routes.js` — owner's AI co-author chat
- `backend/induction-packs/` — 6 JSON packs
- Frontend: `frontend/current/induction.js`, `induction-modules.js`, `induction.css`, `induction-assistant.js/.css` — reached via Resource Hub → Learning and a Help-panel overlay card.

Guarded, re-confirmed by direct grep tonight: `learning-routes.js`, `walkthrough-routes.js` mount `requireAuth` then gate owner actions with `requireRole('owner')`; `/api/learning/my*` and most of `tutorial-routes.js` are self-scoped to `req.user.id` (documented exception); `tutorial-routes.js`'s `/overview` uses an inline role check (`['owner','admin'].includes(req.user.role)`). `induction-assistant-routes.js` mounts `requireAuth, requireRole('owner')` together. No unguarded route found.

## Tests

- Unit (8 files): `assign-learning-guards.test.js`, `induction-assistant.test.js`, `induction-packs.test.js`, `induction-registry.test.js`, `learning-admin-routes.test.js`, `learning-content.test.js`, `learning-routes.test.js`, `walkthrough-content.test.js` — ran tonight as part of a combined 17-file run with Xero and Opa Mobile Companion; **all 8 files passed** within that run's **539/539** total.
- Integration (8 files): `induction-assistant.itest.js`, `learning-admin.itest.js`, `learning.itest.js`, `onboarding-induction.itest.js`, `tutorial-progress.itest.js`, `walkthrough-authoring.itest.js`, `walkthrough-catalogue.itest.js`, `walkthrough-evidence.itest.js` — ran tonight on isolated DB `therapy_scheduler_audit_g6_test`; **all 8 files passed** within that run's **212/212** total.

## Browser / E2E proof

`e2e/tests/tutorials.spec.js` exercises a full flow: login, open Resource Hub learning view, start → highlight → advance → pause (Escape) → resume after reload and after full logout/re-login; a second test completes a module and asserts server state plus the UI badge.

## Open tasks from the tracker

"Induction Playground" (todo), "Portal Inductions" (todo), "Splose Inductions" (todo).

## Commits in the window touching this feature

None. Zero commits landed on `develop` between the 2026-11-08 audit and tonight — `develop` is at the same commit (`34cf881`) both nights. (Last night's run, auditing the same commit, listed the six induction packs and related fixes that landed in the days before 2026-11-08; none of that is new tonight.)

## Disagreement

None.
