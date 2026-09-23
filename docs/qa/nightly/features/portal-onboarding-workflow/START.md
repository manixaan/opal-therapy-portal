/opal-critical

**Idea**
Portal Onboarding Workflow

**Why** / **Who uses it** / **What they see** / **What should happen** / **Outcome**
(not yet written in the tracker at the feature level — see task notes below)

No feature-level decisions recorded. Stage 2's own checklist item, quoted verbatim, is the
remaining biggest gap now that the dynamic contract is built:

"Finalise the onboarding documents and store them in SharePoint" — from Stage 2's notes: "documents
in stage 2 need to be finalised and uploaded both to the sharepoint and the portal (in portal under
the default categories inside the edit onbaording)."

## Where it lives today

**Update (2026-09-22): the dynamic Contract of Employment is now built.** `7e3f921` and `28ab180`
(landed 2026-09-22) implement exactly what this file previously asked a human/Claude session to
decide and build — `backend/onboarding-contract-docx.js` composes the Contract of Employment from
the same offer terms (`offerDocx.buildScalars`) the Letter of Offer already uses, and
`backend/onboarding-document-reader.js` reads the composed contract back on return. 102 new unit
tests (`onboarding-contract-docx.test.js`) plus integration coverage in `onboarding-pack.itest.js`
pass. See STATUS.md for full detail. That closes this file's previous "Start here."

What's still not built: **SharePoint storage**. `grep -rn sharepoint backend/*.js -i` finds only a
CSP allowlist entry (`backend/server.js:408`, unrelated to this feature — it's for the Opal Assist
Office add-in). No upload/storage dependency or code exists anywhere. Documents currently persist in
Postgres via `onboarding-catalogue.js` / `onboarding-pack.js` / `onboarding-pack-routes.js`. Stage
1's "Send button" is also still an Outlook draft, not a real send (`graphMail.createDraft(...)` in
`onboarding-journey-routes.js:1004` and two other call sites) — confirmed intentional/QA'd, but worth
a fresh decision now that Stage 2 has moved forward.

## Start here

This needs a team decision before code, same as the contract did: is SharePoint storage still wanted
at all, given documents already persist reliably in Postgres today? If yes, the smallest next step is
picking a Microsoft Graph SharePoint library/site to write to (the codebase already has a working
Graph integration pattern for Outlook — `backend/outlook-oauth.js` — to copy the auth approach from),
then a new `onboarding-sharepoint.js` that uploads a finished pack item alongside its existing
Postgres write, not instead of it. Separately, ask Anthony whether the Outlook-draft "Send" is still
the wanted design for Stage 1, now that Stage 2 has closed its own big gap.

## Done means

For SharePoint: an integration test proving a finished onboarding document lands in the chosen
SharePoint location, alongside its existing portal storage — plus the "still wanted?" decision
recorded back in the tracker first. For Stage 1 Send: a decision recorded in the tracker on whether
Outlook-draft-then-manual-send is the final design, or whether a real send path is still wanted.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
