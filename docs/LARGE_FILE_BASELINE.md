# Large-file baseline — 23 Aug 2026

Recorded during the Claude Code workflow optimisation (Stage 1) as a
before-measurement, and kept current as modularisation proceeds. It exists so a
future session can locate code inside these files without reading them whole.

**Stage 2A (23 Aug 2026): the My Profile domain left `mockup_v3.html` for
`profile.js`** — 1,553 lines of behaviour moved byte-for-byte, markup and
`.pf-*` styles left in the shell. 28,988 → 27,259 lines.

## Frontend (`frontend/current/`)

| File | Lines | How to navigate it |
|---|---|---|
| `mockup_v3.html` | 27,259 | `grep -n '============ .* TAB' ` gives every tab's start line; read a bounded slice with `sed -n`. Asset `<script>` pins are lines 1–69. A `→ /<file>.js` pointer comment sits wherever a domain has been extracted. |
| `resourcehub.js` | 6,533 | Resource Hub tab; folders, upload, preview, right-click menu |
| `onboarding.js` | 4,132 | Onboarding tab (employee-facing journey) |
| `fca.js` | 3,006 | FCA assessment builder |
| `letter.js` | 2,350 | Progress-note letters |
| `profile.js` | 1,794 | My Profile tab — leave, CPD, PD documents, credentials, work schedule, notification preferences (extracted from the shell, Stage 2A) |
| `scheduler.js` | 1,786 | Calendar/scheduler tab |
| `interview.js` | 1,733 | Interview preparation |
| `induction-modules.js` | 1,728 | Learning module player |
| `serviceagreement.js` | 1,444 | Service agreements |
| `whodas.js` | 1,426 | WHODAS 2.0 |
| `navigation.js` | 1,379 | Tab switching, visibility, role gating (UI only) |

`frontend/archive/` holds a further ~11k lines of dead mockups — never edit, and
they are excluded from search by `.ignore`.

## Backend (`backend/`)

| File | Lines | Notes |
|---|---|---|
| `routes.js` | 2,913 | Legacy catch-all mounted at `/api`; new endpoints do **not** go here |
| `resource-hub-r2-routes.js` | 2,520 | Resource Hub R2 API |
| `database.js` | 2,140 | Pool + frozen `INIT_QUERIES` version-0 baseline schema |
| `service-agreement-routes.js` | 2,031 | |
| `onboarding-workflow-routes.js` | 1,945 | |
| `app-routes.js` | 1,670 | Notifications, app-shell endpoints |
| `onboarding-db.js` | 1,593 | |
| `learning-routes.js` | 1,357 | |
| `onboarding-employee-routes.js` | 1,340 | |
| `onboarding-catalogue.js` | 1,305 | |
| `onboarding-assignment-routes.js` | 1,274 | |
| `profile-routes.js` | 1,235 | |
| `server.js` | 1,204 | Router mount table — the index for every URL |

Backend total: ~59.8k lines across top-level `*.js`.

## Stage 2 candidates, in priority order

1. `mockup_v3.html` — by far the largest single-file cost in every frontend task.
   Lift one bounded domain at a time into its own `<feature>.js`, deferred and
   pinned, leaving the markup and shared styles behind: My Profile went first
   (Stage 2A). The next candidates with the same shape are the daily/weekly
   report panel (`openReportPanel` … `buildWeeklyReportHTML`, ~1,350 lines), the
   billing dashboard (~320) and the Xero accounting console (~360). Splitting the
   markup itself needs a templating step this repository does not have — the
   logic is where the cost is.
2. `resourcehub.js` and `onboarding.js` — split by concern (data, render, events).
3. `routes.js` — carve the remaining legacy endpoints into focused route modules.
