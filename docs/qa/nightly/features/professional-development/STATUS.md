# Professional Development

- Tracker stage: idea | Tracker environment: none
- Evidence label: **tab-unproven**
- Created: yes — but not as a standalone subsystem (see note)
- Addressed this window: not directly

## Located files
NOT a standalone subsystem. The PD/CPD functionality lives inside resource-hub-r2-routes.js
(/api/rh2/pd, /api/rh2/pd/catalogue, /api/rh2/cpd, /api/rh2/cpd/summary) and
frontend/current/resourcehub.js (PD/CPD tab UI). backend/migrations/029_pd_catalogue.sql documents
this as a human-entered catalogue by design (no provider API/feed/scraper; no booking integration).

## Guard check
router.use('/api/rh2', requireAuth, hubEnabled-check); PD/CPD writes additionally gated by
canAuthor(req.user) role check inline. OK (re-confirmed tonight).

## Tests (re-run fresh tonight)
Covered entirely by tests/integration/resource-hub-r2.itest.js, already run and passing under the
"Clinical resources" feature folder tonight — 7/7 suites, 168/168 tests pass, including the PD/CPD
routes.

## Open tasks (from tracker)
None.

## Commits in window touching this
None.

## Disagreement
This tracker card names no code of its own — it names an existing slice of the Resource Hub feature.
The tracker's own next_action agrees: "Clarify in the tracker which subsystem this card means, or
merge it with Employee Personal Page if it means the CPD section." Reporting only, not changing the
tracker.

## Note
No change from the 2026-11-16 audit. Independently re-verified fresh tonight (separate parallel
audit pass, its own throwaway database) — same code, same tests, same result. Also worth flagging:
the portal now runs two separate CPD systems (`/api/profile/cpd` for leave/CPD approval under
Employee Personal Page, `/api/rh2/cpd` for this card's self-logged CPD tracking) — intentional per
this card's own next_action to decide a merge, not a code defect.
