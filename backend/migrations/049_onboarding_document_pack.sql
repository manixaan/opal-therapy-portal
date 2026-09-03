-- ═══════════════════════════════════════════════════════════════════════════
-- 049 — Phase 2: the per-employee onboarding document pack
--
-- The DEFAULT pack is derived from the record's pinned package version and
-- the engine's facts (role, employment type, screening determinations) —
-- nothing here changes that. What is new is that the derived list becomes
-- ROWS OF THIS PERSON'S OWN, which the Owner edits: add a document, remove
-- one, rename it, replace its file, without touching the defaults anyone
-- else receives. The ZIP that goes out is built from these rows and stored
-- through 038's onboarding_starter_packs; the rows stay the source of truth.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS onboarding_pack_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id        UUID REFERENCES organisations(id),
  assignment_id          UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  code                   VARCHAR(80) NOT NULL,
  title                  VARCHAR(250) NOT NULL,
  description            VARCHAR(1000),
  section                VARCHAR(40),
  -- what the row means for the employee
  sends_document         BOOLEAN NOT NULL DEFAULT TRUE,   -- a file goes out in the pack
  employee_returns       BOOLEAN NOT NULL DEFAULT FALSE,  -- something must come back
  requires_verification  BOOLEAN NOT NULL DEFAULT FALSE,  -- the practice checks it
  required               BOOLEAN NOT NULL DEFAULT TRUE,
  -- where it came from
  origin                 VARCHAR(20) NOT NULL DEFAULT 'default'
                           CHECK (origin IN ('default', 'added')),
  requirement_code       VARCHAR(80),
  -- the file: a library document (pinned to a version at generation time)…
  document_id            UUID REFERENCES onboarding_documents(id) ON DELETE SET NULL,
  document_version_id    UUID REFERENCES onboarding_document_versions(id) ON DELETE SET NULL,
  official_source_url    TEXT,
  -- …or this person's own copy, which wins over the library while present
  file_name              VARCHAR(255),
  file_mime              VARCHAR(100),
  file_size_bytes        INTEGER,
  file_sha256            VARCHAR(64),
  storage_backend        VARCHAR(10) CHECK (storage_backend IS NULL OR storage_backend IN ('db', 'local', 'blob')),
  storage_key            TEXT,
  file_data              TEXT,
  file_uploaded_by       UUID REFERENCES users(id),
  file_uploaded_at       TIMESTAMPTZ,
  -- lifecycle
  status                 VARCHAR(20) NOT NULL DEFAULT 'included'
                           CHECK (status IN ('included', 'removed')),
  removed_reason         VARCHAR(500),
  sort_order             INTEGER NOT NULL DEFAULT 0,
  -- the return leg (Phase 2 completion)
  returned_document_id   UUID REFERENCES onboarding_returned_documents(id) ON DELETE SET NULL,
  returned_at            TIMESTAMPTZ,
  verified_at            TIMESTAMPTZ,
  verified_by            UUID REFERENCES users(id),
  verification_note      VARCHAR(1000),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_onboarding_pack_item UNIQUE (assignment_id, code)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_pack_items_assignment
  ON onboarding_pack_items (assignment_id, sort_order);

-- The pack's own milestones and Email 2, on the record.
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS pack_prepared_at        TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS pack_email_subject      VARCHAR(250);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS pack_email_body         TEXT;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS pack_email_draft_id     VARCHAR(300);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS pack_email_web_link     TEXT;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS pack_email_drafted_at   TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS pack_email_drafted_by   UUID REFERENCES users(id);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS pack_sent_by            UUID REFERENCES users(id);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS pack_due_at             TIMESTAMPTZ;

-- Email 2 is one more kind of dispatch.
ALTER TABLE onboarding_email_dispatches DROP CONSTRAINT IF EXISTS onboarding_email_dispatches_kind_check;
ALTER TABLE onboarding_email_dispatches
  ADD CONSTRAINT onboarding_email_dispatches_kind_check CHECK (kind IN (
    'starter_pack', 'login_invitation', 'reminder', 'letter_of_offer', 'offer_reminder', 'onboarding_pack'
  ));
