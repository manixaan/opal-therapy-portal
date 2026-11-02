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

Stage 1 is done and tested (`backend/onboarding-offer-*.js`). Stage 2's employee
contract (`backend/onboarding-contract-docx.js`) is **already dynamic** — it
reuses `onboarding-offer-docx.js`'s remuneration, pay-cycle, position,
commencement-date, superannuation and signatory values, landed in commit
`7e3f921` (2026-09-21), and `tests/onboarding-contract-docx.test.js:79` proves
it. (Correcting this repo's own 2026-11-01 brief, which said this was still
static — it was wrong.) Stage 3 (release/invitation/induction/activate) is
also built (`backend/onboarding-journey*.js`, `-returns-*.js`).

## Start here

Do not redo the dynamic-contract work — it's done. The real open Stage 2
items: (1) finalise the onboarding documents and confirm they land in both
SharePoint and the portal's Edit Onboarding default categories — check
`backend/onboarding-pack-routes.js` / `-pack-db.js`; (2) click through every
button in the Stage 1→2 flow in the Onboarding tab (`frontend/current/onboarding.js`)
and fix anything that doesn't work; (3) hold the team decision on which
contract clauses are fixed-for-everyone vs per-applicant (tracker checklist
item `c7-02w9`) and tick it in the tracker once agreed — that's a people
decision, not a code change.

## Done means

For the dynamic-contract item: tick tracker checklist `c5-nyyr` as done (code
already proves it — no new test needed). For the real remaining work: a
browser/E2E check that every Stage 1→2 document button works, and the team's
written fixed-vs-dynamic decision recorded against `c7-02w9`.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
