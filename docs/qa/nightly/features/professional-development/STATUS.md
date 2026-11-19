# Professional Development

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since the last audit (2026-11-17..2026-11-18): **no**
- Created (any located code): **yes**

## Located files
- No dedicated code of its own. Two plausible homes exist, and the card's own next_action has not picked between them: (1) backend/profile-routes.js — /api/profile/cpd, /api/profile/documents, /api/profile/credentials (My Profile's PD credentials/documents sections); (2) Resource Hub (backend/resources-routes.js, resource-library-routes.js) where PD-related material could equally well live as library content, which is where this audit has previously placed it.

## Could not locate / notable gaps
- No dedicated frontend tab or page for "Professional Development" as a standalone card either way.

## Guard check
OK either way — Resource Hub is requireAuth + requireRole('owner')/requireManager; profile-routes.js is requireAuth + inline canApprove.

## Tests run
- unit/integration: `Resource Hub's own 12 unit files/398 tests + 7 integration files/168 tests cover it if PD content lives there; no test exercises /api/profile/cpd or /api/profile/documents specifically if it lives in My Profile instead` — **pass (via Resource Hub) / none (via My Profile)** (—)

## Tab / browser proof
Resource Hub has E2E proof (portal.spec.js); there is no dedicated "PD" tab proof under either home.

## Recency
Not touched since the last audit (2026-11-17); zero commits anywhere since 2026-11-14.

## Open tasks (from the tracker)
(no tasks recorded on this card)

## Reason for the label
Whichever home this card actually belongs to, the underlying code is tested — the real gap is that nobody has opened a PD-specific view in a browser and confirmed it, which the tracker's own next_action ("open the PD tab... record a browser check") already asks for. That is a tab/proof gap, not missing code, hence `tab-unproven`.

## Note
This card has no idea/why/strategy text and 0 tasks. Its own next_action already asks whether it should merge into Resource Hub or My Profile rather than stand alone — that decision should be made before chasing more test coverage here.

## Disagreement with the tracker
None — the tracker's own words already match the evidence.
