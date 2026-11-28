# Nightly tracker audit — 2026-11-28

## 1. Status line

**RAN** · 2026-11-28 18:10–19:30 UTC · commit audited: `d8c861c` (tip of
`origin/develop`) — 14 commits landed since the last audit (2026-11-26, commit
`f5fc28d`; the 2026-11-27 audit saw the same `f5fc28d`, nothing having landed
between those two nights).

**13 features reviewed.** Proven: **1** · Needs refinement: **4** · Built but
untested: **3** · Tab/page unproven: **3** · Untouched (nothing to build in
the portal): **2** · Broken: **0**.

## 2. Do this first

1. **Employee Personal Page (My Profile Tab)** — the leave and CPD
   owner-approval round trip has **no automated test anywhere**, confirmed
   again tonight by grepping every test file in the repo. Employment-sensitive
   data; unchanged for many nights running.
2. **"Opal Assist" still has no tracker card, and it grew again tonight.**
   5 more `feat(assist)` commits landed (Outlook drafts, plan reviews, a
   report builder, notes-owing, scanned-PDF OCR) on top of what was already
   flagged on prior nights. It is well built — guarded, routed through the AI
   gateway (`opal_assist` policy), with 14 unit test files + 1 integration
   file — but there is still no card for it in the 13-feature Development
   Manager tracker. Done means: a human decision on whether it gets one.
3. **Xero Integration Works** — every test passes, but only against a mocked
   Xero client. A real Xero sandbox connection has still never been confirmed
   live, in a browser, with a real account. 4 new `feat(invoicing)` commits
   landed tonight, all on the portal side (block-review attention list, ABN
   default, Fix/Dismiss list, edit-in-place) — none touch the actual
   connection question.
4. **Professional Development** — shares Employee Personal Page's exact gap
   (the CPD owner-approval round trip), but as a separate card with no
   idea/why/who text of its own. Recommend merging it into Employee Personal
   Page, or giving it a real description if it means something else (the
   Resource-Hub PD catalogue, which is already fully tested, is the other
   candidate).
5. **Interactive Assessments** — WHODAS 2.0 is fully built and heavily tested
   (484 unit + 81 integration tests), but nobody has opened the Assessment
   surface as a therapist with a real client and confirmed it renders and
   works.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Why | Tests run |
|---|---|---|---|---|
| Employee Personal Page (My Profile Tab) | idea | built-untested | Guarded and partly tested; the leave/CPD approval round trip has zero test coverage | unit 404/404 (guard-only), int 42/42 + 4/5* |
| Professional Development | idea | built-untested | Shares Employee Personal Page's code and its untested CPD-approval round trip | unit 398/410 (shared) + 46/46, int 232/232 (shared) |
| Automated Reminders | idea | built-untested | Client reminders: zero code anywhere. Snapshot: real, working code (minimise animation verified wired) with no dedicated test | unit: none dedicated, int 9/9 |
| Xero Integration Works | idea | tab-unproven | Heavily tested against a mocked Xero client; real sandbox connection never confirmed live | unit 128/128, int 96/96 |
| Report Templates | idea | tab-unproven | All 3 document types generate correctly under test; no hand-check of a downloaded file | unit 626/626, int 123/123 |
| Interactive Assessments | idea | tab-unproven | WHODAS 2.0 fully tested; nothing proves it renders for a therapist with a real client | unit 484/484, int 81/81 |
| Inductions | idea | needs-refinement | Learner side E2E-proven (`tutorials.spec.js`); owner-side builder/AI-helper checklist almost entirely open | unit 271/271, int 68/68 |
| Portal Onboarding Workflow | idea | needs-refinement | Stage 1 solid; Stage 2's SharePoint storage and dynamic contract confirmed still missing; Stage 3 empty | unit 653/654* , int 216/216 |
| Portal - Splose - Outlook Integration Works | idea | needs-refinement | Code+tests+browser proof solid; "Multi Calendar Rules" human stress-test checklist still open | unit 480/480, int 101/101 |
| Opa Mobile Companion | idea | needs-refinement | API fully tested; Case Noting task still open and the required device walkthrough hasn't happened | unit 170/170, int 34/34 |
| Clinical resources | idea | **proven** | Guarded, fully tested, real E2E + browser-QA proof, no open task | unit 398/410 (12 skipped), int 168/168 |
| Update Opal Docs Register | idea | untouched | Explicitly an Excel/SharePoint task, correctly has no code | none applicable |
| Password Master Document | idea | untouched | Explicitly a OneDrive document task, correctly has no code | none applicable |

\* Employee Personal Page's integration figure: `credential-scans`+`documents` (25) +
`audit`+`stage2-pilot-readiness` (17) = 42, plus `readonly-and-hardening.itest.js`
(4 passed, 1 failed — a root/chmod sandbox artifact re-confirmed tonight, not a
code defect).
\*\* Portal Onboarding Workflow's one unit failure (`onboarding-document-reader.test.js`)
is a missing OCR language-data package in this sandbox, not a code defect.

Nothing failed tonight except the two confirmed sandbox-only artifacts noted
above (OCR package, root/chmod permissions) — both independently re-run and
re-confirmed, not carried forward from a prior night's note.

## 4. Prompts for the morning

**1 — /opal-feature**
> Add an integration test (follow `tests/integration/stage2-pilot-readiness.itest.js`)
> that: a therapist submits a leave request, the owner approves it via
> `PATCH /api/profile/leave/:id/approve`, and the therapist sees the updated
> status — then repeat for reject, and for `/api/profile/cpd/:id/approve|reject`.
> Files: `backend/profile-routes.js`, `frontend/current/profile.js`.

**2 — /opal-feature** (not a build prompt — a decision)
> Decide whether "Opal Assist" (`backend/assist-routes.js`,
> `frontend/current/assist*.js`) gets its own tracker card. It is a real,
> growing, well-governed AI feature (practice-wide chat, Outlook drafts, plan
> reviews, report builder, notes-owing, scanned-PDF OCR) with zero
> representation in the 13-feature tracker.

**3 — /opal-critical**
> Get a Xero developer sandbox app, wire its credentials in per
> `backend/xero-api.js`'s top-of-file comment, sign in as the owner on
> staging, and open the Accounting tab. Confirm in
> `docs/qa/BROWSER_QA_RESULTS.md` that the connection flips to true against a
> real sandbox — every test today mocks this. Files:
> `backend/accounting-routes.js`, `backend/xero-api.js`,
> `backend/xero-payroll-*.js`.

**4 — /opal-fast-change** (not a build prompt — a decision)
> Clarify what the "Professional Development" tracker card means: the
> Resource-Hub PD catalogue (`backend/resource-hub-r2-routes.js`
> `/api/rh2/pd`, `/api/rh2/cpd` — already fully tested) or the owner-approved
> CPD workflow in `backend/profile-routes.js` (shares Employee Personal
> Page's untested gap). Either merge the cards or give this one its own real
> idea/why/who.

**5 — /opal-feature**
> Sign in as a therapist on staging, open a real client's profile, confirm
> `ENABLE_WHODAS_ASSESSMENT` is on, and complete one full WHODAS 2.0
> assessment end to end. Record it in `docs/qa/BROWSER_QA_RESULTS.md`. Files:
> `backend/whodas-routes.js`, `frontend/current/whodas.js`.

## 5. Ideas without a start

No feature folder newly appeared tonight — all 13 already existed from prior
nights. None needed a materially different starter prompt either: every
`START.md` was re-checked against tonight's independently-run tests and found
still accurate, with only small test-count refreshes (noted inline in each
`STATUS.md` as "*Reconfirmed 2026-11-28*"). The one correction worth calling
out: this audit's own first pass tonight mistakenly folded `backend/opa-routes.js`
(the general "Opa" chat pebble on the desktop web shell) into "Opa Mobile
Companion"'s evidence. That file is unrelated to the mobile app's case-noting
or calendar view — it is itself an uncarded feature, in the same boat as
"Opal Assist" (see §2). The correction is recorded in
`docs/qa/nightly/features/opa-mobile-companion/STATUS.md` rather than left
standing.

## 6. What changed since last audit

14 commits landed since the last audit (2026-11-26, commit `f5fc28d`):

- **Invoicing** — 4 commits, all `feat(invoicing)`: `d8c861c` (block-review
  waits → Needs attention list), `1445bc7` (practice ABN default on every
  invoice), `0a17228` (Fix/Dismiss attention list, full-width invoice,
  Xero-driven status), `4e542d9` (edit invoices in place, quick fixes, every
  billable block, background drafts). Maps to **Xero Integration Works** —
  see that card; none of these touch the actual Xero-connection question.
- **Calendar** — 5 commits (`e63caf7`, `e894904`, `c9347ee`, `153ca6b`,
  `19fb9a1`): travel-leg wording/wrapping fixes, a two-finger-click to close
  side panels, and pinch-zoom density. This is the Calendar/Book tab's UI,
  which **has no tracker card of its own** — the travel/sync portion is
  covered indirectly by "Portal - Splose - Outlook Integration Works," but
  the tab's general UI and the shared booking engine in `routes.js` are not
  represented on the tracker.
- **Opal Assist** — 5 commits, all `feat(assist)`: scanned-PDF OCR, an
  Outlook-draft save (never auto-sent), plan reviews (plans ending soon,
  funding used), a report builder (progress reports/support letters from case
  notes, cited), and a notes-owing writer. **Still no tracker card** — see
  §2.

No commits this window touched: Report Templates, Interactive Assessments,
Employee Personal Page, Professional Development, Inductions, Clinical
Resources, Portal Onboarding Workflow, Portal - Splose - Outlook Integration
Works, or Opa Mobile Companion's located files. Everything reported "no new
commits" above was independently re-verified against the current code and
tests tonight regardless — none of it was carried forward unchecked from a
prior night's write-up.

## 7. Technical detail

**Setup.** PostgreSQL was down at the start of the run (`service postgresql
start` brought it up — password `audit`, as the environment's setup script
configured). `backend/node_modules/.bin/jest` existed already; `npm ci`/`npm
install` were never run. Tracker snapshot fetched with
`NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node
../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json` → 13 features,
19 tasks.

**Commands run** (all from `backend/`, targeted only — no complete suite;
today is Saturday, so no weekly deep run): `node --check <file>` on every
located route file (all clean); `npx jest tests/<files>.test.js` per feature
group; `DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config
jest.integration.config.js tests/integration/<files>.itest.js --runInBand`
per feature group, run serially (never two integration batches in parallel,
to avoid two processes truncating the same shared database at once).

**A correction to this process, recorded plainly:** this audit's bootstrap
checked `docs/qa/nightly/` only on a fresh checkout of `origin/develop`,
which never carries these files (they live only on `claude/nightly-audit`,
which is never merged back). That directory was empty there, so this audit's
first pass wrongly treated tonight as a first-ever run and used a 14-day
window. Before delivering, it checked the actual `claude/nightly-audit`
branch and found 13 prior nights of real history (2026-11-15 through
2026-11-27, including a same-branch correction commit) — not a first run at
all. The window was corrected to "since the last audit" (2026-11-26, commit
`f5fc28d`) before this brief was finalised, and the delivery step was changed
from a history-discarding force-push to a normal merge-forward push (§ see
the commit this brief ships in). The per-feature technical findings
(locate/guard/test results) were unaffected by this error — they were run
fresh tonight either way — only the window framing and the "addressed this
window" flags needed correcting, which is reflected in every feature's
`STATUS.md`.

**Not located / open questions:**
- **Professional Development** has no idea/why/who text and is ambiguous
  between the Resource-Hub PD catalogue and the CPD approval workflow already
  tracked under Employee Personal Page. Needs a human decision before any
  code work.
- **Multi Calendar Rules**, **Case Noting**, and **Review Portal Structure**
  tasks all explicitly ask for a human to stress-test or walk through a live
  workflow — none of that can be replaced by a test, and none of it was
  attempted tonight.
- A WARN during the onboarding-payroll-xero integration run:
  `ONBOARDING_ENCRYPTION_KEY is not set — falling back to
  TOKEN_ENCRYPTION_KEY ... rotating the OAuth token key would otherwise make
  every stored tax and bank value permanently unreadable.` This is this
  sandbox's configuration, not evidence about the real environment — but
  worth a human check that production has its own dedicated key.
- The Resource Hub integration run logged two transient WARNs from the async
  preview worker (a foreign-key violation and a deadlock) while all 168 tests
  still passed — looks like an intentionally-exercised failure path, not a
  defect, but worth a glance if it recurs outside tests.
- `backend/routes.js` is a 3000+ line legacy catch-all. It was not audited
  route-by-route tonight (disproportionate for a targeted check); the shared
  booking engine (`createBookingCore`) was spot-checked and is soundly
  guarded.
- No local server or browser was started tonight to visually confirm anything
  (e.g. the Snapshot panel's `reportPanelGenie` minimise animation) — doing
  so risks outbound calls at boot to Azure/Splose/Xero/Outlook, which this
  audit's hard limits forbid touching, and a one-off visual check is
  disproportionate for a nightly run. Static-code verification that the
  function is correctly wired into open/close handlers was done and is
  reported as such; nothing beyond that was claimed.

**Tracker write-back:** ran twice tonight — once with the mistaken
"first-run" framing, then again with the corrected window and the four
relabelled features, before the git push. The script always refreshes each
feature's `claude_update`/`next_action` on every run
(`post-tracker: 0 features posted, 13 already posted tonight, brief posted`
on the second, corrected run — every feature card now carries the corrected
text), but its per-night idempotence guard means the one workspace-level
activity-feed summary row for tonight still carries the first, uncorrected
wording, since that row was already written before the correction was found.
This is a known limitation of the script's one-row-per-night design, not
something this audit worked around with a hand-crafted API call — the
13 feature cards themselves, which is what the team actually looks at, are
correct.
