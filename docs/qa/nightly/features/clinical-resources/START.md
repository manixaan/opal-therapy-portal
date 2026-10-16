Proven. `tests/integration/resource-hub-r2.itest.js` (33 tests) proves the
clinical classification and approval workflow at the API level; guards
and content-browsing are proven in the browser by
`e2e/tests/portal.spec.js` and `docs/qa/BROWSER_QA_RESULTS.md` flow G.
The one open gap — no browser walkthrough of the clinical-review workflow
specifically as owner — is noted in STATUS.md.

Tracker: af1cdfa3-7519-401a-8549-0fd812ae62e7
