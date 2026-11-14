Proven, with one flagged gap. `tests/booking-rules.test.js`,
`tests/scheduler-matrix.test.js` and the other 17 unit test files (533
total) plus `tests/integration/splose-connection.itest.js`,
`scheduler-availability.itest.js` and the other 7 integration files (83
total) all pass, and `docs/qa/BROWSER_QA_RESULTS.md` rows D/E/F are live
browser proof of the Outlook connection state, Calendar shell and Splose
boundaries.

Flagged gap: the Travel block booking type has no real-browser proof —
only unit/jsdom tests. The task's own ask for a live real-world stress
test against real Splose/Outlook accounts also remains open; see
STATUS.md.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
