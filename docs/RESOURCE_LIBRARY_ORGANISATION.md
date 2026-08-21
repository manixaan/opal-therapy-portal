# Resource Library organisation

The Resource Hub Library held roughly seven hundred documents presented as one
list with a search box above it. This feature turns that first screen into
folders derived from what the resources actually contain, without moving a
single file.

## What it is not

It is not a file explorer, and it is not a migration. A folder here is a
NAVIGATION AID: membership lives in `resource_folder_assignments`, keyed by
`resource_id`. No resource id changes, no blob key is rewritten, no URL breaks,
no tag, version, favourite or acknowledgement is touched. `resources.folder_id`
— the older ingestion grouping that `resources-routes.js` still reads — is not
written to at all.

## The pipeline

```
scan       active, non-private resources for the organisation
profile    a semantic profile per resource, from metadata plus sampled text
derive     the folders the collection actually needs
review     a model refines placements and wording, where one is available
apply      folders created, assignments written, previous state recorded
```

Everything before `apply` is read-only, so a run that dies halfway leaves a
working library rather than a half-sorted one.

### Deterministic first, model second

`resource-library-taxonomy.js` decides the whole answer without a network. It
scores each resource against a vocabulary of candidate themes, using title,
description, body, tags, content type and — for records whose metadata is thin
— text sampled from the front of the primary PDF or DOCX.

`resource-library-classifier.js` then asks a model to improve that answer. It
cannot restructure anything: it picks from a closed enum of folder keys the
server supplied, every returned resource id is checked against the batch it was
sent, and folder names are validated for shape. If it is unavailable, refuses,
times out or answers nonsense, the library is still organised — which is why
the feature works with no AI configured at all.

### Three decisions worth knowing about

**Purpose outranks topic.** A policy about emotional regulation is a policy.
Somebody looking for it thinks "where are our policies", not "where is the
emotional regulation material". So a resource with a strong purpose signal is
shelved by purpose; only the remainder is shelved by topic.

**Tags are weighted by how much they actually distinguish.** In this library
"Social skills" (155 resources) and "Communication supports" (150) are applied
together so routinely that they tie on every resource carrying both — and a tie
sent material to Needs Review. Inverse document frequency fixes that: a tag on
sixteen resources is decisive, a tag on a hundred and fifty is a hint, and the
title gets to decide instead.

**Thresholds scale with the corpus.** A folder holding six of seven hundred
resources is a rounding error; six of forty is a seventh of the practice's
material. `thresholdsFor(total)` scales the minimum folder, subfolder and
"parent worth dividing" sizes and clamps them at both ends.

## Manual control

An Owner's placement is final. `resource_folder_assignments.manual_lock` is set
by a manual move and is read — never rewritten — by every later run, which
reports how many it left alone. The single-resource classifier refuses a locked
assignment outright, which is also what makes an edit keep its folder and a
replaced document keep its folder without either needing a rule of its own.

`POST /api/rh2/library/reclassify` is the way back to automatic.

## Needs Review

A resource the system cannot confidently place goes to Needs Review rather than
somewhere plausible. The folder is a system fixture: it stays in the database
even when empty, because a later unplaceable upload needs somewhere to land and
a deleted folder's resources are sent there so nothing is orphaned. It is
HIDDEN from the folder list while empty.

## Rollback

Every assignment change writes a `resource_assignment_history` row naming the
run, what it replaced and who made it. `POST /api/rh2/library/rollback` restores
a run's placements, skipping anything a person has locked since.

## Permissions

Browsing is open to anybody who may browse the Resource Hub. Restructuring —
organise, reorganise, create, rename, archive, move, rollback — is the practice
Owner's, enforced on every route. An admin is refused too.

Folder counts are per reader: the same visibility predicate the resource list
uses is applied to the count, so a therapist is never shown "Assessments · 33"
and then finds twenty-eight.

## Search is unchanged

Folders narrow the list only when `folderId` is supplied. A plain search spans
the whole library. A reader inside a folder is OFFERED the narrower search and
told which one is in effect.

## AI governance

Every model call goes through `backend/ai/ai-gateway.js` under the
`resource_library_classification` policy: Australian region, approved model keys
only, kill switch respected, denials audited. The policy is declared INTERNAL,
not clinical — what it reads is the practice's own reference library, and
client-derived (`excluded-private`) records are filtered out before any corpus
is assembled, so the audit register's answer to "has participant data reached a
model for this feature" stays no.

Output type is `assistant_response`. A folder name is not a clinical document.

## Schema (migration 039)

| table | purpose |
|---|---|
| `resource_folders` (extended) | `slug`, `kind`, `is_active`, `is_review_bucket`, `source`, `name_locked`, `updated_at`. `kind='ingestion'` keeps the pre-existing format folders exactly as they were. |
| `resource_semantic_profiles` | what we understand about a resource, so browsing never re-reads a document |
| `resource_folder_assignments` | one primary home per resource, plus `manual_lock` |
| `resource_classification_runs` | one run, its progress, its taxonomy snapshot and its duplicate report |
| `resource_assignment_history` | what each change replaced, for rollback |

## The taxonomy this library produced

Derived from 653 active resources on 21 August 2026, with no model available
(local development has no Bedrock configuration), so these folders are the
deterministic result:

```
Policies & Procedures            22
Assessments                      33
Reports & Documentation          11
NDIS & Funding                   30
Learning & Development           43
Clinical Practice Guides         26
Practice Operations              14
Client & Family Resources        14
Therapy Resources               453   (102 directly)
├── Emotional Regulation         83
├── Social Skills                68
├── Handwriting & Motor Skills   66
├── Equipment & Home Mods        31
├── Communication Supports       29
├── Daily Living Skills          26
├── Body Awareness & Safety      24
└── Routines & Schedules         22
Needs Review                      9
```

Nine top-level folders, eight subfolders under the one parent large enough to
need dividing, and nine resources (1.4%) openly unsorted.

## Operating it

- **Organise Library** / **Reorganise Library** — Resource Hub → Library, Owner
  only. Runs in the background; progress is polled from
  `GET /api/rh2/library/status`.
- Re-running is safe and idempotent: folders are matched by slug and reused, so
  bookmarks, deep links and manual placements survive.
- A run over ~650 resources takes about 15 seconds with text sampling, under a
  second from metadata alone.
- If the AI is unavailable the run still completes and records
  `ai_unavailable_reason`. Nothing in the UI exposes that reason, a model id or
  a token count.
