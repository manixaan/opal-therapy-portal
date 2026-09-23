# Portal Onboarding Workflow

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement** (unchanged — the dynamic-contract gap closed in the prior window, see below)
- Addressed in this change window (2026-09-22 → 2026-09-23): no — zero commits landed in this window
  at all. The 9-commit burst described below (dynamic Contract of Employment, cancellation-flow UI,
  start-date fix) landed in the *prior* window (2026-09-21 → 2026-09-22) and is unchanged tonight.
- Created (any located code): yes — by far the largest subsystem in the codebase

## Located files

Unchanged since the prior window (re-confirmed via `git diff` — zero commits touched
`backend`/`frontend/current` in this window). One important addition from the prior window:
`backend/onboarding-contract-docx.js` (new — composes the Contract of Employment from Stage 1 offer
terms) and `backend/scripts/build-contract-template.js` (rebuilds the Stage 2 master docx with
`OPAL_COE_*` Word content controls). `backend/onboarding-document-reader.js` gained particulars/
acceptance-table extraction for the composed contract.

## Guard check

No new guard defects. `personaliseItemFile()` (added in `7e3f921`) composes the contract inside the
existing, already-guarded preview/download/ZIP routes (`requirePermission('onboarding.view')`); it
does not add a new route.

## Tests

Re-run fresh tonight (not reused from last night's result):

- Unit: `npx jest tests/onboarding-*.test.js` → 23 suites passed, 1 failed → **597 passed, 1 failed,
  598 total** — identical to last night. The one failure
  (`onboarding-document-reader.test.js`, "the OCR language data is shipped with the portal, not
  fetched when a document arrives") is the same confirmed **environment artifact, not a code defect**:
  `@tesseract.js-data/eng` is declared in `backend/package.json:28` but genuinely absent from
  `backend/node_modules` in this sandbox (`ls backend/node_modules/@tesseract.js-data` → No such file
  or directory, re-checked tonight). Per this audit's own hard limits, `npm install`/`npm ci` cannot be
  run to fix this; a properly provisioned environment (CI, staging) would install it.
- Integration: all 8 files matching `tests/integration/onboarding*.itest.js` (session-unique
  `DB_NAME`, no contention issues tonight — this session ran alone) → **182/182, 8/8 suites**, all
  passing. Last night's figure (138/138) named 7 suites; this run additionally exercised
  `onboarding-induction.itest.js` — no failures anywhere in the set, no regression either way.
- Browser/E2E: unchanged — no e2e spec covers onboarding; `BROWSER_QA_RESULTS.md` row C predates
  ~70 commits of subsequent work.

## Open tasks from the tracker (all `status: todo`, unchanged by the tracker itself tonight)

- **Stage 1** — "Send button emails it" is still an Outlook-draft-then-manual-send, not a direct
  send — re-confirmed unchanged tonight (`graphMail.createDraft(...)` is still the only path, in
  `onboarding-journey-routes.js:1004`, `onboarding-pack-routes.js:768`,
  `onboarding-workflow-routes.js:631`). Same scope-mismatch worth a team decision as before.
- **Stage 2, dynamic contract — closed in the prior window, unchanged tonight.** `7e3f921` (rebuilds the Stage 2 master docx with
  `OPAL_COE_*` Word content controls via `backend/scripts/build-contract-template.js`, and adds
  `backend/onboarding-contract-docx.js` which composes it per person from the *same* Stage 1 offer
  terms the Letter of Offer uses — `offerDocx.buildScalars`: remuneration, position, dates, super, pay
  cycle, probation, plus a new `cpdAllowance` term) and `28ab180` (teaches
  `onboarding-document-reader.js` to read the composed contract back — particulars table,
  acceptance block, commencement date, employment type, location, salary, hours, signature; reports
  unsigned returns) together implement exactly what the tracker's own Stage 2 decision prompt (`c7`)
  asked for. A contract the practice uploaded *without* the content controls still passes through
  untouched (backward compatible). **The tracker's own checklist items `c7` ("Decide: agree which
  parts...") and `c5` ("Make the employee contract dynamic...") are still shown as unchecked in the
  tracker** — the tracker still has not caught up to those commits (re-confirmed via tonight's fresh
  tracker fetch); worth ticking once someone confirms the built behaviour matches the intended
  fixed/dynamic split.
- **Stage 2, SharePoint storage — still not implemented, unchanged.** Re-checked tonight:
  `grep -rn sharepoint backend/*.js -i` → one hit only, `backend/server.js:408`, still just a CSP
  `frame-ancestors` allowlist entry for the unrelated Opal Assist Office task pane. No upload/storage
  dependency or code exists. Documents currently live in Postgres via `onboarding-catalogue.js` /
  `onboarding-pack.js` / `onboarding-pack-routes.js`.
- **stage 3** — still no code or tracker detail, unchanged.

## Commits in the window that touched it

None this window (2026-09-22 → 2026-09-23) — `develop` did not move since last night (both audits sit
on `74601fc`). Prior window (2026-09-21 → 2026-09-22), for reference:

- 9982ef2 fix(onboarding): the signed letter can be uploaded again (fixed a dead-markup rendering
  regression from an earlier prose-removal pass)
- d5397f2 fix(onboarding): the offer's start date is the day the practice chose (UTC/local
  off-by-one in start-date reconciliation)
- 79ab945 feat(onboarding): every returned document is read — Word, print, scan or photo
- **7e3f921 feat(onboarding): the Contract of Employment goes out filled from the offer**
- 3884e82, 4141680 ui(onboarding): cancelling an onboarding is a confirmation, not a reason (board
  bin + Track view)
- **28ab180 feat(onboarding): the composed Contract of Employment is read when it comes back**
- cc08f1b ui(onboarding): conflict panel names every side and value, offer terms included
- 810d1fa ui(onboarding): Verify is one press, beside the document in the reading panel

## Disagreement

Same two points as last night, one already resolved (in the prior window, not tonight):
1. ~~Stage 2's dynamic employee contract doesn't exist~~ — built in the prior window, see above. The
   tracker's own checkboxes for this still haven't been updated to reflect it (re-confirmed tonight).
2. Stage 1's "Send button emails the letter" still does not match the shipped design (Outlook draft,
   not a real send) — unchanged, still a real scope decision for the team, not a bug.
