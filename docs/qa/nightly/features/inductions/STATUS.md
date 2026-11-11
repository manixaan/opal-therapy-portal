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

- Unit (8 files): `assign-learning-guards.test.js`, `induction-assistant.test.js`, `induction-packs.test.js`, `induction-registry.test.js`, `learning-admin-routes.test.js`, `learning-content.test.js`, `learning-routes.test.js`, `walkthrough-content.test.js` — run tonight as part of a combined 17-file batch with Xero and Opa Mobile Companion; **all 17 files passed, 539/539 tests**.
- Integration (8 files): `induction-assistant.itest.js`, `learning-admin.itest.js`, `learning.itest.js`, `onboarding-induction.itest.js`, `tutorial-progress.itest.js`, `walkthrough-authoring.itest.js`, `walkthrough-catalogue.itest.js`, `walkthrough-evidence.itest.js` — run tonight on isolated DB `therapy_scheduler_audit_g2_test`; **all 8 files passed, 133/133 tests**.

## Browser / E2E proof

`e2e/tests/tutorials.spec.js` exercises a full flow: login, open Resource Hub learning view, start → highlight → advance → pause (Escape) → resume after reload and after full logout/re-login; a second test completes a module and asserts server state plus the UI badge. Unchanged since no commits landed in this window; re-confirmed present tonight.

## Open tasks from the tracker

"Induction Playground" (todo), "Portal Inductions" (todo), "Splose Inductions" (todo).

## Commits in the window touching this feature

None. No commits landed on `develop` since last night's audit — `develop` is still at `40669e7`, the exact commit audited last night and re-verified again tonight.

## Disagreement

None.
