/opal-critical

## Idea
Report Templates

## Why
(not yet written in the tracker)

## Who uses it
(not yet written in the tracker)

## What they see
(not yet written in the tracker)

## What should happen
(not yet written in the tracker)

## Outcome
(not yet written in the tracker)

## Decisions
(none recorded in the tracker)

## Where it lives today
`backend/fca-routes.js` + `backend/fca/` (FCA), `backend/letter-routes.js` (Progress Letter),
`backend/templates-routes.js` + `backend/templates/appendices.js` (Service Agreement — the
codebase's name for "Client Agreement Form" — plus the new PDF/WHODAS appendix feature).
All guarded, unit- and integration-tested (563 + 120 tests green tonight).

## Start here
Two things, in order:
1. This is `/opal-critical` because it touched clinical document content and physical
   layout (fonts, margins, header/footer, logo placement) across 15 commits, and three of
   those (`05b4376`, `c09883c`, `c4f124b`) changed the binary Word master with zero test
   coverage of the result. Before trusting the visual output, open one generated FCA in
   Word and confirm: logo sits correctly in the header band, footer table doesn't overrun
   the header's text column, and body/heading/table font sizes look like the intended
   Anti-Bribery-and-Corruption Standard sizing — none of this is asserted by any test.
2. Then walk through generating one FCA (with an appendix), one progress letter, and one
   Service Agreement end to end in a browser as a therapist (overlays `#fca-root`,
   `#letter-root`, from Case Notes / Templates in `mockup_v3.html`). Record it as a new
   `docs/qa/BROWSER_QA_RESULTS.md` entry or a Playwright spec under `e2e/tests/`.

## Done means
A human or automated visual check confirming the three untested geometry commits render
correctly, plus either a new `e2e/tests/*.spec.js` or a fresh dated
`docs/qa/BROWSER_QA_RESULTS.md` entry covering one of the three wizards. Evidence label
should then reach `proven`.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
