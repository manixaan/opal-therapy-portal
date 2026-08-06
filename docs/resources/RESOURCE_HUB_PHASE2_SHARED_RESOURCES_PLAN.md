# Resource Hub — Phase 2 plan: full Shared Resources module

**Status: PLANNED — not built.** Phase 1 (2026-08-06) shipped the three-area
shell only. Build Phase 2 only on explicit owner approval.

## Data model (target fields)

Existing fields carry over (title, description, category, tags, file-or-link,
contributor, date added, review status). Phase 2 adds, via a new migration:

| Field | Notes |
|---|---|
| diagnosis | multi-tag (e.g. ASD, DCD, CP) — practice-defined vocabulary |
| therapy_goal | multi-tag (fine motor, self-care, regulation, …) |
| age_range | min–max years, filterable bands |
| resource_type | worksheet · activity · checklist · visual support · home program · assessment aid |
| version history | append-only versions table: editor, timestamp, change note, prior file ref |
| report_status | none · reported · cleared · removed |

## Actions (target)

Preview · save/favourite · download · share internally · report ·
submit for review · approve · edit · archive · remove.
Therapist: first five + submit + report. Owner: all. Admin: none (per RBAC
decision 2026-08-06) until an explicit permission is added.

## Safety requirements

- **No client-identifying material** — reminder at upload (shipped in Phase 1),
  plus a Phase 2 pre-publish owner check step.
- Upload review checks: file-type allowlist, size limit (100 KB limit currently;
  raising it is its own decision), filename PII scan heuristic.
- Owner moderation queue: submitted → in-review → approved/rejected with note.
- Audit trail: who uploaded/approved/archived/reported, when, from which role.
- Version history retained on edit; downloads always serve the approved version.
- Role-based access enforced server-side (never trust the tab UI).

## Out of scope for Phase 2

External sharing (flag stays off), AI anything, purchasing.
