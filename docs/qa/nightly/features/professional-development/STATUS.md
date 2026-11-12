# Professional Development

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in change window (2026-10-29 to 2026-11-12): marginal — `frontend/current/profile.js` touched (5 lines)
- Created (any code located): yes, but the card is ambiguous about which of two subsystems it means

## Located files

Two candidate subsystems, both real and both tested:

1. **Admin PD-events catalogue + org CPD tracking** — `backend/resource-hub-r2-routes.js` (`/api/rh2/pd`, `/api/rh2/cpd`), UI in `frontend/current/resourcehub.js`.
2. **Employee's own CPD/credentials/documents** (part of "Employee Personal Page") — `backend/profile-routes.js` (`/api/profile/cpd`, `/api/profile/documents`, `/api/profile/credentials`), UI in `frontend/current/profile.js` (~lines 290-650, inside the `PROFILE TAB`).

- Unit tests: `pd-catalogue-guards.test.js`, `credential-surface-guards.test.js`
- Integration tests: `resource-hub-r2.itest.js`, `documents.itest.js`, `credential-scans.itest.js`
- E2E: none for either interpretation.

## Guard check

Clean for both. `resource-hub-r2-routes.js:254` — `requireAuth` + a `hubEnabled()` gate; writes (`POST`/`PATCH`/`DELETE` on `/pd`, `/cpd`) use an inline `canAuthor(req.user)` check (owner/admin only) rather than `requirePermission` middleware — functions as a role guard, not flagged as unguarded, but a style inconsistency worth a note. `profile-routes.js:24` — `requireAuth` on every route; approve-type actions use inline `canApprove()`.

## Tests run

- Unit: 3 suites, 87 tests — **all pass**
- Integration: `resource-hub-r2.itest.js` (part of the 234-test Resource Hub/Learning run — pass), `documents.itest.js` + `credential-scans.itest.js` (part of the 245-test run, 244 passed / 1 failed — the one failure is `readonly-and-hardening.itest.js`'s root-bypasses-chmod artifact, unrelated to PD/CPD specifically; see the brief's Technical detail)

## Open tasks from tracker

None recorded — the card has no `tasks`. But its own `next_action` (pre-filled from an earlier audit run) reads: "Clarify in the tracker which subsystem this card means, or merge it with 'Employee Personal Page' if it means the CPD section." This audit independently reached the same conclusion from the code alone.

## Commits in window touching it

Minimal — a 5-line change to `frontend/current/profile.js`.

## Disagreement

None in the formal sense — the problem isn't that the tracker overclaims, it's that the card's title doesn't specify which of two real, built, tested subsystems it refers to. This matches the classification held for four consecutive nights: under either reading, no browser proof exists that the relevant page actually opens and renders — hence `tab-unproven` rather than `needs-refinement`. The scope ambiguity is a separate, standing note for the team, not what drives tonight's label.
