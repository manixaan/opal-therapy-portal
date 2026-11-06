/opal-feature

**Idea**
Report Templates

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

No decisions recorded in the tracker. Three build tasks exist — "FCA",
"Progress Letter", "Client Agreement Form" — all `todo`, none with their own
idea/why/notes text.

## Where it lives today
FCA: `backend/fca-routes.js` + `backend/fca/`, `frontend/current/fca.js`
(overlay from the Book flow, not a tab). Progress Letter: `backend/letter-routes.js`,
`frontend/current/letter.js`. Client Agreement Form: served by the generic Templates
engine — `backend/templates-routes.js` → `backend/templates/catalogue.js`
(`id: 'service_agreement'`) → `backend/templates/service-agreement-map.js` → master
`backend/service-agreements/templates/service-agreement-v2.2.docx`, with
`frontend/current/templates.js` as the editor/preview. All three are guarded and pass
every test tonight (257 + 41 for FCA, 159 + 55 for Progress Letter, 153 + 24 for
Templates/Service Agreement). Note: `CLAUDE.md`'s repository map names a
`backend/service-agreement-routes.js` that does not exist — the real file is
`templates-routes.js`.

## Start here
All three wizards are built, guarded and tested — the only gap is a browser proof.
Add a Playwright spec under `e2e/tests/` (there is no existing pattern to copy; this
would be the first one covering a clinical document wizard) that logs in as a
therapist, opens the Book flow, generates an FCA and a Progress Letter, downloads
both, then as owner opens Templates and completes a Service Agreement document from
the `service_agreement` template through to download.

## Done means
An E2E spec or `docs/qa/BROWSER_QA_RESULTS.md` row that completes all three end to
end → moves this feature to `proven`.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
