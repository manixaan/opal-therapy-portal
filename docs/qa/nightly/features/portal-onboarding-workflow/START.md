/opal-critical

## Idea

Portal Onboarding Workflow

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

(none recorded)

## Task notes, verbatim (Stage 1)

"will have the letter of offer as the key requirement so let a rougher in the PDF doc and it
should be editable preview that is exactly the same as the preview version and how the the
dock looks like so for example when you download it when you preview it either as a PDF or as
a document it should all look the same the same way if you want to edit it on the portal
itself you should be able to edit and you should be able to view the exact same copy
additionally there are some buttons where if you click send it allows you to send the email
with the attached document
---
simplify this to high-level concepts"

## Task notes, verbatim (Stage 2)

"Add finish the templated documents and upload to sharepoint as well as protal default
packages under the edit onbaording tab
---
documents in stage 2 need to be finalised and uploaded both to the sharepoint and the portal
( in portal under the default categories inside the edit onbaording). Check the workflow from
stage 1 to 2 if the buttons all work. Should be able to preview, edit (when applicaple),
download, replace, remove etc so make sure all buttons in the UI work. Also simplify UI where
necessary
---
I want to add to this for the actual employee contract and stage two it's currently is just a
default junior occupational therapy kind of workflow so I want this document to be also quite
dynamic similar to how we've done the LOO letter of offer It needs to dynamic clean read the
letter offer and fill in those categories like renumeration and so forth and as a team we need
to discuss what is fixed a.k.a. what place to all employees and what fields need to be kind of
dynamically adjusted changed to meet the correct applicant That is something that we need to
work on and it needs to be a project on itself so please design some checkpoints for us to
create discuss how the checkpoint should be designed and and make it very user-friendly
---
simplify this to high-level concepts"

## Where it lives today

Stage 1: `backend/onboarding-offer-template.js`, `-offer-docx.js`, `-offer-pdf.js`,
`-offer-letter.js`, `-offer-email.js`. Stage 2: `backend/onboarding-package-docs-routes.js`,
`-pack-routes.js`, `-pack.js`, `-contract-docx.js`, `-catalogue.js` — no SharePoint
integration exists anywhere. Stage 3: nothing.

## Start here

Stage 1's code and tests are solid; the open items are UI work (editable preview matching the
PDF/doc output) rather than missing backend capability — a good next step is to verify
`backend/onboarding-offer-pdf.js` and `-offer-docx.js` render identically from the same
template data, then wire the Send button in `onboarding-employee-routes.js` if it isn't
already. For Stage 2, the SharePoint storage piece needs a real decision first (which
SharePoint API/library, what credentials) before any code — that's a conversation with
Anthony, not a coding task to start blind. Once decided, follow the pattern in
`backend/onboarding-pack.js` for how documents are already stored and extend it.

## Done means

Stage 1: a test proves the preview, PDF and DOCX outputs match, and the Send button sends.
Stage 2: a SharePoint upload integration test passes, following the `onboarding-pack.itest.js`
pattern.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
