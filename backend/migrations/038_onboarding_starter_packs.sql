-- ═══════════════════════════════════════════════════════════════════════════
-- 038 — Onboarding starter packs, returned documents, extraction, accounts
--
-- Additive only. Completes the onboarding journey that 034 started, joining
-- its two halves into ONE workflow:
--
--   package → starter pack → email → returned documents → extracted details
--   → owner review → portal account → first login → employee review → done
--
-- 034 modelled onboarding as a requirement workflow driven by a secure
-- invitation. That remains the spine and nothing here replaces it. What was
-- missing is everything BEFORE the invitation: the paper round-trip that
-- actually happens in a small practice, where a new starter is emailed a pack
-- of forms, fills them in, sends them back, and somebody retypes the answers.
--
-- The retyping is the part this migration removes.
--
-- WHAT THIS DELIBERATELY DOES NOT CREATE
-- ──────────────────────────────────────
-- Nothing here duplicates a model 034 already owns:
--   onboarding_documents/_versions  the document library. "Replace the 2025
--                                   Fair Work statement with the 2026 one" is
--                                   a NEW VERSION of the same document, not a
--                                   new document — which is precisely how the
--                                   old version stays provable years later.
--   onboarding_package_versions     the immutable snapshot an assignment pins.
--                                   The starter pack list is snapshotted INTO
--                                   its `content` JSONB (key: starterPack), so
--                                   no new versioning mechanism is invented.
--   employment_profiles,            the four permission-tiered employee tables
--   employee_personal_details,      remain the CANONICAL destination. Extracted
--   payroll_profiles,               values are proposals that get APPLIED into
--   employee_identity_records       them after a human accepts each one.
--   users / user_invites            account creation and invitation. This adds
--                                   a temporary-password path alongside the
--                                   existing invite-link path; it does not
--                                   fork authentication.
--
-- CONCEPT MAP
-- ───────────
--   onboarding_package_documents    The Owner's ORDERED starter-pack list for a
--                                   package. Explicit rows add a document or
--                                   suppress one that the package's
--                                   requirements would otherwise contribute.
--   onboarding_starter_packs        One generated ZIP, with the manifest of
--                                   exactly which document VERSIONS went into
--                                   it. This is the artefact that answers
--                                   "which edition of the handbook did Jane
--                                   actually receive?".
--   onboarding_email_dispatches     Every starter-pack / login email attempt,
--                                   sent or failed. Makes "resend" a fact
--                                   rather than a hope.
--   onboarding_returned_documents   The completed forms, as received. Originals
--                                   are retained forever; extraction reads
--                                   them and never replaces them.
--   onboarding_extraction_runs      One governed AI pass over those documents.
--   onboarding_extracted_fields     One proposed value per field, with its
--                                   source document, page, confidence and
--                                   review state. A proposal is not a fact
--                                   until a person accepts it.
--   onboarding_extracted_field_events  Append-only per-field history.
--
-- SENSITIVE VALUES. An extracted BSB or account number is exactly as sensitive
-- as the payroll_profiles column it will become, and arrives EARLIER — before
-- anyone has reviewed it. So the proposal table encrypts on the same terms as
-- 034: value_encrypted through onboarding-crypto (AES-256-GCM, "enc:" prefix),
-- value_masked as the only renderable form, and a hard CHECK making it
-- impossible to store a sensitive field's value in the plaintext column.
--
-- Tax file numbers are NOT extracted at all — see the notes on
-- onboarding_extracted_fields below.
--
-- CONVENTIONS. Matches 034 and the house style: UUID pk / gen_random_uuid(),
-- TIMESTAMPTZ NOT NULL DEFAULT NOW(), VARCHAR + CHECK instead of native enums,
-- organisation_id on every org-scoped table, idx_<table>_<cols> indexes,
-- IF NOT EXISTS throughout.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
--  1. STARTER-PACK COMPOSITION — what goes in the pack, per package
-- ═══════════════════════════════════════════════════════════════════════════

-- The Owner's starter pack is mostly DERIVED: a package whose requirements ask
-- the new starter to read the Employee Handbook obviously ships the handbook.
-- Deriving it is what stops the two lists drifting apart, which is the same
-- reason 034 composes packages instead of copying them.
--
-- This table holds the DELTA:
--   excluded = FALSE  → include this document even though no requirement
--                       references it (a welcome letter, a position description)
--   excluded = TRUE   → keep the requirement, but leave the document out of the
--                       emailed pack (it is read in the portal instead)
--
-- `display_title` renames a document FOR THIS PACK only. The library title —
-- the thing every other package and every historical record sees — is
-- untouched, so renaming a pack entry can never rewrite history.
CREATE TABLE IF NOT EXISTS onboarding_package_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id       UUID NOT NULL REFERENCES onboarding_packages(id) ON DELETE CASCADE,
  document_id      UUID NOT NULL REFERENCES onboarding_documents(id) ON DELETE CASCADE,
  sort_order       INTEGER      NOT NULL DEFAULT 0,
  display_title    VARCHAR(250),
  excluded         BOOLEAN      NOT NULL DEFAULT FALSE,
  note             VARCHAR(1000),
  added_by         UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_onboarding_package_document UNIQUE (package_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_package_documents_pkg
  ON onboarding_package_documents (package_id, sort_order);


-- ═══════════════════════════════════════════════════════════════════════════
--  2. GENERATED STARTER PACKS — the ZIP that was actually issued
-- ═══════════════════════════════════════════════════════════════════════════

-- `manifest` is the evidentiary payload and the reason this row exists at all:
-- an ordered list of { position, title, fileName, documentId, documentCode,
-- documentVersionId, version, sha256, sizeBytes }. Reconstructing "what was
-- Jane sent" never depends on the ZIP bytes surviving, and never depends on
-- the library still holding that version as current.
--
-- The bytes use the same three-backend storage convention as pd_documents
-- (db | local | blob) so staging keeps working with Azure Blob and nothing
-- assumes a writable local disk.
--
-- DOWNLOAD TOKEN. When the pack is too large to attach (see
-- onboarding_email_dispatches.download_link_used) the email carries a link
-- instead. The recipient has no account yet, so the link must authenticate
-- itself: 32 random bytes, stored only as a SHA-256 hash, single-purpose,
-- time limited. Same shape as user_invites.invite_token, minus the ability to
-- do anything except download this one file.
CREATE TABLE IF NOT EXISTS onboarding_starter_packs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id        UUID REFERENCES organisations(id),
  assignment_id          UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  package_id             UUID NOT NULL REFERENCES onboarding_packages(id) ON DELETE RESTRICT,
  package_version_id     UUID NOT NULL REFERENCES onboarding_package_versions(id) ON DELETE RESTRICT,
  package_version        INTEGER NOT NULL DEFAULT 1,

  manifest               JSONB NOT NULL DEFAULT '[]',
  document_count         INTEGER NOT NULL DEFAULT 0 CHECK (document_count >= 0),
  -- Documents the pack COULD NOT include, with a reason (never published, no
  -- file behind the slot, link-only official source). Surfaced to the Owner
  -- rather than silently dropped: a starter pack missing the Fair Work
  -- statement is a compliance problem, not a cosmetic one.
  omissions              JSONB NOT NULL DEFAULT '[]',

  file_name              VARCHAR(255),
  file_mime              VARCHAR(100) NOT NULL DEFAULT 'application/zip',
  file_size_bytes        INTEGER,
  file_sha256            VARCHAR(64),
  storage_backend        VARCHAR(10) NOT NULL DEFAULT 'db'
                           CHECK (storage_backend IN ('db', 'local', 'blob')),
  storage_key            TEXT,
  file_data              TEXT,

  download_token_hash    VARCHAR(64),
  download_token_expires_at TIMESTAMPTZ,
  download_count         INTEGER NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  last_downloaded_at     TIMESTAMPTZ,

  status                 VARCHAR(20) NOT NULL DEFAULT 'ready'
                           CHECK (status IN ('generating', 'ready', 'failed')),
  error_reason           VARCHAR(500),
  generated_by           UUID REFERENCES users(id),
  generated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set when a newer pack replaces this one (the Owner regenerated, or moved
  -- the onboarding to a newer package version). The old row and its manifest
  -- stay: somebody received it.
  superseded_at          TIMESTAMPTZ,
  superseded_by          UUID REFERENCES onboarding_starter_packs(id) ON DELETE SET NULL
);

-- Idempotency: one live pack per onboarding. A double-clicked "Generate" finds
-- the existing row instead of building a second ZIP.
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_starter_pack_live
  ON onboarding_starter_packs (assignment_id)
  WHERE superseded_at IS NULL AND status <> 'failed';

CREATE INDEX IF NOT EXISTS idx_onboarding_starter_packs_assignment
  ON onboarding_starter_packs (assignment_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_starter_packs_token
  ON onboarding_starter_packs (download_token_hash)
  WHERE download_token_hash IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
--  3. EMAIL DISPATCHES — what was sent, how, and whether it worked
-- ═══════════════════════════════════════════════════════════════════════════

-- §51 of the specification asks for recoverable failure: "we couldn't prepare
-- the email — your starter pack is still saved". That is only expressible if
-- the attempt is a row rather than an exception that vanished into a log.
--
-- `method` records HOW, because the practice has two viable paths and the
-- honest answer differs: 'smtp' sends through the configured mailbox;
-- 'graph_draft' prepares a draft in the Owner's connected Outlook mailbox for
-- them to review and press Send themselves. Nothing here uses mailto: — a
-- mailto link cannot carry an attachment, and pretending otherwise would
-- produce an email with the pack silently missing.
CREATE TABLE IF NOT EXISTS onboarding_email_dispatches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     UUID REFERENCES organisations(id),
  assignment_id       UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  starter_pack_id     UUID REFERENCES onboarding_starter_packs(id) ON DELETE SET NULL,
  kind                VARCHAR(30) NOT NULL
                        CHECK (kind IN ('starter_pack', 'login_invitation', 'reminder')),
  to_email            VARCHAR(255) NOT NULL,
  subject             VARCHAR(500),
  method              VARCHAR(20) NOT NULL DEFAULT 'smtp'
                        CHECK (method IN ('smtp', 'graph_draft', 'graph_send', 'manual')),
  status              VARCHAR(20) NOT NULL DEFAULT 'prepared'
                        CHECK (status IN ('prepared', 'sent', 'draft_created', 'skipped', 'failed')),
  attachment_included BOOLEAN NOT NULL DEFAULT FALSE,
  attachment_bytes    INTEGER,
  -- TRUE when the pack was too large to attach and the email carried a secure
  -- download link instead. The Owner's experience is unchanged; the record
  -- says which actually happened.
  download_link_used  BOOLEAN NOT NULL DEFAULT FALSE,
  provider_message_id VARCHAR(500),
  provider_draft_id   VARCHAR(500),
  web_link            TEXT,
  error_reason        VARCHAR(500),
  -- Sequence number within (assignment, kind): 1 is the original, 2+ are
  -- resends. Makes "resent twice" answerable without counting rows in a UI.
  attempt             INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  requested_by        UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_email_dispatches_assignment
  ON onboarding_email_dispatches (assignment_id, kind, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
--  4. RETURNED DOCUMENTS — the completed forms, as received
-- ═══════════════════════════════════════════════════════════════════════════

-- Originals are kept. Extraction is a READING of these files and never a
-- replacement for them: if the model misreads a BSB, the evidence of what the
-- employee actually wrote must still exist, and if a dispute arises years
-- later the signed page is the record, not our transcription of it.
--
-- `text_status` is deliberately honest about scans. A photographed form with
-- no text layer cannot be read without OCR, and this portal has no OCR
-- dependency, so the status says 'no_text_layer' and the Owner types those
-- fields. Inventing values for an unreadable page would be far worse.
CREATE TABLE IF NOT EXISTS onboarding_returned_documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    UUID REFERENCES organisations(id),
  assignment_id      UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,

  title              VARCHAR(250),
  file_name          VARCHAR(255) NOT NULL,
  file_mime          VARCHAR(100) NOT NULL,
  file_size_bytes    INTEGER,
  file_sha256        VARCHAR(64) NOT NULL,
  storage_backend    VARCHAR(10) NOT NULL DEFAULT 'db'
                       CHECK (storage_backend IN ('db', 'local', 'blob')),
  storage_key        TEXT,
  file_data          TEXT,

  page_count         INTEGER,
  text_status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (text_status IN ('pending', 'extracted', 'no_text_layer',
                                              'unsupported', 'failed')),
  text_chars         INTEGER,
  -- Everything a new starter returns is sensitive employment information; the
  -- column exists so a future non-sensitive attachment can say so explicitly.
  sensitivity        VARCHAR(20) NOT NULL DEFAULT 'sensitive'
                       CHECK (sensitivity IN ('standard', 'sensitive')),
  status             VARCHAR(20) NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'archived')),
  uploaded_by        UUID REFERENCES users(id),
  uploaded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at        TIMESTAMPTZ,
  archived_by        UUID REFERENCES users(id)
);

-- Idempotency: re-uploading the same file to the same onboarding is a no-op,
-- not a duplicate. A retried request or a double-clicked button cannot produce
-- two copies of the same signed form.
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_returned_document_sha
  ON onboarding_returned_documents (assignment_id, file_sha256)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_onboarding_returned_documents_assignment
  ON onboarding_returned_documents (assignment_id, uploaded_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
--  5. EXTRACTION — one governed AI pass, many proposed fields
-- ═══════════════════════════════════════════════════════════════════════════

-- Every call goes through backend/ai/ai-gateway.js under the
-- `onboarding_document_extraction` policy. `ai_audit_id` links this run to the
-- gateway's own audit row, so an incident review can move in both directions:
-- from an employee's record to the model call, and from a model call to the
-- records it touched.
CREATE TABLE IF NOT EXISTS onboarding_extraction_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    UUID REFERENCES organisations(id),
  assignment_id      UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  status             VARCHAR(20) NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'running', 'succeeded', 'partial',
                                         'failed', 'cancelled')),
  document_count     INTEGER NOT NULL DEFAULT 0 CHECK (document_count >= 0),
  readable_count     INTEGER NOT NULL DEFAULT 0 CHECK (readable_count >= 0),
  field_count        INTEGER NOT NULL DEFAULT 0 CHECK (field_count >= 0),
  model_key          VARCHAR(60),
  provider           VARCHAR(30),
  ai_audit_id        UUID,
  -- A short machine reason ('ai_unavailable', 'no_readable_text',
  -- 'model_refused'), never provider text and never document content.
  error_reason       VARCHAR(200),
  requested_by       UUID REFERENCES users(id),
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency: one run in flight per onboarding. A second "Read documents"
-- click joins the run already going rather than starting a competing one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_extraction_run_live
  ON onboarding_extraction_runs (assignment_id)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_onboarding_extraction_runs_assignment
  ON onboarding_extraction_runs (assignment_id, created_at DESC);

-- ── Proposed field values ───────────────────────────────────────────────────
--
-- THE CENTRAL RULE OF THIS TABLE: a row here is a PROPOSAL, never a fact. The
-- canonical employee record still lives in the four 034 tables, and a value
-- only reaches them when `status` becomes 'accepted' or 'corrected' and the
-- apply step writes it across. That separation is what stops a confident-
-- sounding misreading from becoming somebody's official date of birth.
--
-- WHAT IS DELIBERATELY NOT EXTRACTED
--   TFN. A tax file number is collected under a specific legal regime, it is
--   the one number in the pack whose misuse is a criminal matter, and the
--   employee has to attest to their own tax circumstances regardless — so the
--   portal collects it directly from the employee in the authenticated tax
--   form (034's `tax_setup`) and the extractor is instructed never to return
--   it. The field_key CHECK below refuses it structurally, so a model that
--   ignored the instruction still cannot land a TFN in this table.
--
-- SENSITIVE VALUES. `sensitivity = 'sensitive'` (bank details, identity
-- document numbers) stores the value ONLY in value_encrypted, with
-- value_masked as the renderable form. The CHECK makes the safe path the only
-- path: a sensitive row with a plaintext value will not insert.
--
-- CONFIDENCE. `confidence` is the model's own assessment, coarsened to three
-- buckets because a two-decimal score implies a calibration no extractor has.
-- Everything below 'high' surfaces to the Owner for review; nothing is
-- auto-applied on confidence alone.
CREATE TABLE IF NOT EXISTS onboarding_extracted_fields (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    UUID REFERENCES organisations(id),
  assignment_id      UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  run_id             UUID REFERENCES onboarding_extraction_runs(id) ON DELETE SET NULL,

  field_group        VARCHAR(30) NOT NULL
                       CHECK (field_group IN ('identity', 'contact', 'emergency',
                                              'employment', 'payroll', 'super',
                                              'credentials', 'other')),
  field_key          VARCHAR(60) NOT NULL
                       -- Structural refusal of the values this portal must not
                       -- hold as a machine reading. See the note above.
                       CHECK (field_key NOT IN ('tfn', 'tax_file_number', 'tfn_number')),
  label              VARCHAR(150) NOT NULL,
  sensitivity        VARCHAR(20) NOT NULL DEFAULT 'standard'
                       CHECK (sensitivity IN ('standard', 'sensitive')),

  value_text         TEXT,
  value_encrypted    TEXT,
  value_masked       VARCHAR(60),

  confidence         VARCHAR(10) NOT NULL DEFAULT 'medium'
                       CHECK (confidence IN ('high', 'medium', 'low')),
  source_document_id UUID REFERENCES onboarding_returned_documents(id) ON DELETE SET NULL,
  source_label       VARCHAR(250),
  source_page        INTEGER,

  status             VARCHAR(20) NOT NULL DEFAULT 'proposed'
                       CHECK (status IN ('proposed', 'accepted', 'corrected',
                                         'rejected', 'applied')),
  -- TRUE once a human has looked at this specific field, whatever they decided.
  reviewed           BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by        UUID REFERENCES users(id),
  reviewed_at        TIMESTAMPTZ,
  -- 'extraction' | 'owner' | 'employee' — who last set the value standing here.
  value_source       VARCHAR(20) NOT NULL DEFAULT 'extraction'
                       CHECK (value_source IN ('extraction', 'owner', 'employee')),
  applied_at         TIMESTAMPTZ,
  applied_to         VARCHAR(60),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_onboarding_extracted_field UNIQUE (assignment_id, field_key),
  -- A sensitive value may never sit in the plaintext column, and must carry a
  -- mask so a UI has something safe to render.
  CONSTRAINT ck_onboarding_extracted_field_sensitive CHECK (
    sensitivity <> 'sensitive'
    OR (value_text IS NULL AND (value_encrypted IS NULL OR value_masked IS NOT NULL))
  )
);

CREATE INDEX IF NOT EXISTS idx_onboarding_extracted_fields_assignment
  ON onboarding_extracted_fields (assignment_id, field_group, field_key);
CREATE INDEX IF NOT EXISTS idx_onboarding_extracted_fields_review
  ON onboarding_extracted_fields (assignment_id, status)
  WHERE status = 'proposed';

-- Append-only. Records WHICH field changed and by whom — never the value,
-- exactly as onboarding_requirement_events does for requirements.
CREATE TABLE IF NOT EXISTS onboarding_extracted_field_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id       UUID NOT NULL REFERENCES onboarding_extracted_fields(id) ON DELETE CASCADE,
  assignment_id  UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  actor_user_id  UUID REFERENCES users(id),
  actor_role     VARCHAR(20),
  event_type     VARCHAR(40) NOT NULL,
  from_status    VARCHAR(20),
  to_status      VARCHAR(20),
  note           VARCHAR(500),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_field_events_field
  ON onboarding_extracted_field_events (field_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_field_events_assignment
  ON onboarding_extracted_field_events (assignment_id, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
--  6. ASSIGNMENT LIFECYCLE — the stages that happen before the invitation
-- ═══════════════════════════════════════════════════════════════════════════

-- 034's lifecycle began at 'created' and went straight to 'invite_sent'. The
-- six new states below sit in that gap. They are ORDERED but not MANDATORY:
-- an Owner who does not need a paper round-trip can still go from 'created'
-- directly to account creation, which is 034's original behaviour unchanged.
ALTER TABLE onboarding_assignments DROP CONSTRAINT IF EXISTS onboarding_assignments_status_check;
ALTER TABLE onboarding_assignments
  ADD CONSTRAINT onboarding_assignments_status_check CHECK (status IN (
    -- before the pack
    'created',
    -- the paper round-trip
    'starter_pack_ready', 'starter_pack_sent', 'documents_received',
    'details_extracted', 'ready_for_account',
    -- the portal account
    'account_created', 'invite_sent', 'invite_accepted', 'in_progress',
    -- review and completion (unchanged from 034)
    'employee_actions_complete', 'employer_review', 'corrections_required',
    'ready_to_activate', 'activated', 'completed', 'cancelled', 'archived'
  ));

-- Milestone timestamps. Every one of these drives a line in the Owner's
-- progress panel; storing them beats deriving them from audit_logs, which is
-- a log and not a queryable workflow state.
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS starter_pack_generated_at TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS starter_pack_sent_at      TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS starter_pack_sent_to      VARCHAR(255);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS documents_received_at     TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS extraction_completed_at   TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS details_reviewed_at       TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS details_reviewed_by       UUID REFERENCES users(id);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS account_created_at        TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS account_created_by        UUID REFERENCES users(id);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS invitation_sent_at        TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS first_login_at            TIMESTAMPTZ;

-- ── Identity columns ────────────────────────────────────────────────────────
-- §54: personal, work and login email are three different things and
-- conflating them is how somebody ends up unable to sign in after their
-- practice mailbox is created. `applicant_email` (034) remains the address the
-- starter pack goes to; `login_email` is what the account authenticates with,
-- defaulting to the same value but free to differ.
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS work_email  VARCHAR(255);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS login_email VARCHAR(255);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS mobile      VARCHAR(40);

CREATE INDEX IF NOT EXISTS idx_onboarding_assignments_login_email
  ON onboarding_assignments (organisation_id, LOWER(login_email))
  WHERE login_email IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
--  7. TEMPORARY PASSWORDS — a first credential that must not survive first use
-- ═══════════════════════════════════════════════════════════════════════════

-- The portal already had ONE way in for a new starter: an emailed invitation
-- link on which they choose their own password. That path is good and stays.
--
-- The specification asks for a second: the Owner creates the account, the
-- system generates a temporary password, and the employee changes it at first
-- login. These columns make that safe rather than merely possible.
--
--   password_is_temporary   the credential standing in password_hash was
--                           machine-generated and issued by somebody else
--   must_change_password    a hard gate. requireAuth refuses every path except
--                           the password-change endpoints while this is TRUE,
--                           so a temporary credential can reach exactly one
--                           screen and nothing else — not by UI convention,
--                           but at the single server-side choke point.
--   temp_password_expires_at  a temporary credential that is never used should
--                           stop working. Expiry is checked at LOGIN, so an
--                           expired one fails closed.
--   password_changed_at     when the standing password was set. Also what
--                           proves the temporary one is gone.
--
-- The plaintext is NEVER stored. It is returned exactly once, in the response
-- to the Owner's create-account call and in the invitation email body, and is
-- unrecoverable afterwards — reissue is the only remedy, which is correct.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_is_temporary   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at     TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password_issued_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password_issued_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_users_must_change_password
  ON users (must_change_password) WHERE must_change_password = TRUE;


-- ═══════════════════════════════════════════════════════════════════════════
--  8. BACKFILL — existing rows keep their current meaning
-- ═══════════════════════════════════════════════════════════════════════════

-- Anyone who already has a password chose it themselves through the invitation
-- link; none of them is on a temporary credential. Stating it explicitly means
-- the new gate cannot lock out an existing user because a default was assumed.
UPDATE users
   SET password_is_temporary = FALSE,
       must_change_password  = FALSE
 WHERE password_hash IS NOT NULL
   AND must_change_password IS NOT FALSE;

-- login_email defaults to the address the onboarding was started with.
UPDATE onboarding_assignments
   SET login_email = applicant_email
 WHERE login_email IS NULL;

-- Assignments already past the invitation reached that point through the
-- original flow, so their account milestone is their release time.
UPDATE onboarding_assignments
   SET account_created_at  = COALESCE(account_created_at, released_at),
       invitation_sent_at  = COALESCE(invitation_sent_at, released_at)
 WHERE released_at IS NOT NULL;

UPDATE onboarding_assignments
   SET first_login_at = COALESCE(first_login_at, invite_accepted_at)
 WHERE invite_accepted_at IS NOT NULL;
