/opal-critical if the AHPRA-linked My Profile CPD (a) is in scope (employee
compliance data). /opal-feature is sufficient if only adding an e2e spec for
the Resource Hub's self-scoped, non-sensitive tracker (b).

**Idea:** Professional Development

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

**Decisions:** (none recorded)

## Where it lives today

Two places, not one: `backend/profile-routes.js` (`/api/profile/cpd`,
PROFILE TAB) and `backend/resource-hub-r2-routes.js` (`/api/rh2/cpd`,
Resources tab "Professional development" sub-menu).

## Start here

Before any engineering: get tracker clarification on which CPD system
"Professional Development" refers to (or whether it means unifying the
two) — this is a product question for Anthony, not a code gap. If it means
the Resource Hub tracker (b): add an e2e spec step opening the Resources
tab → Professional development sub-menu and asserting the CPD-summary panel
renders — mirror the existing Resource Hub test pattern in
`e2e/tests/portal.spec.js`, targeting `#rh2-root` → PD submenu instead of
`/api/resources`. If it means My Profile's AHPRA CPD (a): it shares
`profile-routes.js` with the Employee Personal Page's leave workflow — the
new integration test proposed in that feature's START.md should cover both;
no separate engineering file is needed here.

## Done means

The tracker clarifies which system this card means, and whichever one it is
gets the missing test/browser coverage described above — then this feature
can be reclassified as `proven` (or merged with Employee Personal Page's
card if it turns out to be a duplicate).

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
