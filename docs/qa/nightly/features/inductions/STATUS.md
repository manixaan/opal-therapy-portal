# Inductions

- Tracker stage: idea · Tracker environment: none
- Evidence label: **needs-refinement** — corrects an inconsistency in the 2026-11-04 brief, whose
  STATUS.md body said `needs-refinement` but whose summary table said `tab-unproven` for the same
  evidence. Settling on `needs-refinement` tonight: the tracker's own wishlist names a concrete
  unbuilt piece (the "hold point" step type), which is a real code gap, not merely an absence of
  browser proof — the latter is also true here, but is the secondary reason.
- Addressed in this change window: no — zero commits since the 2026-11-04 audit's cutoff
- Created (any located code): **yes** — substantial build

## Located files

- Backend: `backend/learning-routes.js`, `backend/learning-content.js`,
  `backend/induction-assistant-routes.js` (AI co-author via the gateway), `backend/walkthrough-{content,routes,catalogue,anchors}.js`.
- Frontend: `frontend/current/induction.js`, `induction-modules.js`, `induction-assistant.js` —
  embedded in the Onboarding/help-panel area of `mockup_v3.html`, no standalone tab banner.
- Guards: `induction-assistant-routes.js:69` `requireAuth, requireRole('owner')`;
  `learning-routes.js:56-57` `requireAuth` + per-route `requireRole('owner')`. No unguarded routes.
- AI gateway: compliant — `induction-assistant-routes.js:37` goes through
  `backend/ai/ai-gateway.js` only, policy `induction_assistant`, INTERNAL classification,
  Australian region documented.

## Tests and results

- Unit: 7 suites / 258 tests — **all pass**.
- Integration: `induction-assistant.itest.js`, `learning.itest.js`, `walkthrough-authoring.itest.js`
  — **all pass**.
- No E2E spec, no browser QA entry.

## Open tasks from the tracker

- "Induction Playground" — todo, all checklist items (and sub-items) unchecked.
- "Portal Inductions" / "Splose Inductions" — both empty, no explanation.

## Findings

Not a naming mismatch — a real, substantially built feature. Step types implemented today:
`intro`, `highlight`, `action`, `screenshot`, `callout`, `warning`, `quiz`, `complete`. **No "hold
point" step type exists** — that part of the tracker's wishlist is genuinely unbuilt. The
AI-assisted builder (chat that creates/edits inductions via tools) is built and gateway-compliant.
