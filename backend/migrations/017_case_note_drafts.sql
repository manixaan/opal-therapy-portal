-- ═══════════════════════════════════════════════════════════════════════════
--  017 — Case-note drafts: voice-to-case-note (Opa Mobile)
-- ═══════════════════════════════════════════════════════════════════════════
-- AI-assisted clinical documentation DRAFTS. A row is created when the
-- clinical-note provider transforms a therapist's dictated transcript into
-- Opal-structured narrative sections; the therapist then reviews/edits and
-- the row remains a PRIVATE DRAFT — nothing here is finalised clinical
-- documentation, nothing auto-writes to Splose/Outlook, and no role other
-- than the owning user can read a row (snapshot_* scoping model:
-- user_id-filtered everywhere, 404-on-not-yours).
--
-- Separation of sources is structural:
--   header       deterministic appointment metadata snapshot (client name,
--                address, service line, session date) — set by the server
--                from the linked event, NEVER model output
--   identify / session_details / plan
--                AI-transformed narrative from the therapist's dictation
--   note_body    the composed, therapist-editable full note text
--   transcript   the therapist's original dictation — preserved verbatim,
--                never overwritten by generation or regeneration
--
-- Provenance columns (style_version, provider_id, model_id, generated_at)
-- record how each draft was produced. Audit events carry ids/versions only,
-- never content. linked refs are soft (no FK) so drafts survive their event.

CREATE TABLE IF NOT EXISTS case_note_drafts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id UUID REFERENCES organisations(id),
  voice_note_id   UUID,
  linked_event_id UUID NOT NULL,
  transcript      TEXT NOT NULL,
  header          JSONB NOT NULL DEFAULT '{}'::jsonb,
  identify        TEXT NOT NULL,
  session_details TEXT NOT NULL,
  plan            JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings        JSONB NOT NULL DEFAULT '[]'::jsonb,
  note_body       TEXT NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'draft',
    CONSTRAINT valid_case_note_status CHECK (status IN ('draft','archived')),
  style_version   VARCHAR(60) NOT NULL,
  provider_id     VARCHAR(40) NOT NULL,
  model_id        VARCHAR(80) NOT NULL,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_note_drafts_user_created
  ON case_note_drafts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_note_drafts_user_event
  ON case_note_drafts (user_id, linked_event_id);
