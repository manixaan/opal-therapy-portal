-- 068: Appendices attached to a template document (the FCA).
--
-- A therapist may attach supporting material to a document instance: a PDF
-- from their machine, or a completed interactive assessment already held in
-- this portal (a WHODAS 2.0 record with its generated PDF). Each attachment
-- becomes an "Appendix A — <title>" heading inside the master's Appendices
-- section, so the contents page lists it, and the PDF export carries the
-- attachment's pages after the report. The Word export names the appendix
-- and refers the reader to the PDF, since Word cannot embed PDF pages.
--
-- Bytes follow the whodas_generated_documents pattern: the configured storage
-- backend decides whether they live inline (file_data, base64) or under a key.
-- A completed-assessment appendix stores no bytes of its own — it references
-- the assessment, and the export reads that record's latest document at
-- export time, so a re-issued assessment PDF is what ships.

CREATE TABLE IF NOT EXISTS template_document_appendices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           UUID NOT NULL REFERENCES template_documents(id) ON DELETE CASCADE,
  organisation_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  created_by_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 'pdf'    an uploaded PDF, bytes held here
  -- 'whodas' a completed WHODAS 2.0 assessment in this portal
  kind                  VARCHAR(20) NOT NULL,
  -- The heading the appendix prints under (after its letter).
  title                 VARCHAR(200) NOT NULL,
  sort_order            INTEGER NOT NULL DEFAULT 0,

  -- Uploaded PDF
  filename              TEXT,
  mime_type             VARCHAR(80),
  byte_size             INTEGER,
  checksum              CHAR(64),
  page_count            INTEGER,
  storage_backend       VARCHAR(20),
  storage_key           TEXT,
  file_data             TEXT,

  -- Completed assessment
  whodas_assessment_id  UUID REFERENCES whodas_assessments(id) ON DELETE CASCADE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT template_appendix_kind CHECK (kind IN ('pdf', 'whodas')),
  CONSTRAINT template_appendix_shape CHECK (
    (kind = 'pdf'    AND (file_data IS NOT NULL OR storage_key IS NOT NULL) AND byte_size > 0 AND whodas_assessment_id IS NULL)
    OR
    (kind = 'whodas' AND whodas_assessment_id IS NOT NULL AND file_data IS NULL AND storage_key IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_template_appendices_document
  ON template_document_appendices (document_id, sort_order, created_at);

COMMENT ON TABLE template_document_appendices IS
  'Supporting material attached to a template document as lettered appendices: an uploaded PDF (bytes held per the storage backend) or a reference to a completed WHODAS assessment whose generated PDF is read at export time.';
