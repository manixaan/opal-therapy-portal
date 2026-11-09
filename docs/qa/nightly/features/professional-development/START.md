/opal-feature

**Idea:** Professional Development
**Why:** (not yet written in the tracker)
**Who uses it:** (not yet written in the tracker)
**What they see:** (not yet written in the tracker)
**What should happen:** (not yet written in the tracker)
**Outcome:** (not yet written in the tracker)
(No recorded decisions.)

## Where it lives today

Ambiguous — two candidates, see `STATUS.md` for the full reasoning:
1. The Resource Hub's own "Professional development" catalogue page (`frontend/current/resourcehub.js`, guarded, 46 passing tests, no browser proof it opens).
2. The Profile tab's CPD section (`backend/profile-routes.js` lines 204-320) — likely the same thing "Employee Personal Page (My Profile Tab)" already covers.

## Start here

First, in the Development Manager, clarify which of the two above this card means (or merge it with "Employee Personal Page" if it's (2)). If it's (1): add a Playwright or manual QA step that opens Resource Hub → Professional development and confirms the list renders and a filter works — copy the login/navigation pattern from `e2e/tests/portal.spec.js`'s Resource Hub test. If it's (2): see `docs/qa/nightly/features/employee-personal-page-my-profile-tab/START.md` instead — don't duplicate that work here.

## Done means

For reading (1): a Playwright spec or `docs/qa/BROWSER_QA_RESULTS.md` entry proving the Professional Development catalogue page renders in a browser → evidence label `proven`.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
