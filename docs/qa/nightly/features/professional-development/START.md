/opal-fast-change

**Idea**
Professional Development

**Why** / **Who uses it** / **What they see** / **What should happen** / **Outcome**
(not yet written in the tracker)

No tasks or decisions recorded for this feature.

## Where it lives today

Split across two other subsystems: `backend/resource-hub-r2-routes.js`
(admin PD events catalogue, `pd_events` table) and `backend/profile-routes.js`
(employee CPD records, `/api/profile/cpd/*`). No dedicated PD subsystem
exists, and the tracker card itself has no tasks written — see STATUS.md.

## Start here

Before writing code: this tracker card is empty (no why/who/outcome, no
tasks). The smallest useful first step is filling in the tracker card
itself with what's actually wanted, since the code already does something
under this name (split across Resource Hub PD events and My Profile CPD)
and it's unclear whether that's the intended scope. If it's about proving
the existing CPD flow works, `docs/qa/BROWSER_QA_RESULTS.md` row I already
flags some CPD/document UI as intentionally stubbed ("Coming soon") in the
current build — check which parts of `profile.js`'s CPD section are real
vs. placeholder before assuming a bug.

## Done means

Not determinable until the tracker card has an actual ask. If the goal is
proving the existing CPD approve/reject flow, a small integration test
alongside `resource-hub-r2.itest.js` exercising `/api/profile/cpd` end to
end would move this toward `proven`.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
