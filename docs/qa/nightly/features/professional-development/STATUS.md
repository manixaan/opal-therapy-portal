# Professional Development

Tracker stage: idea · Tracker environment: none
Evidence label: **built-untested**
Addressed since last audit (2026-11-26, commit `f5fc28d` — unchanged, zero new commits tonight): no
Created (any located code): yes

## Located files — two different code paths, easy to conflate

1. **Self-tracked CPD/PD log**: `backend/resource-hub-r2-routes.js` → `/api/rh2/pd` and
   `/api/rh2/cpd`. A therapist logs their own professional-development activity; no owner
   approval step.
2. **Owner-approved CPD** (the one the tracker's own wording is almost certainly about,
   since it shares a next_action with "Employee Personal Page"): `backend/profile-routes.js`
   → the CPD section of the My Profile tab, where a therapist submits credentials/documents
   and an owner approves or rejects them.

These are genuinely different systems that both answer to "CPD" in the UI. Whoever next picks
up this card should decide which one it means before doing more work on it.

## Guard check

`resource-hub-r2-routes.js`: router-level `requireAuth` + inline `requireApprover`/`canAuthor`
checks — fine, not a defect. `profile-routes.js`: router-level `requireAuth` + inline
`canApprove(user) => user.role === 'owner'` for the approve/reject actions — correctly
owner-gated, documented as an explicit 2026-08-06 RBAC decision (admin excluded from
approvals).

## Tests

- Self-tracked CPD/PD (`resource-hub-r2-routes.js`): unit coverage inside the 12-file
  `resource-*.test.js` run (**12/12 suites, 398 passed**); integration coverage in
  `resource-hub-r2.itest.js`, part of the 9-file shared batch (**9/9 suites, 232/232
  passed**) — this file specifically exercises CPD/PD create/patch/delete, role checks and
  cross-user isolation.
- Owner-approved CPD (`profile-routes.js`): guard-only unit coverage via
  `onboarding-security.test.js` (asserts the route is guarded, nothing functional). **No
  integration test anywhere calls `/api/profile/cpd/:id/approve` or `/reject`** — confirmed by
  grepping every integration test file for `/api/profile`.
- No tab/E2E/browser-QA proof exists specifically for either CPD surface. Browser QA row I
  ("Leave/CPD/documents", 2026-08-01) only confirms the profile sections *render*, not that an
  approval round-trips.

## Open tasks (from tracker)

None recorded directly on this card, but the tracker's own `next_action` is still open:
"Decide whether this card merges into Employee Personal Page, then add an integration test for
the CPD approval round trip."

## Commits since last audit (2026-11-26)

None — `origin/develop` is unchanged at `f5fc28d`.

## Note on the evidence label

Every prior night's audit on this card reads its real identity as the owner-approved CPD
workflow in `profile-routes.js` (not the separate, already-proven RH2 self-tracked log),
treating it as the same code and the same gap as "Employee Personal Page." Classified
**built-untested** on that same basis, for consistency — the located code is guarded, but the
approval round trip it's actually about has zero functional test coverage.

## Disagreement

None on stage. The real issue is a structural one the team should resolve: this card and
"Employee Personal Page" point at the same untested gap (the CPD approval round trip in
`profile-routes.js`). Recommend merging the cards or explicitly re-scoping this one to the
self-tracked RH2 log, which is already fully proven.
