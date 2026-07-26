# Resource Hub / Clinical Resource Repository — Module Spec

**Recorded 2026-07-26. Separate stream from Accounting/Xero.**
Implementation policy: foundation first (Phase R1) — **no autonomous clinical
recommendation behaviour** until later phases pass their own review gates.

## Objective
A governed internal repository of clinical, educational, therapy, product,
PD and practice resources — folder browsing, diagnosis/therapy-area/
population/resource-type tags, worksheets, session ideas, handouts, school
resources, research, PD, templates, product links, favourites, downloads,
and (later, staged) client-linked suggestions from permitted Splose context.

## Clinical safety principle (locked)
Suggestions never replace clinical reasoning. Every client-linked
recommendation must display: *"Suggested resources based on available client
information. Therapist review required before use."* No inferred diagnoses,
no automatic prescriptions, no unsupported medical claims, no identifiable
client data to external AI without an approved privacy model.

## Governance (locked)
States: `draft → submitted_for_review → approved | rejected`, plus
`needs_update`, `archived`. Only approved resources visible to therapists.
Fields: created/approved by, last-reviewed + review-due dates, version
history, source/citation, copyright status, evidence level, safety notes,
age suitability, contraindications, clinical disclaimer.

## Permissions (backend-mandatory)
- **Owner:** everything incl. approvals, folders/tags, products, analytics, all suggestions.
- **Admin/senior:** create/edit drafts, submit, approve only if granted, review queue.
- **Therapist:** view/search/download approved, favourite, own-client suggestions only, submit drafts, feedback. Never approve/delete global or see others' client suggestions.
- **Read-only:** approved unrestricted viewing only if allowed; no downloads of restricted items, no suggestions.

## Feature flags (fail closed, finance-flags pattern)
```dotenv
ENABLE_RESOURCE_HUB=true                  # read flag, default on
ENABLE_RESOURCE_CLIENT_SUGGESTIONS=false  # fail closed
ENABLE_RESOURCE_AI_SUGGESTIONS=false      # fail closed
ENABLE_RESOURCE_EXTERNAL_SHARING=false    # fail closed
```

## Data model (foundation tables in migration; rest per-phase)
R1: `resource_folders, resources, resource_tags, resource_tag_links,
resource_files, resource_favourites` (+ audit via app-wide audit_logs,
storage via the existing document-storage abstraction — private,
authenticated downloads only). Later phases add: versions, reviews/approval
history, products, usage events, client suggestions + feedback, collections/
bundles, access log.

## Tag vocabularies (seeded, owner-extensible)
- **Diagnosis:** Autism, ADHD, Intellectual Disability, GDD, Developmental Delay, FASD, Cerebral Palsy, Down Syndrome, ABI, Psychosocial Disability, Schizophrenia/Schizoaffective, Anxiety, Sensory Processing, DCD, Physical Disability, Amputation, Chronic Pain, Neurological, Feeding Difficulties, Handwriting Difficulties, Executive Functioning, Emotional Regulation, Behaviour of Concern
- **Therapy area:** fine motor, gross motor, handwriting, sensory processing, oral sensory/chewing, feeding, emotional regulation, executive functioning, ADLs, IADLs, social skills, school participation, community access, home safety, mobility, assistive technology, equipment prescription, routine building, communication supports, play skills, parent coaching, capacity building, work readiness, money management, cooking, personal care, sleep, toileting
- **Population:** early childhood, children, adolescents, adults, older adults, remote/rural, school-based, home-based, community-based
- **Type:** worksheet, visual support, handout, session plan, activity idea, home program, school strategy, product link, equipment idea, research article, PD video, template, assessment support, case example, report phrase bank, NDIS evidence guide, risk/safety guide

## Phases
- **R1 Foundation (build now):** tab + RBAC, folders, metadata, tags, list/search, approved viewing, private upload/download (owner/admin upload), favourites, audit, tests, migration.
- **R2 Product links:** supplier/price/last-checked/safety-notes model, categories, link tracking. Safety notes mandatory (choking/supervision/age).
- **R3 Governance workflow:** submit/approve/reject/review-due, version history, evidence/copyright, admin review UI.
- **R4 PD & research:** PD types, research links, optional careful CPD linkage.
- **R5 Client-linked manual suggestions:** therapist picks own client + manual tags → rule-based tag-overlap scoring; bundles (draft only). No AI, nothing external.
- **R6 Splose-linked suggestions:** read permitted context only (verify which fields actually exist first; no over-fetch, minimal cache, therapist-caseload scoping).
- **R7 AI-assisted (privacy review first):** de-identified context only; outputs labelled "AI-assisted draft — therapist review required".
- **R8 Secure client/carer sharing:** only after a secure external sharing model (expiry, revoke, consent, audit; no public links).

## Guardrails (verbatim intent)
No autonomous clinical decisions · no cross-therapist client suggestions ·
no identifiable data to external AI · no public file links · no unreviewed
resources shown as approved · backend RBAC not frontend hiding · respect
copyright · no auto-sending to clients/carers · product links require safety
notes · minimal client context in logs · never destabilise Outlook/Splose/
Accounting streams.

## Analytics (owner/admin, later)
Most used/favourited, review-due, poor feedback, empty searches, top
categories, product clicks, downloads, contributions, suggestion usefulness
— without sensitive client-identifying search logging.

Therapist feedback plan: `docs/resources/RESOURCE_HUB_FEEDBACK_PLAN.md`.
