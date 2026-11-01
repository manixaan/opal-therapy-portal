/opal-critical

**Idea:** Portal Onboarding Workflow

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

**Decisions:** (none recorded)

### Stage 1 task (verbatim)
> "will have the letter of offer as the key requirement so let a rougher in the PDF doc and it should be editable preview that is exactly the same as the preview version... additionally there are some buttons where if you click send it allows you to send the email with the attached document"

### Stage 2 task (verbatim, abridged)
> "Add finish the templated documents and upload to sharepoint as well as portal default packages under the edit onboarding tab... I want this document [employee contract] to be also quite dynamic similar to how we've done the LOO letter of offer... that is something that we need to work on and it needs to be a project on itself so please design some checkpoints for us to create"

### stage 3 task
(not yet written in the tracker)

## Where it lives today

Stage 1 is done and tested (`backend/onboarding-offer-*.js`). Stage 2 is mostly done (packages, SharePoint upload, document reader/OCR) except the dynamic employee contract, still the static default template. Stage 3 (release/invitation/induction/activate) landed this window (`backend/onboarding-journey*.js`, `-returns-*.js`).

## Start here

The concrete, scoped next step is the Stage 2 dynamic contract: open `backend/onboarding-contract-docx.js` next to `backend/onboarding-offer-template.js` (the Letter of Offer's working dynamic-fill pattern) and copy that approach — read the published offer letter's fields (remuneration, start date, role) and merge them into the contract template the same way the offer letter merges them today. Add a unit test alongside `tests/onboarding-contract-docx.test.js`'s existing pattern. The team still needs to agree which contract fields are fixed-for-all-employees vs per-applicant before this is finished — flag that as an open decision, don't guess it.

## Done means

A new/updated `onboarding-contract-docx.test.js` case proving the contract pulls dynamic fields from the offer letter → Stage 2 moves from `needs-refinement` toward `proven`.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
