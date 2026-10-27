# Portal Onboarding Workflow

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **broken** tonight (escalated from `needs-refinement` — see "New tonight" below; Stage 2's literal SharePoint-storage gap is still genuine on top of this)
- Addressed in change window (since last audit, 2026-10-26 `896ace1`): no — the true window (`896ace1..41f45ed`) holds only Calendar sync-settings/Outlook/Splose commits, none touching any `onboarding-*.js` file. The 2026-10-22 8-commit "onboarding production-ready" push (see "Recent history" below) predates this window.
- Created (code exists): yes for Stage 1 and 2; Stage 3 (induction/setup/Activate) is now substantially built, as of 2026-10-22

## New tonight (2026-10-27) — a test fails, likely a sandbox gap
`npx jest tests/onboarding-document-reader.test.js` fails tonight: "the OCR
language data is shipped with the portal, not fetched when a document
arrives" — `Cannot find module '@tesseract.js-data/eng/package.json'`. This
package is declared in `backend/package.json` (`"@tesseract.js-data/eng":
"^1.0.0"`) but is genuinely absent from this sandbox's `backend/node_modules`
(confirmed: `ls node_modules/@tesseract.js-data/` → no such directory). Ran
twice tonight — reproducible both times, not a flake. **No prior audit
(2026-10-16 through 2026-10-26) ever reported this failure**, which points
to tonight's sandbox provisioning being incomplete rather than a code
regression — this audit's own hard limits forbid running `npm install`/`npm
ci` to fix it. Escalating the whole feature's evidence label to `broken` for
tonight rather than silently absorbing it into the unchanged
`needs-refinement` narrative below, because a concretely reproduced test
failure is stronger evidence than an open product decision — but this
needs a human to confirm whether `@tesseract.js-data/eng` is actually
present in the real (Azure) deployment's `node_modules` before treating it
as a production defect. If it's confirmed present there, this is sandbox
noise and the label should revert to `needs-refinement` next audit.

## Recent history (2026-10-22, two nights ago now)
Eight commits (`fba7eface`, `96324d99`, `f1439654`, `41e81787`, `db8fb6c4`,
`51f585b6`, `73adb13f`, plus merge `273de152`) under the heading "onboarding
production-ready" — none of this changed again tonight; re-verified below
against the same code:
- **`onboarding-account-guard.js` (new)** — fixes a confirmed account-takeover
  bug (audit B-1): an onboarding record could previously adopt an existing
  staff account sharing the applicant's email and later change its role or
  password. Now every account-touching action re-checks, at action time under
  a row lock, that the linked account is still `pre_employee`, in the record's
  organisation, and not claimed by another open onboarding.
- **Stage 2/3 now run through the portal** (`f1439654`) — this is the
  single biggest forward move against the tracker's own Stage 2/3 checklist:
  release, invitation (issue/resend/revoke-on-resend), the induction stage,
  internal setup tasks, and an Activate gate are now a real screen-driven flow,
  not just API plumbing. The old paper-pack-first flow is now an explicit,
  secondary path for records that already use it.
- **Owner-only activation** (`96324d99`) — activation no longer happens
  automatically when documentation/induction completes; only the Owner
  pressing Activate does it. `onboarding-lifecycle.js` gained
  `activationReadiness` (password chosen, offer settled, every blocker
  cleared, statutory checks verified for clinicians, paper-pack returns
  verified, induction done) with named blockers on refusal.
- **Placeholder documents refused everywhere** (`onboarding-placeholder-check.js`,
  new) — a document whose text or file still holds `[TO CONFIRM …]`, a
  `PLACEHOLDER -` stand-in, or a dev stub is refused at release, acknowledgement,
  upload and paper-pack send alike (owner decision 4).
- **The record's own contract / position description** (`onboarding-record-documents.js`,
  new, migration 079) — Owner upload / generate-from-template / preview /
  remove; the starter's acknowledgement records the file's SHA-256. **This is
  a separate, DB-backed document store, not SharePoint** — see the
  disagreement note below.
- **Practice details are now Owner-edited settings** (`onboarding-practice.js`,
  new) — name, ABN, ACN, signatory, return address, default work location and
  default super fund, seeded from the practice's real current details, used
  by the letter, contract, pack emails and the portal's super form instead of
  hard-coded constants.
- **Tiered, audited profile access + validated starter forms** (`db8fb6c4`) —
  choice-field values checked against the database's own lists (400 with the
  field named, not a 500); personal/emergency/identity/vehicle/credential
  numbers need `onboarding.sensitive_identity`, pay needs `onboarding.payroll`;
  every sensitive-tier read is audited (`profile_viewed`).
- **A disagreeing returned document reopens a settled field as a conflict**
  (`51f585b6`, audit B-6) unless the Owner already resolved it.
- **Account-takeover and temporary-password hardening** (`fba7eface`) — same
  rule as above, applied to invite accept, reissue, sign-in details and
  `classifyAccountTarget`.
- Supporting: `73adb13f` forces email transport off in tests (fixes a flaky
  502 in `onboarding-workflow.itest.js` caused by a dev `.env` leaking a real
  Graph mail transport into test runs — environment hygiene, not a product bug).

## Per-stage breakdown (re-verified against tonight's unchanged code)

### Stage 1 (Letter of Offer) — proven, checklist still stale
Unchanged. `backend/onboarding-journey-routes.js` + `onboarding-offer-{letter,docx,pdf,template,email}.js`, guarded per-route with `requirePermission`. Tests unchanged and still passing (see below). The checklist's "Add an editable preview" / "Make preview/PDF/doc identical" / "Add Send button" / "Test end to end" are still unchecked in the tracker despite the code for all of them existing — unchanged disagreement from every prior night.

### Stage 2 (documents + dynamic contract) — needs-refinement, unchanged tonight
- **SharePoint storage: still genuinely does not exist.** Re-confirmed tonight: `onboarding-record-documents.js` stores the contract/PD in `onboarding_offer_documents` (a Postgres table), not SharePoint; grepped the file again for `sharepoint`/`graph.microsoft` — no hits. The tracker checklist item "Finalise the onboarding documents and store them in SharePoint" is still open and still accurate. **Do not confuse this with Clinical Resources' "SharePoint-style" document library (`resourcelibrary.js`) — that is a different, unrelated module with a similar name, and it is not Microsoft SharePoint either.**
- **Dynamic employee contract**: still built (`onboarding-contract-docx.js`, unchanged), as reported previously.
- **"Check the flow from Stage 1 into Stage 2, make every button work"**: substantially addressed by 2026-10-22's Stage 2/3 portal-route work (release, contract/PD attach-generate-preview-remove, invitation flow) — still unchecked in the tracker, but the gap it describes is much smaller than the checklist suggests.
- Placeholder-document refusal and the file-hash acknowledgement remain in place, tested, unchanged tonight.

### Stage 3 — substantially built, unchanged tonight
Built 2026-10-22: the Stage 2/3 portal-route commit (`f1439654`) and the Owner-only activation commit (`96324d99`) together build a real Stage 3 — induction stage, internal setup tasks, activation readiness/blockers, and the Activate gate. The tracker's "stage 3" task still has an empty `explanation`/`notes` and no checklist at all, so there is nothing in the tracker to tick against this — see Disagreement.

## Guard check (re-run tonight)
Every route in `onboarding-journey-routes.js`, `onboarding-employee-routes.js`,
`onboarding-returns-routes.js`, `onboarding-workflow-routes.js`,
`onboarding-routes.js` and `onboarding-defaults-routes.js` sits behind
`requireAuth` plus a specific `requirePermission` (`onboarding.view` /
`.assign` / `.review` / `.activate` / `.payroll` / `.manage_packages` /
`.manage_compliance`), or `requireAuth` alone under `/api/onboarding/me/*`
(self-scoped by design to the caller's own record — documented in the file
header) and `/api/onboarding/journey` (role-gated per-route). One
intentionally unauthenticated route, `GET /api/onboarding/starter-pack/download`,
is pre-existing and documented as token-authorised (one-time, 256-bit,
hashed, expiring token in place of a session) — not a guard gap. No new
unguarded endpoint found tonight. No TODO/FIXME in any changed file.

## Tests and results
Unit (re-run tonight, full 27-file `onboarding-*.test.js` set): **653/654
passed, 1 failed** — the new `onboarding-document-reader.test.js` failure
above. Every other file, including `onboarding-practice.test.js`,
`onboarding-placeholder-check.test.js`, `onboarding-accounts.test.js`,
`onboarding-journey.test.js`, `onboarding-offer-docx.test.js`,
`onboarding-offer-pdf.test.js`, `onboarding-offer-template.test.js`,
`onboarding-contract-docx.test.js` — **all pass**, same as every prior
night.

Integration tests for this feature were not re-run tonight (this session's
effort went into the new sync-settings feature on the Splose/Outlook card
and chasing down the OCR failure above); the 8 `onboarding-*.itest.js`
files are unchanged since they last passed on 2026-10-26
(`onboarding-journey.itest.js`, `onboarding-portal-route.itest.js`,
`onboarding-workflow.itest.js`, `onboarding-defaults.itest.js`,
`onboarding-pack.itest.js`, `onboarding-returns.itest.js`,
`onboarding.itest.js`) and should be re-run by whoever picks up either
item above.

Browser QA: `docs/qa/BROWSER_QA_RESULTS.md` row C still only covers the
onboarding→profile chain as it stood before 2026-10-22's work (login
routing, setup-card render) — it predates and does not exercise the
release/invitation/Activate/induction screens built 2026-10-22. No E2E spec
for onboarding exists.

## Open tasks from the tracker
Stage 1 (mostly done per checklist, items c3–c6 stale-unchecked), Stage 2
(c0 "finalise and store in SharePoint" genuinely open; c2 "check Stage1→2
flow" now much closer than its unchecked state suggests; c6 "simplify
layout" open; c7/c5 dynamic-contract-scope decision and build — c5 is done,
c7's decision step is still open), stage 3 (empty — no checklist at all).

## Commits in window that touched it
None — the true window (`896ace1..41f45ed`) holds only Calendar
sync-settings/Outlook/Splose commits (`11aa73f`, `971cac1`, `3ef3965`,
`ab75330`, `41f45ed`), none touching any `onboarding-*.js` file. The
2026-10-22 commits `fba7eface`, `96324d99`, `f1439654`, `41e81787`,
`db8fb6c4`, `51f585b6`, `73adb13f`, merge `273de152` predate this window —
see "Recent history" above.

## Disagreement
The tracker checklist is now further behind the code than at any prior
audit: Stage 2's "check the flow / make every button work" and essentially
all of Stage 3 are substantially built, tested and guarded, but every
checklist item describing them is still unchecked (Stage 3 has no checklist
at all). The one item that is NOT ahead of the tracker — and still matches
the tracker's own wording exactly — is Stage 2's SharePoint storage, which
remains completely unbuilt. Flag clearly for the team: "SharePoint" now
appears in two unrelated places in this codebase (this feature's literal
gap, and Clinical Resources' new "SharePoint-*style*" UI) — worth a one-line
clarification in the tracker so nobody closes this card by mistake once they
see the other one.
