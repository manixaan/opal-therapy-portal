# Interactive Induction & Tutorial System

The Opal Portal induction is a set of interactive, resumable walkthroughs of
the portal itself — spotlight overlays that point at the real interface,
persisted server-side per user, surfaced through the Resource Hub.

This document is the developer reference: architecture, schema, anchors,
authoring, screenshots, versioning, testing, and safety rules.

---

## Architecture

| Piece | File | Role |
|---|---|---|
| Module definitions | `frontend/current/induction-modules.js` | **Single source of truth.** Pure data + pure helpers: every module (key, version, roles, minutes, thumbnail, start context) and every step. Loaded by the browser AND `require()`d by the backend, so client and server can never disagree about the catalogue. |
| Engine | `frontend/current/induction.js` | The overlay walkthrough runtime: spotlight shading, card placement, anchor resolution with graceful fallback, navigation, progress client, the My Learning dashboard, the hub-home teaser, and the resource-detail launch bridge. Pure helpers are exported for Node tests. |
| Styles | `frontend/current/induction.css` | Overlay + dashboard styles; dark-mode and reduced-motion aware. |
| API | `backend/tutorial-routes.js` | `/api/tutorials/*` — per-user progress, strictly user-scoped; owner/admin completion overview. |
| Schema | `backend/migrations/032_tutorial_progress.sql` | One table: `tutorial_progress`, one row per user per module; "not started" is the absence of a row. |
| Screenshots | `scripts/capture-tutorial-screenshots.js` | Repeatable synthetic-only capture (`npm run tutorials:capture`). |
| Static tutorial cards | `backend/setup/r2-content/core.js` | The written Resource Hub tutorial pages (slugs `portal-*`). Module keys equal these slugs — the resource page is the reference companion of the interactive walkthrough. |

### Where users meet it

- **Resource Hub → My Learning** — the induction dashboard: overall progress,
  per-module status (Start / Continue / Review / Restart), thumbnails.
- **Resource Hub → Home** — a "Your induction" teaser card while incomplete.
- **Tutorial resource pages** — a "Start interactive walkthrough" button on
  any `portal-*` tutorial the caller's role can take.
- **Help panel ("?")** — an induction section with progress and a link in.
- Completing a module also marks the matching hub resource complete
  (`user_learning_progress`), so learning-path percentages agree.

## Progress persistence

`tutorial_progress` (migration 032): `user_id`, `tutorial_key`, `version`,
`status` (`in_progress` | `completed`), `current_step`, `furthest_step`,
`step_count`, `started_at` / `last_viewed_at` / `completed_at`,
`completed_version`, `restart_count`, `UNIQUE (user_id, tutorial_key)`.

API (all `requireAuth`; writes blocked for `read_only` by the global choke
point, so read-only accounts keep their place in a localStorage mirror only):

- `GET  /api/tutorials/catalogue` — role-filtered module metadata.
- `GET  /api/tutorials/progress` — the caller's rows.
- `PUT  /api/tutorials/:key/progress` `{version, step, stepCount}` — upsert;
  `furthest_step` is monotonic within a version.
- `POST /api/tutorials/:key/complete` `{version}` — also bridges the matching
  hub resource to completed (best-effort).
- `POST /api/tutorials/:key/restart` — resets position, bumps
  `restart_count`, **keeps** `completed_at`/`completed_version` history.
- `GET  /api/tutorials/overview` — owner/admin: per-staff module-state counts
  (shown in Hub → Admin → Analytics). Deliberately coarse — no step-level
  behaviour detail.

Unknown module keys and modules the caller's role cannot take both answer
**404**, indistinguishable from absence. The engine debounces step writes
(400 ms) and mirrors to localStorage so a dropped request never loses the
user's place.

## Versioning

Each module carries a `version`. Bump it when steps are added, removed,
reordered, or change what the user is asked to DO — not for wording fixes.

- Completed on an older version → dashboard shows **Updated**; the
  completion stays valid (`completed_version` records what was finished).
- In progress on an older version → the walkthrough restarts from step 1
  with a toast (step numbers don't survive a definition change), and the
  server resets the `furthest_step` high-water mark on version change.

## Anchors (`data-help`)

Tutorial targets resolve in this order: `[data-help="name"]` → `#id` → CSS
selector — the same rule as the legacy help tours. `data-help` attributes
are the designed anchor system; add one when a step needs a control that has
no stable hook, and name it `area-thing` (`settings-outlook-connect`,
`invite-modal-close`, `rh2-cpd`, `opa-close`).

**Drift is CI-gated**: `backend/tests/induction-registry.test.js` fails if
any live step target no longer appears in the frontend sources — renaming or
removing an anchored control forces the tutorial to be updated with it.

A missing anchor at runtime never crashes: the step degrades to its
screenshot/text explanation, logs a console diagnostic, and — if the anchor
appears late (a panel still sliding in) — self-heals back into a live
highlight.

## Step vocabulary

Documented exhaustively in the header of `induction-modules.js`. Types:
`intro`, `highlight`, `action` (safe clicks only; `advance: 'click'`),
`screenshot`, `callout`, `warning`, `quiz` (light knowledge check — never
blocks completion), `complete`. Steps may carry `route` (`tab`, `view`,
`section` for Settings sections, `calendarMode` for the Master Scheduler,
`open` for containers: `booking` | `notifications` | `opa` | `invite-modal`),
`roles` (narrowing within the module's role gate), `menu`, `pad`/`rounded`,
`image` (also the fallback visual), and `next` on the complete step.

## Safety rules (non-negotiable)

- No step ever clicks through a destructive or externally visible action:
  creating/deleting events, sending invitations, acknowledging policies,
  disconnecting Outlook, sending Opa messages. Those are explain-only
  (`highlight` + "don't click this now" wording) or shown as screenshots.
- `action` steps are only for safe, reversible clicks (switching views,
  opening panels).
- Role gates in the registry are validated server-side on every write.

## Adding or changing a module

1. Edit `frontend/current/induction-modules.js` (metadata + steps). Keep the
   module `key` equal to the hub resource slug if a written companion exists.
2. Add any new `data-help` anchors to the app markup.
3. Bump `version` if the change is material (see Versioning).
4. If steps reference screenshots, add capture entries (next section).
5. Run `cd backend && npx jest tests/induction-registry.test.js` — schema,
   role, and anchor-drift gates.
6. Run `npm run test:e2e:local` for the browser-level suite.

## Screenshots

All tutorial imagery is generated, synthetic, and repeatable:

```
npm run tutorials:capture                # everything
npm run tutorials:capture -- --only portal-using-calendar
```

The script prepares the dedicated **synthetic** database
(`therapy_scheduler_capture`: migrations + dev users + demo calendar + hub
seeds), starts its own server on :5008, signs in as synthetic accounts, and
writes PNGs to `frontend/current/assets/tutorials/` (module thumbnails at
the top level, step shots in per-module folders). Definitions live in
`CAPTURES` inside `scripts/capture-tutorial-screenshots.js`.

**Never capture from the development database** — its `events` table mirrors
a real Outlook mailbox. The capture script refuses nothing by itself; the
rule is enforced by always pointing it at `CAPTURE_DB` (default
`therapy_scheduler_capture`).

Two Opa images (`portal-opa/suggestions.png`, `portal-opa/answer.png`)
depend on the AI provider being enabled and are captured/refreshed against
staging with a synthetic account.

## Testing

| Layer | Where | Run |
|---|---|---|
| Registry validity + anchor drift + engine pure helpers | `backend/tests/induction-registry.test.js` | `npm test` (backend) |
| Progress API (auth, roles, upsert, versioning, restart, overview, org scoping) | `backend/tests/integration/tutorial-progress.itest.js` | `npm run test:integration` (backend) |
| Browser lifecycle (dashboard, start/advance/highlight, pause→resume across reload and re-login, completion persistence, restart, role filtering, missing-anchor degradation, resource-page launch) | `e2e/tests/tutorials.spec.js` | `npm run test:e2e:local` (root; self-hosts a synthetic server) |

The staging Playwright config also picks up the tutorial spec when staging
credentials are present.

## Related

- The legacy quick tours (`HELP_TOURS` in `mockup_v3.html`) remain as
  page-level refreshers in the Help panel; the induction is the structured,
  server-persisted learning path. Both share the `data-help` anchor system.
- Static tutorial card content: `backend/setup/r2-content/core.js`
  (re-run `node backend/setup/seed-resource-hub-r2.js` after editing).
