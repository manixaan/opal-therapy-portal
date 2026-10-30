# Portal Onboarding Workflow

- Tracker stage: idea · Tracker environment: none
- Evidence label: **broken** (one real, reproducible test failure; everything else is tab-unproven — see breakdown below)
- Addressed since the last audit: **no**. Tonight's window (`15acf0c..338f5dc`, last audit → tonight) holds 5 commits (`08da79d`, `e1af24e`, `a56173c`, `dc5dbc4`, `338f5dc`, plus merge `4335514`), touching only `backend/routes.js`, `backend/database.js`, `backend/mobile-routes.js`, `backend/case-note-routes.js`, `backend/ai/ai-audit.js`, `backend/tests/*`, `frontend/current/mockup_v3.html`, `frontend/current/travel*.js/.css`, `frontend/current/casenotes.js`. None touch any `onboarding-*` file, `frontend/current/onboarding*.js/.css/.html`, or `backend/onboarding-policies/`. Verified with `git diff --stat 15acf0c..338f5dc` and `grep -i onboarding` over that diff's file list (zero hits).
- Created (any located code): yes, extensively.

## Located

Backend routers (all mounted in `backend/server.js:557-574`): `onboarding-employee-routes.js`, `onboarding-workflow-routes.js`, `onboarding-journey-routes.js`, `onboarding-pack-routes.js`, `onboarding-returns-routes.js`, `onboarding-payroll-routes.js`, `onboarding-defaults-routes.js`, `onboarding-package-docs-routes.js`, `onboarding-assignment-routes.js`, `onboarding-library-routes.js`, `onboarding-routes.js`.
Data access / support (53 `onboarding-*.js` files total under `backend/`, all pass `node --check` tonight): `onboarding-db.js`, `onboarding-engine.js`, `onboarding-audit.js`, `onboarding-crypto.js`, `onboarding-seed.js`, `onboarding-expiry.js`, `onboarding-induction.js`, `onboarding-document-reader.js`, `onboarding-document-check.js`, `onboarding-ocr.js`, `onboarding-ocr-worker.js`, `onboarding-extraction.js`, `onboarding-contract-docx.js`, `onboarding-offer-*.js`, and more.
Frontend: `frontend/current/onboarding.js` (admin "Edit Onboarding" surface — default-category document management lives here), `onboarding-journey.js` (journey/assignment board), plus matching `.css`/`.html` (`onboarding.css`, `onboarding.html`, `onboarding-journey.css`, `onboarding-invite.html`). Tab banner: `ONBOARDING TAB` (`frontend/current/mockup_v3.html:4289`).

Tracker's three tasks map to real subsystems, not literal modules:
- **Stage 1** = offer (`onboarding-journey-routes.js` + `onboarding-pack-routes.js` + `onboarding-offer-*.js`)
- **Stage 2** = documentation (`onboarding-workflow-routes.js` returned-documents/extraction/OCR + `onboarding-returns-routes.js` + `onboarding-library-routes.js` + `onboarding-defaults-routes.js`/`-package-docs-routes.js` for the "default categories" admin screens)
- **Stage 3** = induction (shared with the separate "Inductions" tracker feature: `onboarding-induction.js`, `learning-routes.js`, `induction-assistant-routes.js`)

## Guard check

Pass, no gaps — independently re-grepped tonight. Every management router applies `requireAuth` plus `requirePermission`/`requireAnyPermission` keyed to `onboarding.view`/`.assign`/`.review`/`.payroll`/`.manage_packages`/`.manage_documents`/`.manage_compliance`/`.audit`, or an `ownerOnly` guard (`onboarding-routes.js:178`). Two deliberately-unauthenticated routes (`/api/onboarding-invite/check`, `/api/onboarding-invite/accept` in `onboarding-employee-routes.js`) carry a header comment explaining why: no account exists yet to authenticate, and the token is single-use/hashed/expiring, rate-limited via `inviteRateLimit`. `onboarding-employee-routes.js`'s `/api/onboarding/me/*` block is `requireAuth`-only but its header comment documents it as strictly self-scoped by design — every read/write resolves off `req.user.id`, with no route taking another user's id. All 53 onboarding backend files pass `node --check` tonight.

## Tests and results (independently re-run tonight, not taken on trust)

| Command | Result |
|---|---|
| 25 onboarding unit test files (accounts, catalogue, contract-docx, crypto, email-markup, engine, extraction, form-reader, frontend-guards, journey(-frontend-guards), offer-docx/pdf/template, pack, payroll, placeholder-check, practice, reconcile, returns-match/zip, security, starter-pack, wizard-link, workflow-guards) | **PASS — 25 suites, 632 tests** (reproduced exactly) |
| `tests/onboarding-document-reader.test.js tests/onboarding-document-check.test.js` | **FAIL — 1 of 22** (reproduced exactly) |
| 10 onboarding integration files (defaults, induction, journey, pack, payroll-xero, portal-route, returns, wizard-link, workflow, onboarding) via `DB_NAME=therapy_scheduler_auditg8 DB_PASSWORD=audit npx jest --config jest.integration.config.js ... --runInBand` | **PASS — 10 suites, 218 tests** (reproduced exactly, 468s) |

Total: 871 passing, 1 failing, across 36 test files. The one failure, quoted verbatim:
```
● no model reads a returned document › the OCR language data is shipped with the portal, not fetched when a document arrives
Cannot find module '@tesseract.js-data/eng/package.json' from 'tests/onboarding-document-reader.test.js'
```

**OCR dependency — re-confirmed tonight, still missing.** `ls backend/node_modules/@tesseract.js-data/` → "No such file or directory"; `ls backend/node_modules | grep -i tesseract` → no match at all (not even `tesseract.js` core). However `backend/package.json:28` and `backend/package-lock.json:3723-3728` both correctly declare `"@tesseract.js-data/eng": "^1.0.0"` resolving to the real npm registry tarball — the dependency is correctly specified, it is simply not installed in this sandbox's `node_modules` (this audit must not run `npm install` to fix that, per the hard limits). This is consistent with last night's finding and still needs confirming against the real Azure deployment's installed `node_modules`, where a normal `npm ci` against the committed lockfile would be expected to install it.

Note: `tests/integration/stage1-launch-blockers.itest.js` and `stage2-pilot-readiness.itest.js` exist but are an unrelated pre-pilot RBAC/identity audit, not this tracker card's "Stage 1/2/3" — not run here to avoid a misleading match (confirmed by file content, same as last night).

## Breakdown

- **Document reading / OCR extraction (part of Stage 2): broken** — a guarded, otherwise-passing test fails on the missing `@tesseract.js-data/eng` dependency, reproduced identically to last night.
- **Everything else (offer, package/compliance admin, account provisioning, Stage 1, the rest of Stage 2, onboarding's side of Stage 3): tab-unproven** — 850 non-OCR tests pass, but nothing current proves the admin package/compliance UI renders in a browser. `docs/qa/BROWSER_QA_RESULTS.md` (still dated 2026-08-01, build `188334d`; file last touched by unrelated commit `6273803`) Flow C only walks a new starter's basic onboarding entry. `e2e/tests/portal.spec.js` and `e2e/tests/tutorials.spec.js` only reference an onboarding URL redirect in passing (`waitForURL(/onboarding/)`), not the admin package-admin/compliance UI. No E2E spec and no browser-QA entry for the admin side exists tonight.

## Open tracker tasks

`[todo]` Stage 1, `[todo]` Stage 2, `[todo]` stage 3 — all open (unchanged from the tracker snapshot). Stage 2's checklist shows "Show the documents in the portal under the default categories" done (confirmed in `frontend/current/onboarding-journey.js`, which contains "Edit Onboarding" / default-categories UI code), but "Finalise the onboarding documents and store them in SharePoint" is not done — and, confirmed again tonight, there is zero SharePoint reference anywhere in `backend/onboarding-*.js` (`grep -ri sharepoint` → no hits), so that remains entirely unbuilt, not merely unproven. Stage 1's and Stage 2's remaining open items (editable preview parity, Send-by-email, employee-contract dynamism) and Stage 3 (empty in the tracker) are not independently verifiable from code alone tonight; see Stage-specific checklist items in the tracker for the fine-grained gaps.

## Commits in window touching located files

None. The 5 commits in `15acf0c..338f5dc` (`08da79d` travel/traffic, `e1af24e` mobile diary, `a56173c`/`dc5dbc4` case notes, `338f5dc` travel-traffic test tweak) touch travel, mobile, case-notes and AI-audit code only — no onboarding file is in any of their diffs.

## Disagreement / notes

Tracker's current `claude_update`: *"Broken: returned-document OCR reading fails on a missing @tesseract.js-data/eng package — needs confirming in the real deployment. Everything else (850 tests passing) is tab-unproven: the admin package/compliance UI has no browser or E2E check."* and `next_action`: *"Confirm @tesseract.js-data/eng is present in the real deployment; then browser-test the Stage 1-3 admin package/compliance UI."*

**Agree, fully, on independent re-verification.** Both the OCR failure and the 850-test non-OCR pass count are reproduced exactly tonight. No disagreement to raise — the SharePoint-misattribution confusion noted two audits ago is not present in the tracker's current wording and does not need repeating. One addition worth flagging to the team: Stage 2's SharePoint-storage checklist item is genuinely unbuilt (zero code), not just unproven — worth distinguishing from the admin-UI browser-proof gap when prioritising `next_action`.
