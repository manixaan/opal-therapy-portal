Feature: Inductions
Tracker stage: idea
Tracker environment: none
Evidence label: needs-refinement
Addressed in change window (2026-10-02 to 2026-10-16): no
Created (any located code): yes

## Located files
`backend/induction-assistant-routes.js` (`router.use('/api/learning/assistant',
requireAuth, requireRole('owner'))`, calls `require('./ai/ai-gateway')` —
AI gateway boundary respected and owner-only), `backend/learning-routes.js`
(`router.use('/api/learning', requireAuth)`), `backend/learning-content.js`,
`backend/walkthrough-content.js`, `backend/walkthrough-catalogue.js`,
`backend/walkthrough-anchors.js`.

## Guard check
Pass. The AI co-author tool is correctly walled off (owner-only, routed
through the single AI gateway).

## Tests run
- Unit: `induction-assistant`, `induction-registry`,
  `learning-admin-routes`, `learning-content`, `learning-routes`,
  `walkthrough-content`, `assign-learning-guards` → 7 suites / 258 tests,
  all PASS
- Integration (`DB_NAME=therapy_scheduler_audit`): `induction-assistant.itest.js`,
  `learning.itest.js`, `learning-admin.itest.js`,
  `walkthrough-authoring.itest.js`, `walkthrough-catalogue.itest.js`,
  `walkthrough-evidence.itest.js`, `tutorial-progress.itest.js` → all PASS

## Browser / E2E evidence
Strong. `e2e/tests/tutorials.spec.js` covers: the owner's Assign Learning
catalogue view; the learner dashboard (progress, modules, thumbnails,
role-filtered); walkthrough start → highlight → advance → pause → resume
(surviving reload and re-login); module completion persisting and restart
resetting it; a missing anchor degrading gracefully; and a walkthrough
launched from a tutorial resource page. **Not covered:** the AI co-author
chat tool itself has no browser/E2E check.

## Open tasks from tracker
- Induction Playground [todo]
- Portal Inductions [todo] — no description recorded in the tracker
- Splose Inductions [todo] — no description recorded in the tracker

## Commits in window touching this feature
None.

## Disagreement with tracker
None new. The tracker's own prior Claude update already states that
"Portal Inductions" and "Splose Inductions" (both still marked `todo`)
are in fact already built and tested; this audit's evidence (a solid,
well-tested, E2E-proven induction/learning system) is consistent with
that self-correction, though the raw task checkboxes haven't been
updated to reflect it.
