/opal-critical

**Idea:** Portal Onboarding Workflow

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

**Decisions:** (none recorded on the feature; see task-level notes below)

Task notes quoted verbatim from the tracker (Stage 1): "will have the letter of
offer as the key requirement so let a rougher in the PDF doc and it should be
editable preview that is exactly the same as the preview version... when you
download it when you preview it either as a PDF or as a document it should
all look the same... if you want to edit it on the portal itself you should be
able to edit and you should be able to view the exact same copy... there are
some buttons where if you click send it allows you to send the email with the
attached document"

Task notes quoted verbatim (Stage 2): "documents in stage 2 need to be
finalised and uploaded both to the sharepoint and the portal (in portal under
the default categories inside the edit onbaording)... I want this document to
be also quite dynamic similar to how we've done the LOO letter of offer... as
a team we need to discuss what is fixed... and what fields need to be kind of
dynamically adjusted"

## Where it lives today
`backend/onboarding-journey-routes.js`, `onboarding-offer-*.js`,
`onboarding-contract-docx.js`, `onboarding-package-docs-routes.js`; frontend
`frontend/current/mockup_v3.html` (ONBOARDING TAB) and `onboarding.html` /
`onboarding-journey.js`. Letter of Offer round-trip and the dynamic Contract
of Employment are both built and tested; documents are stored in Postgres,
not SharePoint.

## Start here
1. Open `backend/onboarding-contract-docx.js` and confirm with the team whether
   its existing dynamic-fill behaviour already satisfies the Stage 2 "dynamic
   contract" checklist item — it reads remuneration/pay/super/probation from
   the Letter of Offer today, but the tracker checklist still shows it as open.
2. Get the SharePoint-vs-database decision from the team (the tracker asks for
   SharePoint storage; the code stores documents in the database today).
3. If SharePoint is confirmed, start from `onboarding-journey-db.js`'s document
   storage functions — follow the pattern the Resource Hub uses for its
   SharePoint-style folder presentation in `resource-library-routes.js`.

## Done means
`npx jest tests/onboarding-contract-docx.test.js tests/onboarding-journey.test.js`
and the integration file `tests/integration/onboarding-journey.itest.js` keep
passing after the storage decision is implemented, and a browser/E2E check
walks the admin Edit Onboarding tab (not just the employee wizard) so this can
move to `proven`.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
