# Inductions

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement** (bundles three tasks at different maturity — see per-task breakdown)
- Addressed in change window (since last audit, 2026-10-24): no — no commit this window touched `learning-routes.js`, `learning-content.js`, `induction-assistant-routes.js` or the induction/walkthrough frontend files.
- Created (code exists): yes, for two of three tasks

## Per-task breakdown

### Induction Playground (AI co-authoring builder) — tab-unproven
- Located: `backend/induction-assistant-routes.js` (mounted `/api/learning/assistant`), frontend `induction-assistant.js`/`.css`.
- Guard: `router.use('/api/learning/assistant', requireAuth, requireRole('owner'))` — correctly owner-only.
- AI-gateway boundary respected: goes through `backend/ai/ai-gateway.js`, no direct vendor SDK import.
- Tests: `tests/induction-assistant.test.js` (unit), `tests/integration/induction-assistant.itest.js` (integration) — **both pass** (re-run tonight).
- **No E2E/browser proof exists for this screen specifically.** `e2e/tests/` only has `portal.spec.js` and `tutorials.spec.js`; the latter covers the learner/walkthrough experience, not the owner's AI assistant screen. No mention in `docs/qa/BROWSER_QA_RESULTS.md`.
- No TODO/FIXME found.

### Portal Inductions (everyday walkthrough) — proven
- Located: `backend/learning-routes.js` (guarded `requireAuth`; admin routes additionally `requireRole('owner')`; `/api/learning/my*` is self-scoped by design to `req.user.id`), `backend/learning-content.js`, frontend `induction.js`/`.css`, `induction-modules.js`. Lives inside the Resource Hub tab, no separate banner.
- Tests: `tests/learning-admin-routes.test.js`, `tests/learning-content.test.js`, `tests/learning-routes.test.js`, `tests/induction-registry.test.js`, `tests/assign-learning-guards.test.js` (unit); `tests/integration/learning-admin.itest.js`, `tests/integration/learning.itest.js`, `tests/integration/onboarding-induction.itest.js` — **all pass** (re-run tonight).
- **Note (from 2026-10-22, unchanged tonight)**: `backend/learning-routes.js` carries a 16-line change from that night, a side-effect of Clinical Resources' recycle bin — a learning module's linked resource is flagged `resource_removed: true` if the document behind it was deleted or purged from the Library, so the learner sees "This resource was removed" instead of a dead link. The walkthrough engine itself (`learning-content.js`, `induction.js`, `induction-modules.js`) remains untouched. `tests/integration/onboarding-induction.itest.js` likewise carries a 2026-10-22 change asserting the Portal Onboarding Workflow's Owner-only activation gate — not an induction/walkthrough behaviour change.
- E2E: `e2e/tests/tutorials.spec.js` directly covers induction dashboard and walkthrough lifecycle (start/pause/resume/complete/restart, degraded-anchor handling).
- No TODO/FIXME found.

### Splose Inductions — needs-refinement (ambiguous scope)
- **Important finding**: this is not an unbuilt Portal→Splose data sync. A seeded induction module literally titled "Splose Induction" already exists in `backend/learning-routes.js` (staff training content about using Splose: account setup, booking, AI documentation, an 80%-pass quiz), built on the same tested learning infrastructure above.
- No code anywhere syncs induction *data* to the external Splose system (confirmed by a repo-wide grep for "splose" — only this content module and onboarding references surface).
- The tracker task has no notes, so its real intent is unclear: it may already be satisfied by the existing training content, or may mean something else that was never scoped.

## Open tasks from the tracker
"Induction Playground" (todo, detailed checklist, mostly unchecked), "Portal Inductions" (todo, no notes), "Splose Inductions" (todo, no notes).

## Commits in window that touched it
None — tonight's 8 commits (resource privacy/upload, booking "Make room", a
dependency patch) touched none of this feature's files. The 2026-10-22
incidental touches (`0195cb3`, `96324d9`, `f143965` — see note above) also
predate this window.

## Disagreement
None against tracker stage. The disagreement is internal to the tracker: the "Splose Inductions" task reads as unscoped/unstarted, but content that could satisfy a literal reading of its title already exists.

## Re-verified 2026-10-27
No commit since last night's audit (`896ace1`) touched this feature's files — the true window (`896ace1..41f45ed`) holds only Calendar sync-settings/Outlook/Splose work (see Portal - Splose - Outlook's folder). Re-ran the unit suite tonight: 223/223 passed, same as last night. `e2e/tests/tutorials.spec.js` still proves the walkthrough tab. Evidence label unchanged.

## Re-verified 2026-10-28
Real window tonight is `41f45ed..15acf0c` (travel desk-work, place-names autocomplete,
a dependency patch — see the morning brief §6); none of it touches `learning-routes.js`,
`learning-content.js`, `induction-assistant-routes.js` or the induction/walkthrough
frontend. Re-ran the unit set and the integration set
(`learning-admin.itest.js`, `learning.itest.js`, `onboarding-induction.itest.js`,
`induction-assistant.itest.js` — 152 passed across that integration batch together
with Interactive Assessments' and Opa Mobile Companion's files) tonight — all pass.
Evidence label unchanged.
