# Professional Development

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement** (ambiguity in what the card refers to,
  not an engineering gap in the code that exists)
- Addressed this window: no (no commits since 2026-09-27)
- Created at all: yes, but as two separate, non-obviously-related
  implementations

## Located files — two genuinely separate PD/CPD implementations exist

- (a) My Profile's CPD (AHPRA-linked, owner-approved):
  `backend/profile-routes.js` `/api/profile/cpd*` (same file as Employee
  Personal Page). No tab of its own — lives inside the PROFILE TAB.
- (b) Resource Hub R2's CPD tracker (self-scoped, informational only):
  `backend/resource-hub-r2-routes.js:2273-2365` `/api/rh2/cpd*` +
  `/api/rh2/cpd/summary` — explicit comment: "This tracker is informational
  only. Responsibility for meeting the Occupational Therapy Board of
  Australia CPD registration standard remains with the practitioner." Lives
  inside the RESOURCES TAB's "Professional development" sub-menu.
- No standalone "Professional Development" tab/page exists anywhere in
  `mockup_v3.html`'s tab banners — confirmed by grep; it only ever appears
  as a sub-section label inside PROFILE TAB or the Resource Hub.
- `learning-routes.js` / `learning-content.js` / `induction-assistant-routes.js`
  were grepped for "professional development"/"CPD" — **zero hits**. The
  Learning/induction modules are a separate subsystem (onboarding/compliance
  training) and do not implement CPD.
- Tests: (b) `tests/integration/resource-hub-r2.itest.js` — self-scoped
  CRUD + cross-user isolation + summary endpoint, part of the 33/33 passing
  run already executed for Clinical resources. (a) none, per Employee
  Personal Page.

## Guard status

(a) guarded via `requireAuth` + inline `canApprove`/`canViewAll`
(`profile-routes.js`). (b) guarded via `router.use('/api/rh2', requireAuth)`;
`/api/rh2/cpd*` routes are self-scoped to `req.user.id` everywhere →
self-scoped by design, `requireAuth` alone is correct.

## Tests run

(b) already run and passing as part of Clinical resources'
`resource-hub-r2.itest.js` (33/33) — includes explicit cross-user-isolation
assertions for CPD entries and a role-gated read-only-cannot-write check.
(a) no test exists (see Employee Personal Page). No TODO/FIXME found in
either CPD implementation.

## Classification

**needs-refinement**, but for a different reason than "untested" — the
Resource Hub's CPD tracker (b) is itself well-built and well-tested
(proven at the API level). The refinement need is product/tracker
ambiguity, not code: there is no dedicated "Professional Development"
surface, and the tracker card doesn't say whether it means (a), (b), or
both. Additionally neither (a) nor (b) has any e2e/browser-QA coverage —
`docs/qa/BROWSER_QA_RESULTS.md` never mentions CPD or the Resource Hub's
"Professional development" sub-menu by name, and no e2e spec opens it.

## Open tasks from the tracker

None recorded.

## Commits in the window

None.

## Disagreement note

Confirms, and sharpens, the previous `claude_update`. The previous guess
suspected "a well-built, well-tested PD events list and CPD tracker already
exists, but the tracker card is too thin to confirm what the idea means,
and nothing proves it opens in a browser" — confirmed, and the duplication
is now specifically identified: two independent CPD backends exist
(`/api/profile/cpd`, owner-approved/AHPRA; `/api/rh2/cpd`, self-tracked/
informational), not one feature wearing two names. This is worth flagging
back to whoever triages the tracker — this card and Employee Personal Page
may be the same staff request split into two cards, or may genuinely want
both reconciled into one PD surface.
