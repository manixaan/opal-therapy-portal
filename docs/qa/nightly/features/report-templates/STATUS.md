# Report Templates

- Tracker stage: idea · Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed since the last audit (develop unchanged since 2026-10-28, also commit `15acf0c`): no — confirmed by real `git log --since=2026-10-15` on every located file, all empty.
- Created (any located code): yes.

## Located

Shares the same FCA/letter engine as Interactive Assessments (`backend/fca-routes.js`, `letter-routes.js`, `backend/fca/`, `frontend/current/fca.js`, `letter.js`).

**"Client Agreement Form"** maps to the service-agreement master served through `backend/templates-routes.js` (`/api/templates/*`) + `backend/templates/service-agreement-map.js`, which describes the real file `backend/service-agreements/templates/service-agreement-v2.2.docx` (121 unique content-control tags, verified against the shipped `.docx` by `templates-service-agreement-map.test.js`). This is the generic "complete an Opal master inside the portal, take an independent document away" capability. Note: `backend/service-agreement-routes.js` does **not** exist as a separate file — the service agreement is served via `templates-routes.js`, contrary to what CLAUDE.md's repo-map table might suggest at a glance.

Frontend: `frontend/current/templates.js`/`.css` (shares the Library/Templates-collection entry point with `fca.js`/`letter.js`).

## Guard check

`templates-routes.js` mounts `requireAuth` plus the same `CLINICAL_ROLES`/`read_only` inline role gate as fca/letter/whodas (admin excluded) — by design it introduces no separate permission. Document access is re-fetched under `(organisation, creator)` on every request (own-only, 404 not 403 on a miss, matching the org-isolation pattern used elsewhere). No unguarded route. `node --check` clean.

## Tests and results

| Command | Result |
|---|---|
| `templates-appendices`, `templates-export-boundary`, `templates-frontend-guards`, `templates-routes`, `templates-service-agreement-map` (5 unit files) | PASS — all green |
| shared `fca-docx-engine`/`letter-docx-engine` unit tests | PASS |
| `templates.itest.js`, `fca-reports.itest.js`, `progress-note-letters.itest.js` (integration) | PASS |

No failures anywhere.

## Commits in window touching located files

None.

## Classification evidence

Code for FCA, Progress Letter and the Client Agreement Form (service agreement master) is located, guarded, and every matching test passes, but no e2e spec or browser-QA entry exercises any of the three generation wizards. Confirmed via the same grep as Interactive Assessments: zero hits in both e2e spec files and in `BROWSER_QA_RESULTS.md`.

## Open tracker tasks

`[todo]` FCA, `[todo]` Progress Letter, `[todo]` Client Agreement Form — all three still open, all three map to tested-but-unproven-in-browser code.

## Disagreement / notes

Agree with the prior claude_update. Worth surfacing explicitly here since the tracker card never names it: "Client Agreement Form" is concretely `templates-routes.js` + `service-agreement-v2.2.docx`.
