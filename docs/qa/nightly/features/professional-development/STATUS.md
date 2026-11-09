# Professional Development

Tracker stage: idea · Tracker environment: none
Evidence label: **tab-unproven** (ambiguous card — see note)
Addressed in this change window: **no** · Created: **yes, but which code it means is genuinely ambiguous**

## The ambiguity

This card has no tasks and no idea/why/who-uses-it text beyond the title — nothing to disambiguate it. There are **two separate, unrelated** "professional development" subsystems in this codebase:

1. **Resource Hub's "Professional development" catalogue page** — `frontend/current/resourcehub.js` (its own page, literal label "Professional development", lines ~679-724, 1976-2553), served through `backend/resources-routes.js`'s guards, with its own test file `backend/tests/pd-catalogue-guards.test.js` (**46/46 pass**). This is a browsing/events catalogue, filterable by category including `professional_development`.
2. **The Profile tab's CPD section** — `backend/profile-routes.js` lines 204-320 (`/api/profile/cpd`), card id `pf-nav-cpd` in `frontend/current/mockup_v3.html`'s Profile tab. This is the same code the "Employee Personal Page (My Profile Tab)" card already covers in detail (its task explicitly lists "professional development credentials, professional development documents").

**If this card means (1)**: evidence is **tab-unproven** — built, guarded, 46 tests pass, but no E2E spec or `docs/qa/BROWSER_QA_RESULTS.md` entry proves a user opens the Professional Development catalogue page itself in a browser (entry G covers the Library/folders view, not this page).
**If this card means (2)**: it is a duplicate of "Employee Personal Page (My Profile Tab)" and the evidence is **built-untested** (see that feature's folder — zero test coverage).

Recommend the team clarify which is meant, or merge the cards if (2).

## Tests (for reading 1, the Resource Hub PD catalogue)

- Unit: `backend/tests/pd-catalogue-guards.test.js` — **46/46 pass**.
- No integration or E2E test specific to this page.

## Commits in the window touching this feature

None identified for either reading.

## Disagreement

None (tracker stage is "idea" either way; evidence under reading 1 exceeds that, under reading 2 it does not).
