/opal-feature

**Idea**: Portal Onboarding Workflow

**Why**: (not yet written in the tracker)

**Who uses it**: (not yet written in the tracker)

**What they see**: (not yet written in the tracker)

**What should happen**: (not yet written in the tracker)

**Outcome**: (not yet written in the tracker)

**Decisions**: (none recorded)

**Tracker's next_action**: "Decide whether SharePoint upload is still wanted, or accept the
current database-based document storage as the design."

**Stage 1 task notes (verbatim)**: "will have the letter of offer as the key requirement so let a
rougher in the PDF doc and it should be editable preview that is exactly the same as the preview
version and how the the dock looks like so for example when you download it when you preview it
either as a PDF or as a document it should all look the same the same way if you want to edit it
on the portal itself you should be able to edit and you should be able to view the exact same
copy additionally there are some buttons where if you click send it allows you to send the email
with the attached document"

## Where it lives today

`backend/onboarding-pack-routes.js`, `backend/onboarding-defaults-routes.js`,
`backend/onboarding-offer-*.js`, `frontend/current/onboarding.js`.

## Start here

This is mostly a human decision, not a code task: the DB-backed storage (`onboarding-pack-db.js`)
is already built and tested — bring that to the team and either (a) confirm it as the design and
tick the Stage-1/Stage-2 checklist items that are already true in code but still marked `todo`, or
(b) scope a SharePoint-upload addition as a new task. Separately: `tests/onboarding-document-reader.test.js`
fails locally because `@tesseract.js-data/eng` isn't installed — run `npm ls @tesseract.js-data/eng`
in `backend/` to confirm whether this is a missing dependency (add it to `package.json`) or a
genuinely broken OCR path, under `/opal-fast-change` once confirmed.

## Done means

Checklist items in the tracker reflect what the code actually does (editable preview, PDF/doc
download, Send-by-email already pass their tests); `tests/onboarding-document-reader.test.js`
passes once the dependency question is resolved.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
