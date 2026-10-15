/opal-critical (clinical data + AI governance + employee-sensitive mobile
data). A pure `maps-routes.js` proxy tweak with no clinical-data touch could
run under /opal-feature.

**Idea:** at the moment we have created a series of little icons in the
mobile application which is now on the testing device noting the other one
is the calendar that someone can see in which case they can access events
and quick look at which opens up the travel and with a click they can
access and navigate via Google Maps to the next destination now the case
noting users artificial Intelligence where it follows a strict clinical
pathway as its dealing with sensitive data. Currently the pilot project is
built. But rigerous testing is required to understand the case noting
summarisation capability and its organisation and linking to the portal
once the user is finished with their case note. The case noting in the app
is designed as a dictation tool.

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

**Decisions:** (none recorded) — note: tracker also says "there will be no
listing of what any sorts it'll just be testing so verifying the operation
so no one will be doing any manual listing or writing down what's
functional functional no note taking it's just testing."

## Where it lives today

Case Noting: `backend/mobile-routes.js`, `backend/case-note-routes.js`,
`backend/clinical-note-provider.js` (governed through `backend/ai/ai-gateway.js`).
Calendar View: nothing yet — only generic building blocks
(`/api/mobile/travel`, `backend/maps-routes.js`).

## Start here

Case Noting: the tracker checklist's engineering items already have
automated coverage; the only open item is the human step ("get Ann's
sign-off" on a real device) — no new engineering is needed first. If Ann's
manual pass surfaces a concrete gap, extend
`case-note-client-link.itest.js` / `case-note-deidentification.itest.js`.
Calendar View: if picked up, start from `backend/mobile-routes.js`'s
existing `/api/mobile/travel` (already returns trips/addresses) and
`backend/maps-routes.js`'s `/api/maps/geocode`/`/place/:placeId` as the
building blocks — the "click to navigate" itself is a client-side deep link
built in the separate mobile repo; there is nothing to change here unless
the mobile app needs a new aggregated field (e.g. a ready-made maps URL)
added to the `/api/mobile/travel` response.

## Done means

Case Noting: Ann completes the sign-off checklist on the test device — this
is a human decision, not a code test. Calendar View: a new endpoint or field
exists and is covered by an integration test, once the mobile team specifies
what they need from this repo.

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
