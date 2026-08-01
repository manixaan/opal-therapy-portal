# Resource Hub — Launch Starter Pack

Seeded on staging 2026-08-01 (Stage 3). Content is generic, non-clinical,
non-copyrighted starter material: planning templates, checklists, official
links (NDIS, AHPRA, OT Australia) and two internal starter policies. No
client information anywhere; no files uploaded; no public URLs; therapists
see approved items only (owner/admin governance unchanged and re-smoked).

## What exists now (14 folders, 16 approved starter items)

| Folder | Starter content |
|---|---|
| Fine motor | Session activity planning template |
| Handwriting | Letter-formation progress checklist template |
| Sensory regulation | Sensory diet planning template (weighted/suspended-equipment safety note) |
| Oral sensory / chewing | Chewy tool safety checklist (**mandatory choking/supervision note**) |
| Emotional regulation | Emotion check-in visual planning template |
| Executive functioning | Visual schedule planning template |
| ADLs | Backward-chaining planning template |
| School participation | Classroom accommodations letter template |
| Parent / carer handouts | "What is OT?" handout outline |
| NDIS / report writing | NDIS official website link · Progress report shell outline |
| Product and shopping links | Product-link entry template (mandatory safety fields) |
| Professional development | AHPRA link · OT Australia link |
| Opal Therapy internal policies | Leave & availability pilot policy (honest about current behaviour) |
| Induction / new therapist resources | New therapist first-week checklist |

Every seeded item is titled `[Starter] …` (except official-org links), has
`source_reference: "Stage 3 starter pack"`, and implies **no clinical
endorsement** — they are scaffolding for the owner and Ann to replace with
real practice content (the therapist feedback session in
`RESOURCE_HUB_SESSION_PACK.md` drives that).

## Upload checklist (before any REAL document goes in)

☐ No client information of any kind ☐ Copyright OK (own material, or LINK
to the source — never re-host) ☐ Correct folder + ≥2 tags ☐ Audience clear
(therapist/parent/school/admin) ☐ Safety notes present where relevant
(**mandatory**: oral/chewing, products, anything weighted or suspended)
☐ Naming: `[Area]_[Topic]_[Audience]_v[N].pdf` ☐ Reviewer + 12-month
review date (set automatically on approval)

**Known limitation (unchanged from R1):** file uploads through the API are
capped by the global 100 KB body limit — the starter pack deliberately uses
description/link-only items. Real PDF uploads need the body-limit carve-out
(tracked for the next code stage); until then, add documents as links or
keep them in the practice drive with a link resource pointing at them.

## Product-link checklist (per entry)

Supplier + URL · approx price AUD + "checked on <date>" · low-cost
alternative (Kmart/Big W where real) · age suitability · one-line clinical
use case (no client details) · **safety notes required** ·
tags from the seeded vocabulary.

## How to add/approve (owner/admin — current UI is read-only)

Authoring UI does not exist yet; the owner adds content via the seeding
script pattern (see `deploy`-adjacent script in the Stage 3 commit) or asks
the developer. Therapist drafts-for-review remain API-only — deferred, and
the Hub's empty-state copy no longer promises it.

## Verified after seeding (staging)

- Therapist sees exactly the 16 approved items + folder list (200).
- Therapist cannot create/approve/archive (403 — pre-existing tests +
  Stage 3 smoke).
- No public URLs: downloads require an authenticated session; external
  links are official organisations only.
