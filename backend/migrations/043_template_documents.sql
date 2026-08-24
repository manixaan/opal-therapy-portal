-- ═══════════════════════════════════════════════════════════════════════════
--  043 — Template documents (Resource Hub → Templates)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Templates lets an authorised clinician complete one of Opal's controlled
-- Word masters inside the portal and then take an INDEPENDENT document away.
-- The masters themselves (fca-v1.docx, progress-note-letter-v1.docx,
-- service-agreement-v1.0.1.docx) are shipped files and are never written to;
-- this table holds only the per-instance answers.
--
-- ── Why a separate table from fca_report_drafts ────────────────────────────
-- fca_report_drafts models a CLINICAL WORKFLOW: an immutable generated
-- artefact, a frozen snapshot, presets, profile save-back and a status machine
-- that refuses edits after generation. A template document is deliberately the
-- opposite — an editable working copy whose whole purpose is to be exported
-- and then owned by the file, not the portal. Overloading document_type on the
-- drafts table would have made every one of those clinical invariants
-- conditional, which is how a status machine stops being trustworthy.
--
-- Nothing here is generated, snapshotted or issued. There is no artefact row:
-- an export is composed on demand and streamed, so there is no stored copy of
-- client data to expire, leak or clean up. That is a deliberate privacy
-- property, not an omission.
--
-- ── Scope ──────────────────────────────────────────────────────────────────
-- Every read and write is scoped by (organisation_id, created_by_user_id) —
-- own-only, exactly as the FCA and letter drafts are. splose_client_id is the
-- external Splose identifier the portal already uses for clients; it is not a
-- foreign key because there is no clients table in this database.

CREATE TABLE IF NOT EXISTS template_documents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  created_by_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Which controlled master this instance completes. Constrained below so an
  -- unknown template id can never be persisted, even if a route regressed.
  template_id          VARCHAR(40) NOT NULL,
  -- The master version this instance was started against, recorded so an
  -- export can state which master it came from without consulting the file.
  template_version     VARCHAR(20) NOT NULL,

  -- The clinician's own name for this document, shown in their list.
  title                VARCHAR(200) NOT NULL,

  -- The Splose client this document is about, when it is about one. NULL is
  -- legitimate: a template may be completed without binding to a client, and
  -- in that case no client data is resolved into it at all.
  splose_client_id     TEXT,

  -- { "<OPAL_TAG>": "<user-entered value>" }. Document-instance answers ONLY.
  -- A value here overrides the resolved portal value for THIS document and is
  -- never written back to the client profile or to the master.
  field_values         JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Constraints ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_template_document_template_id'
  ) THEN
    ALTER TABLE template_documents
      ADD CONSTRAINT valid_template_document_template_id
      CHECK (template_id IN ('service_agreement', 'progress_note', 'fca'));
  END IF;
END $$;

COMMENT ON TABLE template_documents IS
  'One in-portal instance of a controlled Opal Word master. Own-only and organisation-scoped. Holds answers, never the master.';
COMMENT ON COLUMN template_documents.field_values IS
  'Per-instance answers keyed by the master OPAL_* control tag. Never written back to the master or to the client profile.';
COMMENT ON COLUMN template_documents.splose_client_id IS
  'External Splose client id. No FK: client records live in Splose, not in this database.';

-- ── Indexes ────────────────────────────────────────────────────────────────
-- The list endpoint's exact predicate and ordering.
CREATE INDEX IF NOT EXISTS idx_template_documents_owner
  ON template_documents (organisation_id, created_by_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_template_documents_client
  ON template_documents (organisation_id, splose_client_id)
  WHERE splose_client_id IS NOT NULL;
