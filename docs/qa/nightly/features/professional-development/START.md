/opal-feature

The PD/CPD catalogue and log are tested by tests/integration/resource-hub-r2.itest.js (7/7 suites
pass, re-confirmed tonight) but no browser/E2E evidence proves the PD/CPD tab itself renders and
works. This card has no code of its own — it names a slice of the Resource Hub feature (/api/rh2/pd,
/api/rh2/cpd).

## Start here
Open the Resource Hub's PD/CPD tab as a therapist, log a CPD activity and view the PD catalogue, then
record the result in docs/qa/BROWSER_QA_RESULTS.md. Separately, recommend clarifying or merging this
tracker card with Resource Hub or Employee Personal Page, as the tracker's own next_action already
suggests.

## Done means
A docs/qa/BROWSER_QA_RESULTS.md entry (or e2e spec) proves the PD/CPD tab renders and works.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
