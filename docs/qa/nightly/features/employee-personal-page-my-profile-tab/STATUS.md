# Employee Personal Page (My Profile Tab)

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **built-untested**
- Addressed in change window (2026-11-13 to 2026-11-14): no
- Created at all: yes

## Located files

- Route: `backend/profile-routes.js` (leave requests, CPD activities, PD
  documents, credentials)
- Frontend: `frontend/current/profile.js`; `PROFILE TAB` banner in
  `mockup_v3.html` (line ~4350), nav button `data-tab="profile"` labelled
  "My Profile"
- Tests exercising it (no file is named for `profile-routes.js` itself):
  `tests/integration/readonly-and-hardening.itest.js` (uploads/downloads via
  `/api/profile/documents`), `tests/onboarding-security.test.js` (one
  path-string assertion only, not a functional test)

## Guard check

`requireAuth` on every route, plus an inline `canApprove(user)` /
`canViewAll(user)` check (`user?.role === 'owner'`) on the
leave/CPD approve-reject and all-org-view endpoints. No missing guard.

## Tests run

- Integration (`readonly-and-hardening.itest.js`, full file — the only
  suite that exercises this route file at all): **4 passed, 1 failed.**
  Failing subtest: "D-7: unwritable storage → 5xx and the metadata row is
  rolled back" — it `chmod`s the storage directory to `0o000` to simulate a
  write failure, then expects the upload to answer `>=500`. It got a
  success instead. **Cause: this sandbox runs as `root`** (`whoami` →
  `root`), and `chmod 0o000` does not block a root process from writing —
  the simulated failure never actually happens here, so the 500-path in
  `profile-routes.js` is never exercised. This is a known, recurring
  sandbox limitation of this specific test, not a code defect — prior
  nightly audits (2026-11-09 through 2026-11-13, per
  `docs/qa/nightly/features/employee-personal-page-my-profile-tab/
  STATUS.md` on `claude/nightly-audit`) hit the identical failure for the
  identical reason every night this audit has run in this container, and
  explicitly did not classify the feature `broken` on that basis. This
  audit follows that established precedent rather than flagging a new
  `broken` finding for an unchanged, already-understood limitation. The
  other four subtests in the same file (D-6 404 on a deleted storage
  object, read-only blocked from documents, owner isolation across users,
  credential-verify 404) all passed.
- `/api/profile/cpd` (GET/POST/approve/reject): **no test exercises this at
  all** — searched every unit and integration test file for the literal
  string, zero matches.
- `/api/profile/leave`: only one path-string assertion
  (`onboarding-security.test.js`), not a functional test of the
  approve/reject flow.

## Recency

Not touched in the change window (since the 2026-11-13 audit).

## Classify

`built-untested`. Code located and guarded; the routes and tab exist and
render (per `docs/qa/BROWSER_QA_RESULTS.md` row I), but the thing this
feature's own task specifically asks someone to verify — leave and CPD
approval working end to end between therapist and owner — has no real
test coverage. The one failing subtest (D-7 above) is a known sandbox
artifact, consistently reproduced and explained across many prior nights,
not treated as a fresh `broken` finding.

## Open tasks (from tracker)

- Review Portal Structure — todo. Task text: "This is a hands-on testing
  job... You will also test the parts that connect to the owner portal,
  like leave and professional development approval, to confirm both sides
  talk..." — this is exactly the gap found above.

## Commits in the window touching this

None.

## Disagreement

Tracker stage `idea`. Evidence: the tab and its backend exist, are
guarded, and render in a real browser, but the specific thing the human
task asks someone to verify (leave/CPD approval working end to end) is
untested. Unchanged from prior nights.
