Proven for Stage 1 and Stage 2. `tests/onboarding-offer-docx.test.js`,
`onboarding-offer-pdf.test.js`, `onboarding-offer-template.test.js` and
`onboarding-contract-docx.test.js` (unit) plus the 8 onboarding
`*.itest.js` integration files (208 tests, clean run) all pass, and
`docs/qa/BROWSER_QA_RESULTS.md` flow C is live browser proof the onboarding
chain renders and persists state correctly.

Stage 3 has no recorded scope in the tracker — nothing to verify yet. The
"Edit Onboarding" default-package view is deliberately limited to one
package (`PKG_OT_FULL_TIME`) today; see STATUS.md.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
