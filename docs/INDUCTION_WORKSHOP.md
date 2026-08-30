# Induction Workshop — build plan

Owner-authored inductions built in a workshop: reading pages, guided tours,
pop-ups, spotlights, quizzes and checkpoints, mixed freely in one list.

## Decisions taken (30 Aug 2026)

| Question | Decision |
|---|---|
| Who may author | **Owner only.** No delegated permission for now. |
| The 9 built-in tours | **Edit the originals directly.** No copy-on-edit. Safe because assignments pin an immutable published snapshot — a learner mid-induction never sees the draft. |
| Tour reuse | **Build inside an induction; it lands on a shared shelf automatically.** Any later induction can drop the same tour in. One tour, one place to fix a typo. |
| Recording | **In, up front.** Not deferred to a later phase. |
| Structure | **One list of blocks.** No wall between "the reading part" and "the tour part". |

## Where this starts from

Two systems exist today, with a thin bridge between them.

**Editable, database-backed** — `learning_workflows` (migration 033). Sections of
items typed `content | resource | acknowledgement | quiz | task`, a draft the
Owner edits freely, immutable published versions, per-employee assignments
pinned to a version. Edited via the form editor in `frontend/current/resourcehub.js`
(~line 6044), previewed via `GET /api/learning/workflows/:id/preview`.

**Not editable, code-owned** — `frontend/current/induction-modules.js`: 9 modules,
~110 steps, types `intro | highlight | action | screenshot | callout | warning |
quiz | complete`. `backend/tutorial-routes.js` `require()`s the same file so the
server can validate keys, versions and step counts. `frontend/current/induction.js`
is the player: it routes to a tab, opens a panel, resolves the target, draws the
spotlight, places the card.

The bridge: a workflow `task` item may carry `walkthrough_key`, launching one of
the nine.

The player is the expensive part and it is already built. This plan feeds it from
the database instead of from a source file, and adds an authoring skin over it.

## Block palette

Existing step types, re-presented as things the Owner picks up:

| Block | Backed by |
|---|---|
| Note | `intro` / `callout` step |
| Spotlight | `highlight` step |
| Do this | `action` step (`advance: 'click'`) |
| Warning | `warning` step |
| Picture | `screenshot` step |
| Question | `quiz` step |

New:

| Block | Notes |
|---|---|
| Checkpoint | `quiz` with `blocking: true` — cannot advance until correct. Records into `learning_item_progress.evidence`, which already exists for this. |
| Page | A document block inside a tour: a paragraph or two, attached to no target. Renders as a wide card, no spotlight. |
| Sign here | The existing `acknowledgement` item type, usable from inside a tour. |

## The portal map

The workshop holds a searchable catalogue of the portal — tabs, panels, named
buttons — so adding a spotlight is picking from a list, not hunting. Selecting an
entry writes the stable `data-help` name; the player already knows how to reach it.

Selector preference, matching `resolveEl()` in `induction.js`:

1. `data-help` name — stable, survives redesign. ~50 exist today; extend as needed.
2. `#id`.
3. CSS path — fragile. Allowed, but the editor warns and the target report watches it.

"Just show me" puts the page into a picker: hover outlines, click captures, and the
picker resolves to the best of the three.

## Phases

Each phase is independently shippable.

### Phase 1 — tours into the database  (CRITICAL) — DONE (17b4967)

Migration mirroring 033: `walkthrough_modules` (`draft_steps` JSONB,
`current_version`) and `walkthrough_module_versions` (immutable snapshots).
`induction-modules.js` becomes a one-time seed of system-owned rows.

`backend/walkthrough-content.js` — pure step validation/normalisation, the
counterpart of `learning-content.js`. Server-side normalisation is mandatory: body
text goes through the same escape-then-`**bold**` rules as `indFormat`, and no raw
HTML ever reaches a pop-up.

`tutorial-routes.js` stops requiring the source file and validates against the
published catalogue. `induction.js` stops reading `window.OpalInductionModules`
synchronously and fetches instead. This is the invasive part: server-side step
validation is what stops a crafted client claiming completion, so it needs
permission and audit coverage, not just a happy-path test.

Safety rule carried over from the module header — no step may click through a
destructive or externally visible action. Once non-engineers author `action`
steps this cannot rely on author judgement: denylist `advance: 'click'` against
send / delete / disconnect / invite targets.

### Phase 2 — the workshop — DONE (516d1b1 API, adb3977 surface)

"New induction" button. One editor, one list of blocks, drag to reorder.

Author mode reuses the player: same routing, same target resolution, same
spotlight; the learner card is swapped for an author dock.

- inline editing of title and body, saved on blur
- "Point at something else" — the portal map, or the live picker
- "Add a block here" — the palette above
- a step rail for reorder / delete / duplicate
- "Show me how a new staff member sees it" — flips to the learner card without
  leaving the tour

A tour built here is written to the shelf on first save, and referenced by the
induction rather than embedded.

### Phase 3 — the new blocks

Checkpoint, Page, Sign here. Schema additions plus player rendering.

### Phase 4 — recording and the target report

**Recording.** Record, use the portal normally, Stop. Returns a skeleton: an empty
pop-up at each stop, in order, pointing at the right targets. The Owner supplies
the words. It builds the structure, not the content.

**Target report.** Runs every saved tour and lists steps whose target no longer
resolves — so a broken tour surfaces in a report, not in front of a new employee.
This is the long-term maintenance answer to selector fragility and should not slip
past this phase.

## Risks

- **Selector fragility** is the main long-term risk. Mitigated by biasing hard
  toward `data-help` and by the target report.
- **Phase 1 touches completion validation.** CRITICAL level: permissions, audit,
  and the integration tests around `tutorial_progress` all need attention.
- **In-flight learners.** Guaranteed safe by the snapshot rule already proven in
  033 — assignments pin `workflow_version_id` and editing the draft never touches
  them. Preserve that invariant for walkthroughs.
