# Professional Development

Tracker stage: idea · Tracker environment: none
Evidence label: **tab-unproven** (ambiguous card — see note)
Addressed in this change window: **no** · Created: **yes, but which code it means is genuinely ambiguous**

## The ambiguity

This card has no tasks and no idea/why/who-uses-it text beyond the title. There are two separate, unrelated "professional development" subsystems:

1. **Resource Hub's "Professional development" catalogue page** — `frontend/current/resourcehub.js`, served through `backend/resources-routes.js`'s guards, with its own test file `backend/tests/pd-catalogue-guards.test.js`.
2. **The Profile tab's CPD section** — `backend/profile-routes.js` lines 204-320 (`/api/profile/cpd`), already covered in detail by the "Employee Personal Page (My Profile Tab)" card.

**If (1)**: evidence is **tab-unproven** — built, guarded, tests pass, but no browser/E2E proof the catalogue page itself renders.
**If (2)**: duplicate of "Employee Personal Page (My Profile Tab)" — evidence is **built-untested** there (zero test coverage).

Recommend the team clarify which is meant, or merge the cards if (2).

## Tests (for reading 1)

- Unit: `backend/tests/pd-catalogue-guards.test.js` — ran tonight as part of a combined 14-file run with Clinical Resources; **46/46 pass** within that run.
- No integration or E2E test specific to this page — re-confirmed tonight.

## Browser / E2E proof

Re-confirmed tonight: `docs/qa/BROWSER_QA_RESULTS.md` entry G covers the Resource Hub library/folders view generally, not the Professional Development catalogue page specifically. No browser QA entry or E2E test anywhere mentions "Professional Development" by name.

## Commits in the window touching this feature

None for either reading. `develop` moved from `34cf881` to `40669e7` between the 2026-11-09 audit and tonight — one commit, the Travel block booking type (see `portal-splose-outlook-integration-works/STATUS.md`) — which touches neither the Resource Hub PD catalogue nor the Profile tab's CPD section.

## Disagreement

None (tracker stage is "idea" either way; evidence under reading 1 exceeds that, under reading 2 it does not).
