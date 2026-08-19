# Mobile persisted-draft contract

**Status:** live in code as of 19 August 2026. This is the Portal-side record
of the contract the Opa Mobile Companion consumes; the app-side copy lives in
the Companion repo (`docs/MOBILE_AI_BACKEND_CONTRACT.md` §5).

## What this closed

`POST /api/mobile/ai/case-note` used to be stateless: it generated narrative
sections, returned them, and stored nothing. The gateway still wrote an
`ai_interactions` row for the generation, but the note the therapist later
saved went to `voice_notes` with no `ai_interaction_id`, no `review_status`
and no `generation_source` — so the row sat at `review_required` forever and
"which notes were AI-assisted, and who approved them" was unanswerable for
mobile notes.

There is now **one governed generation implementation**, in
`backend/case-note-routes.js` (`generateGovernedDraft`), and no stateless path
anywhere. `tests/ai-single-gateway-guards.test.js` fails CI if a second engine
or a stateless route reappears, and `mobile-routes.js` carries no AI code at
all.

## Routes

| Route | Role |
|---|---|
| `POST /api/mobile/case-note-drafts/generate` | Canonical. Persists the draft, links `ai_interaction_id`, returns `draftId` + the full `caseNoteDraft`. |
| `POST /api/mobile/ai/case-note` | **Deprecated alias**, same implementation. Requires `linkedEventId` (`400 linked_event_required` without it — the stateless mode fails closed, not quiet). Success additionally returns the legacy `sections` shape. Shares the canonical route's rate-limit bucket. Remove once no pre-contract app build remains installed. |
| `PATCH /api/mobile/case-note-drafts/:id` | Therapist edits. Review state and provenance untouched. |
| `POST /api/mobile/case-note-drafts/:id/regenerate` | New interaction linked; review reset to `review_required`; prior approval voided; the superseded interaction is resolved as `rejected` by the regenerating therapist. |
| `POST /api/mobile/case-note-drafts/:id/review` | `{ decision: 'approved' \| 'rejected' }` — stamps reviewer + time on the draft and mirrors the decision onto the linked `ai_interactions` row. |
| `DELETE /api/mobile/case-note-drafts/:id` | Archive. A still-`review_required` AI draft is first resolved as `rejected` by the archiver, so no audit row dangles behind an archived note. An already-reviewed draft keeps its recorded outcome. |

All routes are session-authenticated and strictly user-scoped (not-yours →
404). `reviewRequired` is server-authoritative; a client cannot self-declare
approval.

## Failure containment

If the model generates but the draft INSERT/UPDATE fails, the caller gets a
retryable `502 generation_failed` and the interaction is marked orphaned by
`ai-audit.markOrphaned`: `status='provider_error'`,
`deny_reason='draft_persist_failed'`, `review_status='ai_generated'` (out of
the review queue). No false "generated, awaiting review" state survives, and
`provider_request_id` is preserved for CloudTrail correlation.

## What did not change

- The gateway, policy, model allowlist, AU-region restriction, kill switches,
  and the metadata-only `ai_interactions` design are untouched.
- Clinical-note generation still evaluates the **full request** against the
  Bedrock guardrail (Opa's `current_user_message` input-tagging is
  Opa-specific and was deliberately not copied here).
- The provider transmission contract is unchanged: transcript + session date
  + name-stripped service label only, all derived server-side from the owned
  event. The alias now ignores client-sent labels entirely.
