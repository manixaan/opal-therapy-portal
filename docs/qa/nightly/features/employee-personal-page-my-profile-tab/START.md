/opal-critical (employee leave + employment-adjacent data with an
owner-approval workflow)

**Idea:** Employee Personal Page (My Profile Tab)

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

**Decisions:** (none recorded)

Tracker task notes (quoted verbatim): "I want you to review the portal
structure for my profile TAB in the portal what the features are if they
all the buttons and all the things are operational and use a friendly and I
laid out in a very I pleasing and intuitive way basically test every single
button make sure all the workflows occur this will include the following
personal details work locations leave professional development credentials
professional development documents notifications then there is this set
your work locations for the next 24 hours we're not a reminder and then
basically your name and email address so just those few little details need
to be kind of outlined in terms of whether they are required do that
function as per the intended design and they need to be tested with the
owner portal if there are workflows that have a relationship for example
approving leave approving PD etc" / "rather than listing or doing any
manual documentation this checklist is to operate and verify the operation
of buttons and basically the program so it's for the user to go and do
their due diligence so no note taking is required it's just a matter of
testing and ver[ifying]"

## Where it lives today

`backend/profile-routes.js`, `frontend/current/profile.js`, PROFILE TAB
(`mockup_v3.html:4188-4464`).

## Start here

Add `backend/tests/integration/profile-leave-cpd.itest.js` (new file)
following the pattern in `tests/integration/documents.itest.js` /
`credential-scans.itest.js` (same auth-agent test helpers). Cover: therapist
POSTs `/api/profile/leave` → owner GETs and sees it → owner PATCHes
`/approve` → status flips; therapist cannot self-approve (403 via
`canApprove`); same round trip for `/api/profile/cpd`; a delete-own-draft-only
check for `/api/profile/leave/:id`. Reuse the cross-user 403 pattern already
proven for documents (`readonly-and-hardening.itest.js:56-95`) as the
template.

## Done means

The new integration test passes, covering a full leave and CPD
approve/reject round trip — moving this feature from `needs-refinement` to
`proven` (the separate manual click-through task still needs a human to
tick it off in the tracker).

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
