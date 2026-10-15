# Nightly tracker audit — 2026-10-15

## 1. Status line

**RAN.** 2026-10-15T18:33Z UTC. Commit audited: `aacf8e6` (branch `develop`).
This is the first-ever run of this audit (no prior dated brief existed), so
the full 13-feature tracker snapshot was reviewed and every feature with
locatable code got the full six-step check, regardless of tracker stage (all
13 are currently stage `idea`).

Counts: **proven** 1 · **needs-refinement** 7 · **tab-unproven** 2 ·
**broken** 1 · **untouched** 2.

## 2. Do this first

1. **[broken]** `GET /api/outlook/categories` returns a raw 500 error
   instead of a clean "not connected" response whenever the signed-in user
   has no Outlook connection — confirmed today at `backend/routes.js:1463-1476`.
   *(Portal - Splose - Outlook | Integration Works)*
2. **[tracker overstated this]** "Clinical resources" was previously marked
   as confirmed in manual browser checks — it isn't. The one browser-QA
   pass of the Resource Hub tested an old, superseded API, not the actual
   clinical classification/review feature people use today. *(Clinical
   resources)*
3. **[tracker overstated this]** The Therapist Snapshot panel was described
   as just needing a browser check — it's missing a real, requested feature:
   there is no "utilisation index" calculation anywhere in the code.
   *(Automated Reminders)*
4. **[tracker is stale the other way]** Two tracker tasks — "Portal
   Inductions" and "Splose Inductions" — are marked not-started, but both
   are already built, access-controlled, and covered by passing tests.
   Worth correcting in the tracker so nobody re-builds them. *(Inductions)*
5. **[never opened in a browser]** The owner-only Finance dashboard (real
   money figures, pulled live from Xero) is fully built and passes all its
   tests, but nobody has ever confirmed it actually renders correctly on
   screen. *(Xero Integration Works)*

## 3. Every feature

| Feature | Tracker stage | Evidence label | One-line reason | Tests run |
|---|---|---|---|---|
| Automated Reminders | idea | needs-refinement | Snapshot panel built & tested but missing its utilisation-index metric; client reminders are fully unbuilt | 47 passed / none (reminders) |
| Clinical resources | idea | proven | Guarded, heavily tested incl. clinical-rationale gating; browser QA only ever covered the legacy API | 271 passed |
| Employee Personal Page (My Profile Tab) | idea | needs-refinement | Documents & credentials proven; leave and CPD approval flows have zero automated tests | 3+ passed (docs) / none (leave, CPD) |
| Inductions | idea | needs-refinement | Core learning system proven; AI co-author built but browser-unproven; two sub-tasks marked "todo" are actually done | 369 passed |
| Interactive Assessments | idea | tab-unproven | WHODAS engine thoroughly tested; nothing proves the assessment page opens in a browser | 789 passed |
| Opa Mobile Companion | idea | needs-refinement | Case Noting backend proven and AI-governed; "Calendar View" has zero code; mobile UI can't be browser-tested from this repo | 418 passed |
| Password Master Document | idea | untouched | Administrative OneDrive task — correctly has no code | n/a |
| Portal Onboarding Workflow | idea | needs-refinement | Stages 1–3 largely proven (tracker checklists are stale); SharePoint document storage is genuinely missing | 514 passed |
| Portal - Splose - Outlook \| Integration Works | idea | **broken** | Core sync/travel-time proven; one confirmed bug in the Outlook categories check | 223 passed, 1 confirmed defect |
| Professional Development | idea | needs-refinement | Two separate CPD systems exist, both untested in a browser; tracker card doesn't say which one this means | 33 passed |
| Report Templates | idea | tab-unproven | FCA, Progress Letter and (likely) the Service Agreement are all built and tested; none has browser proof | 140+ passed |
| Update Opal Docs Register | idea | untouched | Administrative Excel/SharePoint task — correctly has no code | n/a |
| Xero Integration Works | idea | needs-refinement | OAuth + payroll mapping proven (116 tests, exact match to prior claim); dashboard browser-unproven; real Xero sandbox still unverified | 116 passed |

## 4. Prompts for the morning

**1. /opal-critical** — Fix the Outlook "not connected" error. Open
`backend/routes.js` around line 1463 (`GET /api/outlook/categories`). When
the user has no Outlook connection, `getValidAccessToken` (line 150) throws
`'Outlook not connected'`, and the generic catch block turns that into an
HTTP 500. Change it to recognise that specific case (or check
`user.access_token` before calling `getValidAccessToken` at all) and return
`409 { error: 'Outlook not connected', data: [] }` instead — follow the
same 409 pattern already used in `onboarding-journey-routes.js`'s
`graphMail.unavailableReason(req.user)` check (around line 981). Add a unit
test asserting the 409 path. Done when: the new/extended unit test passes.

**2. /opal-critical** — Prove clinical content in a browser. Add a
Playwright case (new or in `e2e/tests/portal.spec.js`) that opens the
Resources tab, calls `/api/rh2/resources` with a clinical population/setting
filter, and walks the clinical-review/attestation approval as owner —
mirror the existing role-based Resource Hub test already in that file.
Done when: the new spec passes.

**3. /opal-feature** — Add the missing Therapist Snapshot metric. Open
`frontend/current/reports.js` (search `_rptDailyRecs`) and
`backend/snapshot-routes.js`. No "utilisation index" formula exists today —
agree it with Anthony first, then implement it and add a focused unit test
for the calculation. Done when: the new unit test passes.

**4. /opal-feature** (tracker housekeeping, no code) — Confirm with
Anthony/Pauly that `backend/learning-routes.js`'s `importExistingInductions()`
(tested by `learning-admin.itest.js`) already satisfies the "Portal
Inductions" and "Splose Inductions" tracker tasks, and mark those two tasks
done in the tracker.

**5. /opal-feature** — Prove the Finance dashboard renders. Add a
Playwright case (or a manual QA pass) that opens the owner-only Finance tab
and confirms the Dashboard/Payroll/Invoicing sub-nav renders real-looking
figures from `/api/finance/dashboard` — the backend already passes 116
tests. Done when: the new spec passes, or a `docs/qa/BROWSER_QA_RESULTS.md`
entry records the manual pass.

## 5. Ideas without a start

This is the first run of this audit, so all 13 feature folders were created
tonight. One line each on why a START.md exists (i.e. why the feature isn't
simply done):

- **Automated Reminders** — client-reminder half is fully unbuilt; Snapshot
  half is missing a requested metric.
- **Employee Personal Page** — leave/CPD approval flows have no automated
  tests.
- **Inductions** — the AI co-author has no browser proof yet.
- **Interactive Assessments** — the assessment page has no browser proof.
- **Opa Mobile Companion** — Calendar View doesn't exist yet; Case Noting's
  manual sign-off is still open.
- **Password Master Document** — not a coding task; needs a person to
  create a OneDrive document.
- **Portal Onboarding Workflow** — SharePoint document storage doesn't
  exist yet.
- **Portal - Splose - Outlook Integration Works** — the confirmed
  `/api/outlook/categories` bug needs fixing.
- **Professional Development** — ambiguous which of two CPD systems the
  card means; needs a product decision.
- **Report Templates** — none of the three document types has browser
  proof.
- **Update Opal Docs Register** — not a coding task; needs a person to
  update an Excel register.
- **Xero Integration Works** — the dashboard has no browser proof; the real
  Xero sandbox is still unverified.

(**Clinical resources** is the only feature at `proven` tonight — its
START.md is the two-line note instead of a starter prompt.)

## 6. What changed since last audit

No commits landed in the audit window. This is the first run of this audit,
so the window defaults to the last 14 days — but the repository's most
recent commit on `backend/` or `frontend/current` is `37f4e057`'s sibling
`aacf8e6` "feat(maps): address suggestions use Place Autocomplete, limited
to WA", dated **2026-09-27**, 18 days before tonight's run. There is
nothing to group by subsystem.

One thing worth flagging while it was fresh in view: several portal tabs
have no corresponding tracker card at all today — Employees, Interview
Preparation, NDIS Cases, Dormant Cases, Travel & Flights, Travel Logbook,
Contacts Directory, Activity Feed, Settings, Support Tickets, Billing
Dashboard, and Auto-fit Multiple Clients. That's not a defect — just a gap
between the tracker and the portal's actual surface area, for whoever
triages the tracker next.

## 7. Technical detail

**Environment.** PostgreSQL was found stopped at the start of this run and
started with `service postgresql start`; `backend/node_modules` was already
installed (per the environment setup script). Tracker snapshot pulled via
`NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node
../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json` — succeeded,
13 features / 19 tasks.

**Verification method.** Four parallel read-only sub-agents each took 2–3
tracker features, re-derived the locate/guard/test/classify evidence
independently (not by trusting the tracker's existing `claude_update`/
`next_action` fields), and ran only targeted `npx jest <file>` /
`--config jest.integration.config.js <file> --runInBand` commands, each
against its own throwaway database (`therapy_scheduler_auditA`..`auditD`
+ `_test`). No complete suite (`npm test`, `npm run test:integration`,
E2E) was run tonight — today is Thursday, not the Sunday deep-run day.
Every test file run tonight passed; the one confirmed defect
(`/api/outlook/categories`) was found by reading the route code directly,
not by a failing test (no test currently covers that path). Full commands
and counts are recorded in each feature's `features/<slug>/STATUS.md`.

**Not located:** no code anywhere for client appointment reminders, mobile
"Calendar View", or SharePoint document storage (onboarding Stage 2).
`backend/onboarding-policies/` and `backend/service-agreement-routes.js` /
`backend/service-agreements/`, both named in CLAUDE.md's repository map, do
not exist on disk — CLAUDE.md's repo map is stale on these two points.

**Open questions for the team:**
- Does "Professional Development" mean the Resource Hub's self-tracked CPD
  tracker, My Profile's AHPRA-approved CPD, or both?
- Is "Client Agreement Form" the same thing as the existing Service
  Agreement template (our inference, not confirmed)?
- What auth model should SharePoint document storage use (Graph app
  registration vs. a service account)?
- What should the Therapist Snapshot's "utilisation index" actually
  calculate?

**Tracker write-back:** `post-tracker: 13 features posted, 0 already posted
tonight, brief posted` — every feature's `claude_update`/`next_action` was
refreshed, a starter-prompt message was posted to each feature's thread
(or the two-line "proven" note for Clinical resources), and one workspace
activity row was added for tonight's run.
