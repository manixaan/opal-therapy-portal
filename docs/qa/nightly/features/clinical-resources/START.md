/opal-feature

**Idea**
Clinical resources

**Why**
(not yet written in the tracker)

**Who uses it**
(not yet written in the tracker)

**What they see**
(not yet written in the tracker)

**What should happen**
(not yet written in the tracker)

**Outcome**
(not yet written in the tracker)

No decisions recorded in the tracker.

## Where it lives today
`backend/resource-library-routes.js` (upload, privacy-override, folders,
mounted at `/api/rh2/library/...`), `backend/resource-file-intake.js`,
`resource-file-quality.js`, `resource-privacy-reasons.js`; frontend
`frontend/current/resourcelibrary.js` (`window.RHLib`) loaded by
`frontend/current/resourcehub.js` under the Resources tab
(`frontend/current/mockup_v3.html:5120`). Fully covered by 390 unit +
168 integration tests tonight — all passing.

## Start here
The gap is purely a browser-proof gap, not a code gap. Open the Resources tab
as an owner or admin, go to the Library, upload a file that trips the privacy
scan (e.g. a document with a bare email or date), work through the checklist,
and click "Upload anyway". Follow the pattern the FCA/letter wizards use for
their own missing browser proof — a Playwright spec under `e2e/tests/`, or a
manual run recorded as a new row in `docs/qa/BROWSER_QA_RESULTS.md`. No backend
or frontend code changes should be needed unless the walkthrough finds a bug.

## Done means
An E2E spec or a `docs/qa/BROWSER_QA_RESULTS.md` row that exercises the
upload → privacy-refusal → "Upload anyway" → folder-placement flow end to
end. That moves the evidence label from `tab-unproven` to `proven`.

Tracker: af1cdfa3-7519-401a-8549-0fd812ae62e7
