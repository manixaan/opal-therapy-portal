/opal-feature

**Idea**: Clinical resources

**Why**: (not yet written in the tracker)

**Who uses it**: (not yet written in the tracker)

**What they see**: (not yet written in the tracker)

**What should happen**: (not yet written in the tracker)

**Outcome**: (not yet written in the tracker)

**Decisions**: (none recorded)

**Tracker's next_action**: "Open the Resource Hub Library tab as Owner/Admin and as a therapist,
walk the upload/privacy-override/folder flow, and record what you saw."

## Where it lives today

`backend/resource-library-routes.js`, `backend/resource-privacy-scan.js`,
`frontend/current/resourcelibrary.js`.

## Start here

This is a human walkthrough, not a code task — the backend is well-tested already. Open the
Library tab as each role and exercise: create a nested folder, upload a file that trips the
privacy scan (should offer "Upload anyway" when the only hit is emails/dates/phone numbers per
commit `896ace1`), restore from the recycle bin. Record what breaks, if anything, as a new task
under this tracker card.

## Done means

A recorded walkthrough result (pass or a list of defects) in the tracker, or an added E2E spec
under `e2e/tests/` that exercises the same flow and reaches `proven`.

Tracker: af1cdfa3-7519-401a-8549-0fd812ae62e7
