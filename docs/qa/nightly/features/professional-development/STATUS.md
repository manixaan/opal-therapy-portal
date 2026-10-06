# Professional Development

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed this window (commits since 2026-10-04 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-04); the audited commit (`aacf8e68`) is still unchanged. This is the sixth consecutive reconfirmation night on this exact code. Tonight is not Sunday UTC, so targeted batches were run (not the complete suites) — see each section below for exactly what ran tonight.
- Created (any located code at all): **yes**

## Located files
- backend/resource-hub-r2-routes.js — pd_events CRUD, filter by topic/mode/cost/CPD hours, past-event rollover, admin endpoints, Home-page preview query
- frontend/current/resourcehub.js — renderPd/renderPdCard/renderPdDetail/renderPdForm, Home preview card, admin form, CPD-hours filter, route #resources/pd[/eventId]
- frontend/current/navigation.js — route encode/decode for #resources/pd

## Guard check
Guarded consistently with the rest of resource-hub-r2-routes.js's requireAuth + role-based read/write split. Route round-tripping, nav entry, Home preview copy, CPD-hours visual tier and admin form fields all verified directly in the shipped files tonight.

## Tests run tonight
- unit: `pd-catalogue-guards.test.js` — 46/46 pass — run directly tonight, independently confirmed

## Open tasks (from the tracker)
- (no tasks recorded in the tracker — the card has a title only)

## Compare with the tracker
Significant: the tracker card has stage "idea" and zero recorded sub-tasks, implying nothing has started. In reality this is a fully built, tested feature with its own tab, admin authoring UI, and a Home-page preview card. Recommend the team add this as a proper feature card with its own idea/why text.
