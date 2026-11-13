# Professional Development

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in change window (2026-11-12 to 2026-11-13): no — zero commits since the 2026-11-12 audit
- Created (any code located): yes, but the card is ambiguous about which of two subsystems it means

## Located files

Two candidate subsystems, both real and both tested, unchanged:

1. **Admin PD-events catalogue + org CPD tracking** — `backend/resource-hub-r2-routes.js` (`/api/rh2/pd`, `/api/rh2/cpd`), UI in `frontend/current/resourcehub.js`.
2. **Employee's own CPD/credentials/documents** (part of "Employee Personal Page") — `backend/profile-routes.js` (`/api/profile/cpd`, `/api/profile/documents`, `/api/profile/credentials`), UI in `frontend/current/profile.js`.

- Unit tests: `pd-catalogue-guards.test.js`, `credential-surface-guards.test.js`
- Integration tests: `resource-hub-r2.itest.js`, `documents.itest.js`, `credential-scans.itest.js`
- E2E: none for either interpretation.

## Guard check

Re-confirmed tonight, unchanged. `resource-hub-r2-routes.js:254` — `requireAuth` + a `hubEnabled()` gate; writes use an inline `canAuthor(req.user)` check (owner/admin only). `profile-routes.js:24` — `requireAuth` on every route; approve-type actions use inline `canApprove()`.

## Tests run

- Unit: re-run tonight as part of the 23-suite/810-test group — **all pass**
- Integration: re-run tonight — `resource-hub-r2.itest.js` (part of the 234-test Resource Hub/Learning run — pass), `documents.itest.js` + `credential-scans.itest.js` (part of tonight's 239-test run, 238 passed / 1 failed — the one failure is `readonly-and-hardening.itest.js`'s root-bypasses-chmod artifact, unrelated to PD/CPD specifically)

## Open tasks from tracker

None recorded — the card has no `tasks`. Its own `next_action` still reads: "Clarify in the tracker which subsystem this card means, or merge it with 'Employee Personal Page' if it means the CPD section."

## Commits in window touching it

None this window.

## Disagreement

None in the formal sense — unchanged for a fifth consecutive night. The scope ambiguity between the two real subsystems remains a standing note for the team; under either reading, no browser proof exists that the relevant page renders.
