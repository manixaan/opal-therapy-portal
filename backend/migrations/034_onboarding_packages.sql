-- ═══════════════════════════════════════════════════════════════════════════
-- 034 — Onboarding Packages: employee onboarding + workforce compliance
--
-- Additive only. Opal Therapy's digital equivalent of a corporate new-starter
-- pack, modelled as a REQUIREMENT WORKFLOW rather than a folder of PDFs.
--
-- WHAT THIS DELIBERATELY DOES NOT CREATE
-- ──────────────────────────────────────
-- The portal already owns four models this feature would otherwise duplicate.
-- They are EXTENDED at the bottom of this file instead:
--   credentials          — Ahpra, WWCC, NDIS screening, licence, qualification,
--                          professional indemnity. Already has expiry +
--                          verified_by/verified_at. Gains statutory lifecycle
--                          status, jurisdiction, verification provenance.
--   pd_documents         — every employee-supplied file. Already private
--                          (no public URLs, storage-backend abstraction).
--                          Gains a link back to the requirement it satisfies.
--   learning_assignments — TRAINING_MODULE requirements point at a learning
--                          assignment (033). Completion flows one way:
--                          learning completes → requirement completes.
--   user_invites         — the secure invitation. Gains the pre-employee role
--                          and a link to the onboarding assignment.
--   org_settings         — organisation onboarding configuration (NDIS provider
--                          status, reminder windows) lives in the existing
--                          JSONB blob under the 'onboarding' key. No new table.
--
-- CONCEPT MAP
-- ───────────
--   onboarding_requirement_templates  Owner's library of reusable requirement
--                                     building blocks. A template says WHAT is
--                                     required, WHO acts, HOW it is satisfied
--                                     and WHEN it applies (applicability rule).
--   onboarding_packages               A named package (e.g. "Occupational
--                                     Therapist — Casual"). Composed of
--                                     template references, not copies.
--   onboarding_package_requirements   The DRAFT composition (editable).
--   onboarding_package_versions       Immutable published snapshot. An
--                                     assignment pins one forever, so
--                                     "what was this person actually issued?"
--                                     is always answerable.
--   onboarding_assignments            One person's onboarding run, with the
--                                     employment facts the rule engine used.
--   onboarding_requirements           Per-assignment requirement instances,
--                                     each carrying the frozen template
--                                     snapshot it was created from.
--   onboarding_requirement_events     Immutable per-requirement history.
--   onboarding_acknowledgements       Policy/document acknowledgements pinned
--                                     to an exact document VERSION. Never
--                                     rewritten when a policy is superseded.
--
--   onboarding_documents / _versions  Version-controlled document library
--                                     (Opal policies, official statements).
--   onboarding_document_imports/_items ZIP import staging + proposed
--                                     classification, Owner-confirmed.
--   compliance_requirements           Owner-only registry of the official
--                                     source behind each requirement.
--   organisation_compliance_records   EMPLOYER obligations (workers comp,
--                                     public liability, NDIS registration).
--                                     Never an employee upload.
--   compliance_expiry_notices         Dedupe ledger for the expiry engine.
--
--   employment_profiles          employment arrangement          (onboarding.view)
--   employee_personal_details    identity/contact/emergency      (onboarding.review)
--   payroll_profiles             bank + tax + super, ENCRYPTED   (onboarding.payroll)
--   employee_identity_records    ID + work rights, ENCRYPTED     (onboarding.sensitive_identity)
--
-- The four employee tables are separate BECAUSE their permission tiers differ.
-- Splitting them is what makes "an Admin who can chase paperwork but must
-- never see a TFN" expressible in the schema rather than only in a handler.
--
-- SENSITIVE VALUES. tfn, bsb, account_number, identity/visa numbers are stored
-- through crypto-utils encrypt() (AES-256-GCM, "enc:" prefix) and are never
-- selected into list endpoints. A parallel *_last4 / *_masked column carries
-- the only value any UI is allowed to render.
--
-- CONVENTIONS. Matches the house style: UUID pk / gen_random_uuid(), TIMESTAMPTZ
-- NOT NULL DEFAULT NOW(), VARCHAR + CHECK instead of native enums (so a new
-- state needs a migration but never a type rewrite), organisation_id on every
-- org-scoped table, idx_<table>_<cols> indexes, IF NOT EXISTS throughout.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
--  1. COMPLIANCE REGISTRY — the official source behind every requirement
-- ═══════════════════════════════════════════════════════════════════════════

-- Why a requirement exists, and on whose authority. `basis` is the honesty
-- column: it stops the system implying that an Opal house rule is a statute.
CREATE TABLE IF NOT EXISTS compliance_requirements (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    UUID REFERENCES organisations(id),
  code               VARCHAR(60)  NOT NULL,
  title              VARCHAR(250) NOT NULL,
  category           VARCHAR(40)  NOT NULL,
  classification     VARCHAR(40)  NOT NULL
                       CHECK (classification IN (
                         'OFFICIAL_DOCUMENT', 'OFFICIAL_LIVE_SOURCE', 'OPAL_POLICY',
                         'OPAL_FORM', 'EMPLOYEE_UPLOAD', 'EMPLOYER_VERIFICATION',
                         'TRAINING_MODULE', 'ACKNOWLEDGEMENT', 'EMPLOYER_ONLY_COMPLIANCE',
                         'EMPLOYER_REFERENCE')),
  -- LEGAL_REQUIREMENT is reserved for obligations that genuinely bind. An
  -- internal safeguarding rule is OPAL_POLICY_REQUIREMENT even when Opal
  -- enforces it just as strictly.
  basis              VARCHAR(30)  NOT NULL DEFAULT 'OPAL_POLICY_REQUIREMENT'
                       CHECK (basis IN (
                         'LEGAL_REQUIREMENT', 'REGULATORY_STANDARD',
                         'CONTRACTUAL_REQUIREMENT', 'OPAL_POLICY_REQUIREMENT',
                         'GOOD_PRACTICE')),
  applies_to         VARCHAR(120),
  jurisdiction       VARCHAR(20)  NOT NULL DEFAULT 'AU'
                       CHECK (jurisdiction IN ('AU', 'WA', 'NDIS', 'PROFESSION', 'OPAL')),
  source_org         VARCHAR(150),
  source_title       VARCHAR(250),
  source_url         TEXT,
  -- Free text, because the sources that matter most do not carry version
  -- numbers. The Fair Work statements identify themselves only by a footer
  -- reading "Last updated: July 2026", and the FTCIS lives at a URL whose path
  -- says 2023-12 while holding the November 2025 revision. A numeric version
  -- column here would force fabricated data.
  source_version_label VARCHAR(120),
  source_last_modified TIMESTAMPTZ,
  source_checked_at    TIMESTAMPTZ,
  document_version   VARCHAR(60),
  effective_date     DATE,
  -- Recurring obligations. The Casual Employment Information Statement is the
  -- worked example: it is NOT a one-off onboarding task but must be re-issued
  -- at 6 and 12 months and every 12 months thereafter (12-monthly only for a
  -- small business employer). Shape:
  --   { "kind": "months_since_start", "months": [6,12], "thenEveryMonths": 12,
  --     "smallBusinessMonths": [12], "smallBusinessThenEveryMonths": 12 }
  recurrence         JSONB NOT NULL DEFAULT '{}',
  -- Permitted delivery methods, which differ per statement: the FTCIS may be
  -- delivered electronically ONLY with the employee's agreement, unlike the
  -- FWIS and CEIS. Shape: { "methods": [...], "electronicRequiresAgreement": true }
  delivery_rules     JSONB NOT NULL DEFAULT '{}',
  -- Set when the Owner has confirmed against the primary source that this
  -- record still reflects the current requirement. NULL = never verified.
  last_verified_at   TIMESTAMPTZ,
  last_verified_by   UUID REFERENCES users(id),
  next_review_date   DATE,
  stored_document_id UUID,
  status             VARCHAR(20)  NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'superseded', 'archived')),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_compliance_requirement_code UNIQUE (organisation_id, code)
);

CREATE INDEX IF NOT EXISTS idx_compliance_requirements_org
  ON compliance_requirements (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_compliance_requirements_review
  ON compliance_requirements (next_review_date);

-- ═══════════════════════════════════════════════════════════════════════════
--  2. DOCUMENT LIBRARY — version-controlled, Owner-published
-- ═══════════════════════════════════════════════════════════════════════════

-- A document SLOT may legitimately exist with no file behind it:
-- content_status = 'document_required' is how the system says "Opal needs to
-- write this policy" instead of inventing an authoritative-looking one.
CREATE TABLE IF NOT EXISTS onboarding_documents (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           UUID REFERENCES organisations(id),
  code                      VARCHAR(80)  NOT NULL,
  title                     VARCHAR(250) NOT NULL,
  description               VARCHAR(1000),
  category                  VARCHAR(40)  NOT NULL DEFAULT 'other',
  classification            VARCHAR(40)  NOT NULL DEFAULT 'OPAL_POLICY'
                              CHECK (classification IN (
                                'OFFICIAL_DOCUMENT', 'OFFICIAL_LIVE_SOURCE', 'OPAL_POLICY',
                                'OPAL_FORM', 'TRAINING_MODULE', 'EMPLOYER_REFERENCE')),
  audience                  VARCHAR(20)  NOT NULL DEFAULT 'employee'
                              CHECK (audience IN ('employee', 'employer', 'both')),
  -- FALSE for government/regulator documents: Opal republishes them verbatim
  -- and must never edit the source text.
  owner_controlled          BOOLEAN      NOT NULL DEFAULT TRUE,
  official_source_url       TEXT,
  compliance_requirement_id UUID REFERENCES compliance_requirements(id) ON DELETE SET NULL,
  content_status            VARCHAR(20)  NOT NULL DEFAULT 'document_required'
                              CHECK (content_status IN ('document_required', 'available', 'link_only')),
  status                    VARCHAR(20)  NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'published', 'superseded', 'archived')),
  current_version           INTEGER      NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  requires_acknowledgement   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by                UUID REFERENCES users(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at               TIMESTAMPTZ,
  CONSTRAINT uq_onboarding_document_code UNIQUE (organisation_id, code)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_documents_org
  ON onboarding_documents (organisation_id, status, category);

-- Immutable once published. Bytes live behind the same storage abstraction as
-- pd_documents (db | local | blob) — never a public URL.
CREATE TABLE IF NOT EXISTS onboarding_document_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      UUID NOT NULL REFERENCES onboarding_documents(id) ON DELETE CASCADE,
  version          INTEGER NOT NULL CHECK (version >= 1),
  title            VARCHAR(250) NOT NULL,
  summary          VARCHAR(2000),
  -- Body text for Opal-authored policies that live as portal content rather
  -- than as an uploaded file. Sanitised on write; rendered as text.
  body             TEXT,
  file_name        VARCHAR(255),
  file_mime        VARCHAR(100),
  file_size_bytes  INTEGER,
  file_sha256      VARCHAR(64),
  storage_backend  VARCHAR(20) NOT NULL DEFAULT 'db'
                     CHECK (storage_backend IN ('db', 'local', 'blob')),
  storage_key      TEXT,
  file_data        TEXT,
  source_url       TEXT,
  -- The publisher's OWN version identifier, verbatim (e.g. "Last updated:
  -- July 2026"). Opal's `version` integer above orders our copies; this says
  -- which edition of the official document that copy actually is.
  source_version_label VARCHAR(120),
  source_last_modified TIMESTAMPTZ,
  effective_date   DATE,
  status           VARCHAR(20) NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'published', 'superseded')),
  change_note      VARCHAR(1000),
  published_by     UUID REFERENCES users(id),
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_onboarding_document_version UNIQUE (document_id, version)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_document_versions_doc
  ON onboarding_document_versions (document_id, version DESC);

-- compliance_requirements.stored_document_id points at a document; declared
-- after both tables exist so ordering inside one migration stays simple.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'compliance_requirements'
       AND constraint_name = 'fk_compliance_stored_document'
  ) THEN
    ALTER TABLE compliance_requirements
      ADD CONSTRAINT fk_compliance_stored_document
      FOREIGN KEY (stored_document_id) REFERENCES onboarding_documents(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── ZIP import staging ──────────────────────────────────────────────────────
-- Imported files land as DRAFT proposals. Nothing an import produces is
-- visible to an employee until the Owner confirms its classification.
CREATE TABLE IF NOT EXISTS onboarding_document_imports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID REFERENCES organisations(id),
  file_name        VARCHAR(255) NOT NULL,
  file_sha256      VARCHAR(64),
  size_bytes       BIGINT,
  entry_count      INTEGER NOT NULL DEFAULT 0,
  accepted_count   INTEGER NOT NULL DEFAULT 0,
  rejected_count   INTEGER NOT NULL DEFAULT 0,
  status           VARCHAR(20) NOT NULL DEFAULT 'scanned'
                     CHECK (status IN ('scanned', 'reviewing', 'applied', 'cancelled', 'failed')),
  error            VARCHAR(1000),
  uploaded_by      UUID REFERENCES users(id),
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_onboarding_document_imports_org
  ON onboarding_document_imports (organisation_id, status);

CREATE TABLE IF NOT EXISTS onboarding_document_import_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id               UUID NOT NULL REFERENCES onboarding_document_imports(id) ON DELETE CASCADE,
  entry_path              TEXT NOT NULL,
  file_name               VARCHAR(255) NOT NULL,
  file_mime               VARCHAR(100),
  size_bytes              BIGINT,
  file_sha256             VARCHAR(64),
  proposed_code           VARCHAR(80),
  proposed_title          VARCHAR(250),
  proposed_category       VARCHAR(40),
  proposed_classification VARCHAR(40),
  proposed_audience       VARCHAR(20),
  -- 'rejected' covers every safety refusal (traversal, MIME, size); the
  -- reason column keeps the refusal explainable to the Owner.
  decision                VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK (decision IN ('pending', 'accepted', 'rejected', 'duplicate')),
  reason                  VARCHAR(500),
  document_id             UUID REFERENCES onboarding_documents(id) ON DELETE SET NULL,
  document_version_id     UUID REFERENCES onboarding_document_versions(id) ON DELETE SET NULL,
  -- Extracted bytes held only until the Owner decides; cleared on apply/cancel.
  staged_data             TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_import_items_import
  ON onboarding_document_import_items (import_id, decision);

-- ═══════════════════════════════════════════════════════════════════════════
--  3. REQUIREMENT TEMPLATE LIBRARY — the reusable building blocks
-- ═══════════════════════════════════════════════════════════════════════════

-- `handler` is what the UI renders and what the API validates against; it is
-- the mechanism. `classification` is what the requirement IS in compliance
-- terms. They are separate because a single mechanism (upload + verify) serves
-- several classifications, and one classification (EMPLOYER_VERIFICATION) can
-- be reached by several mechanisms.
--
-- `applicability` is a JSONB rule evaluated against the assignment's facts:
--   { "all": [ { "fact": "employment_type", "op": "eq", "value": "casual" } ] }
-- Supported: all | any | not; ops eq | neq | in | not_in | is_true | is_false.
-- Rules live HERE, never in a frontend component.
CREATE TABLE IF NOT EXISTS onboarding_requirement_templates (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           UUID REFERENCES organisations(id),
  code                      VARCHAR(80)  NOT NULL,
  title                     VARCHAR(250) NOT NULL,
  summary                   VARCHAR(2000),
  -- Employee-facing instructions. Plain text; rendered escaped.
  instructions              TEXT,
  section                   VARCHAR(40)  NOT NULL
                              CHECK (section IN (
                                'welcome_employment', 'personal_details', 'payroll_tax_super',
                                'identity', 'professional', 'screening', 'ndis',
                                'policies', 'training', 'employer_compliance')),
  classification            VARCHAR(40)  NOT NULL
                              CHECK (classification IN (
                                'OFFICIAL_DOCUMENT', 'OFFICIAL_LIVE_SOURCE', 'OPAL_POLICY',
                                'OPAL_FORM', 'EMPLOYEE_UPLOAD', 'EMPLOYER_VERIFICATION',
                                'TRAINING_MODULE', 'ACKNOWLEDGEMENT', 'EMPLOYER_ONLY_COMPLIANCE')),
  handler                   VARCHAR(30)  NOT NULL
                              CHECK (handler IN (
                                'info', 'document_ack', 'form', 'upload',
                                'credential', 'training', 'live_source', 'employer_task')),
  actor                     VARCHAR(20)  NOT NULL DEFAULT 'employee'
                              CHECK (actor IN ('employee', 'employer', 'both', 'system')),
  -- Set when the employer must verify AFTER the employee has acted. Drives the
  -- second, independent progress meter on the Owner dashboard.
  requires_employer_verification BOOLEAN NOT NULL DEFAULT FALSE,
  form_key                  VARCHAR(40),
  credential_type           VARCHAR(60),
  document_id               UUID REFERENCES onboarding_documents(id) ON DELETE SET NULL,
  learning_workflow_id      UUID REFERENCES learning_workflows(id) ON DELETE SET NULL,
  external_url              TEXT,
  compliance_requirement_id UUID REFERENCES compliance_requirements(id) ON DELETE SET NULL,
  applicability             JSONB        NOT NULL DEFAULT '{}',
  config                    JSONB        NOT NULL DEFAULT '{}',
  default_mandatory         BOOLEAN      NOT NULL DEFAULT TRUE,
  default_blocks_activation BOOLEAN      NOT NULL DEFAULT FALSE,
  default_due_offset_days   INTEGER,
  -- Expiry rule: { "hasExpiry": true, "reminderDays": [90,60,30,7], "source": "credential" }
  expiry_rule               JSONB        NOT NULL DEFAULT '{}',
  sensitivity               VARCHAR(20)  NOT NULL DEFAULT 'standard'
                              CHECK (sensitivity IN ('standard', 'sensitive', 'restricted')),
  version                   INTEGER      NOT NULL DEFAULT 1 CHECK (version >= 1),
  status                    VARCHAR(20)  NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'archived')),
  sort_hint                 INTEGER      NOT NULL DEFAULT 0,
  is_system                 BOOLEAN      NOT NULL DEFAULT FALSE,
  created_by                UUID REFERENCES users(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_onboarding_req_template_code UNIQUE (organisation_id, code)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_req_templates_org
  ON onboarding_requirement_templates (organisation_id, status, section);

-- ═══════════════════════════════════════════════════════════════════════════
--  4. PACKAGES — masters, draft composition, immutable published versions
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS onboarding_packages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID REFERENCES organisations(id),
  code             VARCHAR(80)  NOT NULL,
  title            VARCHAR(200) NOT NULL,
  description      VARCHAR(1000),
  -- A base package is composed INTO others rather than assigned directly.
  kind             VARCHAR(20)  NOT NULL DEFAULT 'package'
                     CHECK (kind IN ('base', 'overlay', 'package')),
  role_category    VARCHAR(40),
  employment_type  VARCHAR(20)
                     CHECK (employment_type IS NULL OR employment_type IN
                       ('full_time', 'part_time', 'casual', 'fixed_term', 'contractor')),
  -- Packages this one inherits requirements from, in order. Base + overlays.
  extends_codes    JSONB        NOT NULL DEFAULT '[]',
  status           VARCHAR(20)  NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'published', 'superseded', 'archived')),
  current_version  INTEGER      NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  -- TRUE while the draft has changes not present in the newest published
  -- version; the builder shows "unpublished changes" from this.
  draft_dirty      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at      TIMESTAMPTZ,
  CONSTRAINT uq_onboarding_package_code UNIQUE (organisation_id, code)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_packages_org
  ON onboarding_packages (organisation_id, status);

-- Draft composition. Freely editable; publishing snapshots it.
CREATE TABLE IF NOT EXISTS onboarding_package_requirements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id        UUID NOT NULL REFERENCES onboarding_packages(id) ON DELETE CASCADE,
  template_id       UUID NOT NULL REFERENCES onboarding_requirement_templates(id) ON DELETE RESTRICT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  -- NULL = inherit the template default. Explicit values override it.
  mandatory         BOOLEAN,
  blocks_activation BOOLEAN,
  due_offset_days   INTEGER,
  condition         JSONB,
  note              VARCHAR(1000),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_onboarding_package_requirement UNIQUE (package_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_package_reqs_pkg
  ON onboarding_package_requirements (package_id, sort_order);

-- Immutable. `content` is the fully RESOLVED requirement list (inheritance
-- flattened, template config copied in), so a package version can be replayed
-- years later even if every template has since changed or been archived.
CREATE TABLE IF NOT EXISTS onboarding_package_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id       UUID NOT NULL REFERENCES onboarding_packages(id) ON DELETE CASCADE,
  version          INTEGER NOT NULL CHECK (version >= 1),
  title            VARCHAR(200) NOT NULL,
  description      VARCHAR(1000),
  role_category    VARCHAR(40),
  employment_type  VARCHAR(20),
  content          JSONB NOT NULL,
  requirement_count INTEGER NOT NULL DEFAULT 0,
  change_note      VARCHAR(1000),
  status           VARCHAR(20) NOT NULL DEFAULT 'published'
                     CHECK (status IN ('published', 'superseded')),
  published_by     UUID REFERENCES users(id),
  published_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at    TIMESTAMPTZ,
  CONSTRAINT uq_onboarding_package_version UNIQUE (package_id, version)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_package_versions_pkg
  ON onboarding_package_versions (package_id, version DESC);

-- ═══════════════════════════════════════════════════════════════════════════
--  5. ASSIGNMENTS — one person's onboarding run
-- ═══════════════════════════════════════════════════════════════════════════

-- `facts` is the frozen input to the rule engine (employment_type,
-- child_related_work, ndis_risk_assessed_role, provider_status …). Freezing it
-- is what makes an old assignment explainable: the requirement set can be
-- re-derived exactly, even after the organisation's NDIS status changes.
CREATE TABLE IF NOT EXISTS onboarding_assignments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID REFERENCES organisations(id),
  package_id            UUID NOT NULL REFERENCES onboarding_packages(id) ON DELETE RESTRICT,
  package_version_id    UUID NOT NULL REFERENCES onboarding_package_versions(id) ON DELETE RESTRICT,
  -- The pre-employee user. Created at release; retained after activation.
  user_id               UUID REFERENCES users(id) ON DELETE SET NULL,
  invite_id             UUID REFERENCES user_invites(id) ON DELETE SET NULL,

  applicant_name        VARCHAR(200) NOT NULL,
  applicant_email       VARCHAR(255) NOT NULL,
  job_title             VARCHAR(150),
  -- The portal role granted at activation. Never granted before.
  proposed_role         VARCHAR(20)  NOT NULL DEFAULT 'therapist'
                          CHECK (proposed_role IN ('owner', 'admin', 'therapist', 'read_only')),
  is_treating_therapist BOOLEAN      NOT NULL DEFAULT FALSE,
  employment_type       VARCHAR(20)  NOT NULL
                          CHECK (employment_type IN
                            ('full_time', 'part_time', 'casual', 'fixed_term', 'contractor')),
  role_category         VARCHAR(40),
  start_date            DATE,
  end_date              DATE,
  manager_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  work_location         VARCHAR(150),

  facts                 JSONB NOT NULL DEFAULT '{}',

  status                VARCHAR(30) NOT NULL DEFAULT 'created'
                          CHECK (status IN (
                            'created', 'invite_sent', 'invite_accepted', 'in_progress',
                            'employee_actions_complete', 'employer_review', 'corrections_required',
                            'ready_to_activate', 'activated', 'completed', 'cancelled', 'archived')),
  due_at                TIMESTAMPTZ,
  released_at           TIMESTAMPTZ,
  invite_accepted_at    TIMESTAMPTZ,
  submitted_at          TIMESTAMPTZ,
  activated_at          TIMESTAMPTZ,
  activated_by          UUID REFERENCES users(id),
  completed_at          TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  cancelled_by          UUID REFERENCES users(id),
  cancel_reason         VARCHAR(500),
  archived_at           TIMESTAMPTZ,
  last_activity_at      TIMESTAMPTZ,

  -- Two INDEPENDENT meters. The employee is never told they are incomplete
  -- because the employer has not finished verifying.
  employee_total        INTEGER NOT NULL DEFAULT 0 CHECK (employee_total >= 0),
  employee_done         INTEGER NOT NULL DEFAULT 0 CHECK (employee_done >= 0),
  employer_total        INTEGER NOT NULL DEFAULT 0 CHECK (employer_total >= 0),
  employer_done         INTEGER NOT NULL DEFAULT 0 CHECK (employer_done >= 0),
  blocking_total        INTEGER NOT NULL DEFAULT 0 CHECK (blocking_total >= 0),
  blocking_done         INTEGER NOT NULL DEFAULT 0 CHECK (blocking_done >= 0),

  owner_note            VARCHAR(2000),
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_assignments_org
  ON onboarding_assignments (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_onboarding_assignments_user
  ON onboarding_assignments (user_id, status);
CREATE INDEX IF NOT EXISTS idx_onboarding_assignments_pkg
  ON onboarding_assignments (package_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_assignments_due
  ON onboarding_assignments (due_at) WHERE status NOT IN ('activated', 'completed', 'cancelled', 'archived');

-- One live onboarding per email at a time. Finished runs stay forever and do
-- not block a genuine re-onboarding (a returning employee, a role change).
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_assignment_active_email
  ON onboarding_assignments (organisation_id, LOWER(applicant_email))
  WHERE status NOT IN ('activated', 'completed', 'cancelled', 'archived');

-- ── Per-assignment requirement instances ────────────────────────────────────
-- `snapshot` freezes the template exactly as issued (title, instructions,
-- config, document version, compliance source). Nothing rendered to the
-- employee or replayed in an audit is read from the live template.
CREATE TABLE IF NOT EXISTS onboarding_requirements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id            UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  organisation_id          UUID REFERENCES organisations(id),
  template_id              UUID REFERENCES onboarding_requirement_templates(id) ON DELETE SET NULL,
  template_code            VARCHAR(80)  NOT NULL,
  template_version         INTEGER      NOT NULL DEFAULT 1,

  title                    VARCHAR(250) NOT NULL,
  section                  VARCHAR(40)  NOT NULL,
  classification           VARCHAR(40)  NOT NULL,
  handler                  VARCHAR(30)  NOT NULL,
  actor                    VARCHAR(20)  NOT NULL DEFAULT 'employee',
  requires_employer_verification BOOLEAN NOT NULL DEFAULT FALSE,
  sensitivity              VARCHAR(20)  NOT NULL DEFAULT 'standard',
  sort_order               INTEGER      NOT NULL DEFAULT 0,
  mandatory                BOOLEAN      NOT NULL DEFAULT TRUE,
  blocks_activation        BOOLEAN      NOT NULL DEFAULT FALSE,

  status                   VARCHAR(30)  NOT NULL DEFAULT 'not_started'
                             CHECK (status IN (
                               'not_started', 'in_progress', 'submitted', 'awaiting_verification',
                               'correction_required', 'verified', 'complete', 'not_applicable', 'expired')),
  due_at                   TIMESTAMPTZ,

  -- Non-sensitive completion data only (which document version was read, the
  -- live source confirmed, a short free-text answer). Sensitive values live in
  -- the dedicated employee tables and are referenced, never copied here.
  data                     JSONB        NOT NULL DEFAULT '{}',
  snapshot                 JSONB        NOT NULL DEFAULT '{}',

  document_id              UUID REFERENCES pd_documents(id) ON DELETE SET NULL,
  credential_id            UUID REFERENCES credentials(id) ON DELETE SET NULL,
  learning_assignment_id   UUID REFERENCES learning_assignments(id) ON DELETE SET NULL,
  acknowledgement_id       UUID,

  started_at               TIMESTAMPTZ,
  submitted_at             TIMESTAMPTZ,
  submitted_by             UUID REFERENCES users(id),
  reviewed_by              UUID REFERENCES users(id),
  reviewed_at              TIMESTAMPTZ,
  review_decision          VARCHAR(30)
                             CHECK (review_decision IS NULL OR review_decision IN
                               ('approved', 'verified', 'rejected', 'correction_requested', 'not_applicable', 'waived')),
  review_reason            VARCHAR(1000),
  -- Owner override. A waiver relaxes an ORGANISATIONAL requirement; it can
  -- never turn a statutory verification status into "cleared".
  waived                   BOOLEAN      NOT NULL DEFAULT FALSE,
  waived_reason            VARCHAR(1000),
  waived_by                UUID REFERENCES users(id),
  waived_at                TIMESTAMPTZ,
  expires_at               DATE,
  completed_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_onboarding_requirement_code UNIQUE (assignment_id, template_code)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_requirements_assignment
  ON onboarding_requirements (assignment_id, section, sort_order);
CREATE INDEX IF NOT EXISTS idx_onboarding_requirements_status
  ON onboarding_requirements (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_onboarding_requirements_learning
  ON onboarding_requirements (learning_assignment_id) WHERE learning_assignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_onboarding_requirements_expiry
  ON onboarding_requirements (expires_at) WHERE expires_at IS NOT NULL;

-- Append-only history. Never carries a sensitive VALUE — only which field
-- changed and by whom.
CREATE TABLE IF NOT EXISTS onboarding_requirement_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id  UUID NOT NULL REFERENCES onboarding_requirements(id) ON DELETE CASCADE,
  assignment_id   UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  actor_user_id   UUID REFERENCES users(id),
  actor_role      VARCHAR(20),
  event_type      VARCHAR(40) NOT NULL,
  from_status     VARCHAR(30),
  to_status       VARCHAR(30),
  reason          VARCHAR(1000),
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_req_events_req
  ON onboarding_requirement_events (requirement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_req_events_assignment
  ON onboarding_requirement_events (assignment_id, created_at DESC);

-- ── Policy / document acknowledgements ──────────────────────────────────────
-- Pinned to an exact document VERSION. Superseding a policy never rewrites
-- what someone acknowledged; it creates a new requirement to acknowledge v2.
CREATE TABLE IF NOT EXISTS onboarding_acknowledgements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID REFERENCES organisations(id),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id           UUID NOT NULL REFERENCES onboarding_documents(id) ON DELETE RESTRICT,
  document_version_id   UUID NOT NULL REFERENCES onboarding_document_versions(id) ON DELETE RESTRICT,
  document_code         VARCHAR(80)  NOT NULL,
  document_title        VARCHAR(250) NOT NULL,
  document_version      INTEGER      NOT NULL,
  requirement_id        UUID REFERENCES onboarding_requirements(id) ON DELETE SET NULL,
  assignment_id         UUID REFERENCES onboarding_assignments(id) ON DELETE SET NULL,
  package_version_id    UUID REFERENCES onboarding_package_versions(id) ON DELETE SET NULL,
  -- The exact wording the person agreed to, hashed. Proves the statement text
  -- without storing a second copy that could drift from the document.
  statement_sha256      VARCHAR(64),
  typed_legal_name      VARCHAR(200),
  viewed_at             TIMESTAMPTZ,
  acknowledged_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address            VARCHAR(50),
  CONSTRAINT uq_onboarding_ack_once UNIQUE (user_id, document_version_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_acks_user
  ON onboarding_acknowledgements (user_id, acknowledged_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_acks_doc
  ON onboarding_acknowledgements (document_id, document_version);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'onboarding_requirements'
       AND constraint_name = 'fk_onboarding_req_acknowledgement'
  ) THEN
    ALTER TABLE onboarding_requirements
      ADD CONSTRAINT fk_onboarding_req_acknowledgement
      FOREIGN KEY (acknowledgement_id) REFERENCES onboarding_acknowledgements(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  6. EMPLOYEE DATA — split by permission tier, not by convenience
-- ═══════════════════════════════════════════════════════════════════════════

-- Tier 1 — employment arrangement. Visible with onboarding.view.
CREATE TABLE IF NOT EXISTS employment_profiles (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id           UUID REFERENCES organisations(id),
  assignment_id             UUID REFERENCES onboarding_assignments(id) ON DELETE SET NULL,
  job_title                 VARCHAR(150),
  employment_type           VARCHAR(20)
                              CHECK (employment_type IS NULL OR employment_type IN
                                ('full_time', 'part_time', 'casual', 'fixed_term', 'contractor')),
  role_category             VARCHAR(40),
  start_date                DATE,
  end_date                  DATE,
  probation_end_date        DATE,
  hours_per_week            NUMERIC(5,2),
  award_classification      VARCHAR(150),
  manager_user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  work_location             VARCHAR(150),

  -- Determinations. Never inferred from job title alone: each carries who
  -- decided, when, and why, because the answer drives statutory screening.
  child_related_work        VARCHAR(20) NOT NULL DEFAULT 'assessment_required'
                              CHECK (child_related_work IN ('yes', 'no', 'assessment_required')),
  child_related_work_reason VARCHAR(1000),
  ndis_risk_assessed_role   VARCHAR(30) NOT NULL DEFAULT 'requires_determination'
                              CHECK (ndis_risk_assessed_role IN ('yes', 'no', 'requires_determination')),
  ndis_risk_reason          VARCHAR(1000),
  mobile_community_role     BOOLEAN     NOT NULL DEFAULT FALSE,
  uses_own_vehicle          BOOLEAN     NOT NULL DEFAULT FALSE,
  determined_by             UUID REFERENCES users(id),
  determined_at             TIMESTAMPTZ,

  status                    VARCHAR(20) NOT NULL DEFAULT 'onboarding'
                              CHECK (status IN ('onboarding', 'active', 'ended')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employment_profiles_org
  ON employment_profiles (organisation_id, status);

-- Tier 2 — personal + emergency contact. Requires onboarding.review.
-- Deliberately narrow: no demographic data is collected that payroll,
-- emergency response or statutory identity checks do not actually need.
CREATE TABLE IF NOT EXISTS employee_personal_details (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id          UUID REFERENCES organisations(id),
  assignment_id            UUID REFERENCES onboarding_assignments(id) ON DELETE SET NULL,
  legal_first_name         VARCHAR(100),
  middle_name              VARCHAR(100),
  surname                  VARCHAR(100),
  preferred_name           VARCHAR(100),
  date_of_birth            DATE,
  personal_email           VARCHAR(255),
  mobile                   VARCHAR(40),
  address_line1            VARCHAR(200),
  address_line2            VARCHAR(200),
  suburb                   VARCHAR(100),
  state                    VARCHAR(10),
  postcode                 VARCHAR(10),
  country                  VARCHAR(60) DEFAULT 'Australia',
  postal_same_as_residential BOOLEAN NOT NULL DEFAULT TRUE,
  postal_line1             VARCHAR(200),
  postal_line2             VARCHAR(200),
  postal_suburb            VARCHAR(100),
  postal_state             VARCHAR(10),
  postal_postcode          VARCHAR(10),
  emergency_name           VARCHAR(150),
  emergency_relationship   VARCHAR(80),
  emergency_phone          VARCHAR(40),
  emergency_alt_phone      VARCHAR(40),
  completed_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tier 3 — payroll. Requires onboarding.payroll. Bank and TFN values are
-- ENCRYPTED at rest; the *_last4 / *_masked columns are the ONLY values any
-- response, export, log, notification or audit entry may contain.
CREATE TABLE IF NOT EXISTS payroll_profiles (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id          UUID REFERENCES organisations(id),
  assignment_id            UUID REFERENCES onboarding_assignments(id) ON DELETE SET NULL,

  -- ── Bank ────────────────────────────────────────────────────────────────
  account_holder_name      VARCHAR(200),
  bsb_encrypted            TEXT,
  bsb_masked               VARCHAR(12),
  account_number_encrypted TEXT,
  account_number_last4     VARCHAR(4),
  bank_status              VARCHAR(30) NOT NULL DEFAULT 'not_started'
                             CHECK (bank_status IN ('not_started', 'provided', 'verified')),
  bank_updated_at          TIMESTAMPTZ,

  -- ── Tax ─────────────────────────────────────────────────────────────────
  -- The ATO's current route is the employee's own online commencement form via
  -- myGov; the portal records the OUTCOME and only holds a TFN when the
  -- employee elects to supply one here.
  tax_setup_status         VARCHAR(30) NOT NULL DEFAULT 'not_started'
                             CHECK (tax_setup_status IN (
                               'not_started', 'employee_action_required', 'employee_completed',
                               'payroll_action_required', 'processed', 'exemption_recorded')),
  -- The ATO's stated order of preference is (1) the employer's own electronic
  -- form, (2) ATO online services via myGov, (3) the paper NAT 3092 — whose
  -- downloadable PDF has been withdrawn and must be ordered by phone. Paper is
  -- MANDATORY where the employee has no TFN or is exempt from quoting one, so
  -- the portal offers a route rather than assuming one.
  tax_submission_method    VARCHAR(30)
                             CHECK (tax_submission_method IS NULL OR tax_submission_method IN
                               ('employer_electronic_form', 'ato_online_services', 'paper_form', 'exemption')),
  -- Where the employee used ATO online services they print a summary and hand
  -- it over; the employer keys it in and retains it, and must NOT forward it
  -- to the ATO (the data already went electronically).
  tax_summary_document_id  UUID REFERENCES pd_documents(id) ON DELETE SET NULL,
  residency_status         VARCHAR(30)
                             CHECK (residency_status IS NULL OR residency_status IN
                               ('australian_resident', 'foreign_resident', 'working_holiday_maker')),
  tfn_encrypted            TEXT,
  tfn_last3                VARCHAR(3),
  tfn_provided             BOOLEAN NOT NULL DEFAULT FALSE,
  tfn_exemption_reason     VARCHAR(200),
  claims_tax_free_threshold BOOLEAN,
  has_study_loan           BOOLEAN,
  tax_updated_at           TIMESTAMPTZ,

  -- ── Superannuation ──────────────────────────────────────────────────────
  super_status             VARCHAR(30) NOT NULL DEFAULT 'not_started'
                             CHECK (super_status IN (
                               'not_started', 'employee_nominated', 'stapled_fund_required',
                               'stapled_fund_confirmed', 'default_fund_applied', 'payroll_configured')),
  super_choice_type        VARCHAR(20)
                             CHECK (super_choice_type IS NULL OR super_choice_type IN
                               ('apra_fund', 'smsf', 'employer_default', 'stapled')),
  -- APRA fund fields, exactly the set the Superannuation standard choice form
  -- (NAT 13080) requires: fund name, ABN, USI, member account number, and the
  -- name as it appears on the account (which may be a previous name).
  super_fund_name          VARCHAR(200),
  super_fund_abn           VARCHAR(20),
  super_fund_usi           VARCHAR(40),
  super_member_number      VARCHAR(60),
  super_account_name       VARCHAR(200),
  -- An SMSF has NO USI and NO member account number. It is identified by ABN +
  -- electronic service address, and contributions go to its bank account —
  -- which is why those columns exist and are encrypted.
  smsf_esa                 VARCHAR(80),
  smsf_bank_account_name   VARCHAR(200),
  smsf_bank_bsb_encrypted  TEXT,
  smsf_bank_bsb_masked     VARCHAR(12),
  smsf_bank_account_encrypted TEXT,
  smsf_bank_account_last4  VARCHAR(4),
  -- APRA: letter of compliance from the fund. SMSF: evidence from Super Fund
  -- Lookup that it is an ATO-regulated fund. The choice form requires one or
  -- the other, so the employer verification is incomplete without it.
  super_evidence_document_id UUID REFERENCES pd_documents(id) ON DELETE SET NULL,
  stapled_requested_at     TIMESTAMPTZ,
  stapled_confirmed_at     TIMESTAMPTZ,
  stapled_confirmed_by     UUID REFERENCES users(id),
  super_updated_at         TIMESTAMPTZ,

  -- ── Payroll handoff ─────────────────────────────────────────────────────
  payroll_setup_status     VARCHAR(30) NOT NULL DEFAULT 'not_required'
                             CHECK (payroll_setup_status IN
                               ('not_required', 'setup_required', 'exported', 'configured')),
  payroll_system           VARCHAR(40),
  payroll_employee_ref     VARCHAR(120),
  payroll_setup_at         TIMESTAMPTZ,
  payroll_setup_by         UUID REFERENCES users(id),

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by               UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_profiles_org
  ON payroll_profiles (organisation_id, payroll_setup_status);

-- Tier 4 — identity + right to work. Requires onboarding.sensitive_identity.
--
-- THIS TABLE IS DELIBERATELY BUILT AROUND SIGHTING, NOT SCANNING.
-- The instinctive HR-portal design — "upload a photo of your passport" — is
-- the wrong one here, and both regulators say so. Home Affairs, on its VEVO
-- for organisations page: "You do not need to keep a copy of the visa holder's
-- travel document"; what it asks employers to retain is the VEVO result PDF,
-- because that is what a compliance officer asks for on a field inspection.
-- The OAIC's identity-document guidance is the same in general terms: do not
-- scan or copy an ID where sighting it would be sufficient, and keep only the
-- extracted fields, what was done to verify, and the outcome.
--
-- So `document_id` (an uploaded copy) is OPTIONAL and its use must be
-- justified in `retention_reason`; the default flow records that a document
-- was sighted, by whom, and what the check returned. Retaining fewer copies
-- is both less to leak and less to destroy under APP 11.2.
--
-- There is also no automated VEVO lookup. Home Affairs offers no authorised
-- API for employer checks, so the record captures a HUMAN verification
-- honestly rather than implying a machine check that never happened.
CREATE TABLE IF NOT EXISTS employee_identity_records (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id           UUID REFERENCES organisations(id),
  assignment_id             UUID REFERENCES onboarding_assignments(id) ON DELETE SET NULL,
  requirement_id            UUID REFERENCES onboarding_requirements(id) ON DELETE SET NULL,
  record_kind               VARCHAR(20) NOT NULL DEFAULT 'identity'
                              CHECK (record_kind IN ('identity', 'right_to_work')),
  evidence_type             VARCHAR(40) NOT NULL
                              CHECK (evidence_type IN (
                                'australian_passport', 'foreign_passport', 'citizenship_certificate',
                                'birth_certificate', 'permanent_residency', 'visa',
                                'immicard', 'drivers_licence', 'medicare_card', 'other')),
  -- The five inputs an EMPLOYER VEVO check actually takes: name as shown on
  -- the travel document, date of birth (held on the personal-details record),
  -- travel document type, travel document number, and country of document.
  -- Note this is NOT the visa grant number / TRN — those are what a visa
  -- HOLDER uses to check their own record, and building the employer flow
  -- around them would model the wrong path entirely.
  name_on_document          VARCHAR(200),
  travel_document_type      VARCHAR(40),
  document_number_encrypted TEXT,
  document_number_last4     VARCHAR(4),
  country_of_issue          VARCHAR(60),
  issue_date                DATE,
  expiry_date               DATE,
  -- Sighting record — the DEFAULT evidence.
  sighted_by                UUID REFERENCES users(id),
  sighted_at                TIMESTAMPTZ,
  -- A retained copy is the exception. Both columns move together: a copy
  -- without a stated reason is a finding, not a record.
  document_id               UUID REFERENCES pd_documents(id) ON DELETE SET NULL,
  copy_retained             BOOLEAN NOT NULL DEFAULT FALSE,
  retention_reason          VARCHAR(500),

  right_to_work_basis       VARCHAR(30)
                              CHECK (right_to_work_basis IS NULL OR right_to_work_basis IN
                                ('citizen', 'permanent_resident', 'nz_citizen', 'visa_with_work_rights', 'other')),
  visa_subclass             VARCHAR(20),
  work_conditions           VARCHAR(500),
  work_rights_expiry        DATE,
  -- The artefact Home Affairs asks employers to keep.
  vevo_result_document_id   UUID REFERENCES pd_documents(id) ON DELETE SET NULL,
  vevo_check_reference      VARCHAR(200),
  -- Home Affairs OPERATIONAL GUIDANCE (not a statutory deadline) suggests
  -- re-checking temporary visa holders periodically. Stored per record so the
  -- expiry engine can prompt without the code asserting a legal timeframe.
  next_recheck_due          DATE,

  verification_status       VARCHAR(30) NOT NULL DEFAULT 'not_verified'
                              CHECK (verification_status IN (
                                'not_verified', 'verification_required', 'verified', 'failed', 'expired')),
  verification_method       VARCHAR(40)
                              CHECK (verification_method IS NULL OR verification_method IN
                                ('vevo_online', 'document_sighted', 'certified_copy', 'other')),
  verification_reference    VARCHAR(200),
  verified_by               UUID REFERENCES users(id),
  verified_at               TIMESTAMPTZ,
  notes                     VARCHAR(1000),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_identity_user
  ON employee_identity_records (user_id, record_kind);
CREATE INDEX IF NOT EXISTS idx_employee_identity_expiry
  ON employee_identity_records (work_rights_expiry) WHERE work_rights_expiry IS NOT NULL;

-- ── Statutory statement issuance ledger ─────────────────────────────────────
-- Evidence that a required information statement was given, which version, by
-- what method and when.
--
-- This is a SEPARATE table from onboarding_acknowledgements for two reasons.
-- First, the obligation is on the EMPLOYER to GIVE the statement — an employee
-- acknowledgement is Opal's own evidentiary control, not a statutory
-- requirement, and conflating them would present a house rule as law. Second,
-- these obligations RECUR: the Casual Employment Information Statement must be
-- re-issued at 6 and 12 months and annually thereafter (12-monthly for a small
-- business employer), and the Fixed Term Contract Information Statement fires
-- again on every new or renewed fixed term contract. A one-row-per-onboarding
-- model would put the employer in breach from month six.
CREATE TABLE IF NOT EXISTS onboarding_statement_issuances (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID REFERENCES organisations(id),
  user_id               UUID REFERENCES users(id) ON DELETE CASCADE,
  assignment_id         UUID REFERENCES onboarding_assignments(id) ON DELETE SET NULL,
  requirement_id        UUID REFERENCES onboarding_requirements(id) ON DELETE SET NULL,
  statement_code        VARCHAR(40) NOT NULL,
  -- Verbatim publisher version string, e.g. "Last updated: July 2026".
  source_version_label  VARCHAR(120),
  file_sha256           VARCHAR(64),
  document_version_id   UUID REFERENCES onboarding_document_versions(id) ON DELETE SET NULL,
  -- Which occurrence this is: 'commencement', or the recurrence milestone.
  trigger_kind          VARCHAR(30) NOT NULL DEFAULT 'commencement'
                          CHECK (trigger_kind IN (
                            'commencement', 'recurring_6_month', 'recurring_12_month',
                            'recurring_annual', 'new_contract', 'manual')),
  trigger_due_at        DATE,
  delivery_method       VARCHAR(40)
                          CHECK (delivery_method IS NULL OR delivery_method IN (
                            'portal', 'in_person', 'mail', 'email', 'email_link',
                            'intranet_link', 'fax', 'other')),
  -- The FTCIS may be delivered electronically ONLY if the employee agrees.
  -- Recorded per issuance so a later audit can show the agreement existed.
  electronic_delivery_agreed BOOLEAN,
  issued_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by             UUID REFERENCES users(id),
  acknowledged_at       TIMESTAMPTZ,
  notes                 VARCHAR(1000)
);

CREATE INDEX IF NOT EXISTS idx_statement_issuances_user
  ON onboarding_statement_issuances (user_id, statement_code, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_statement_issuances_org
  ON onboarding_statement_issuances (organisation_id, statement_code);
CREATE INDEX IF NOT EXISTS idx_statement_issuances_due
  ON onboarding_statement_issuances (trigger_due_at) WHERE trigger_due_at IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
--  7. EMPLOYER-ONLY COMPLIANCE + EXPIRY ENGINE
-- ═══════════════════════════════════════════════════════════════════════════

-- Workers compensation, public liability, organisational professional
-- indemnity, NDIS registration. These are EMPLOYER obligations — no employee
-- is ever asked to upload them.
CREATE TABLE IF NOT EXISTS organisation_compliance_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID REFERENCES organisations(id),
  record_type           VARCHAR(50) NOT NULL
                          CHECK (record_type IN (
                            'workers_compensation', 'public_liability', 'professional_indemnity',
                            'ndis_registration', 'cyber_liability', 'management_liability', 'other')),
  title                 VARCHAR(200) NOT NULL,
  provider              VARCHAR(200),
  policy_number         VARCHAR(120),
  coverage_amount_cents BIGINT,
  effective_date        DATE,
  expiry_date           DATE,
  document_id           UUID REFERENCES onboarding_documents(id) ON DELETE SET NULL,
  status                VARCHAR(20) NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'expiring', 'expired', 'archived')),
  reminder_days         JSONB NOT NULL DEFAULT '[90, 60, 30, 7]',
  verified_by           UUID REFERENCES users(id),
  verified_at           TIMESTAMPTZ,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_compliance_org
  ON organisation_compliance_records (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_org_compliance_expiry
  ON organisation_compliance_records (expiry_date);

-- Dedupe ledger. One row per (subject, window) so a daily sweep cannot send
-- the same 30-day warning twice, and a restart cannot replay yesterday's.
CREATE TABLE IF NOT EXISTS compliance_expiry_notices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id),
  subject_type    VARCHAR(30) NOT NULL
                    CHECK (subject_type IN (
                      'credential', 'identity_record', 'org_record', 'requirement',
                      -- Recurring statutory re-issue (the CEIS cadence), which
                      -- is a due date rather than an expiry but needs the same
                      -- send-once-per-window guarantee.
                      'statement_reissue')),
  subject_id      UUID NOT NULL,
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  expiry_date     DATE NOT NULL,
  window_days     INTEGER NOT NULL,
  severity        VARCHAR(10) NOT NULL DEFAULT 'warning'
                    CHECK (severity IN ('info', 'warning', 'error')),
  notified_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_expiry_notice_once UNIQUE (subject_type, subject_id, expiry_date, window_days)
);

CREATE INDEX IF NOT EXISTS idx_expiry_notices_org
  ON compliance_expiry_notices (organisation_id, notified_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
--  8. EXTENSIONS TO EXISTING MODELS — reuse rather than duplicate
-- ═══════════════════════════════════════════════════════════════════════════

-- ── credentials ─────────────────────────────────────────────────────────────
-- `status` stays the RECORD state (the existing vocabulary). `lifecycle_status`
-- is the STATUTORY state as the issuing authority reports it, and the two must
-- never be conflated: an Owner may waive an Opal requirement, but nothing in
-- this system may turn "excluded" into "cleared".
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS jurisdiction            VARCHAR(20);
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS lifecycle_status        VARCHAR(40);
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS verification_method     VARCHAR(40);
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS verification_reference  VARCHAR(200);
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS detail                  JSONB NOT NULL DEFAULT '{}';
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS source                  VARCHAR(20) DEFAULT 'profile';
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS onboarding_requirement_id UUID;
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS reminder_days           JSONB NOT NULL DEFAULT '[90, 60, 30, 7]';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'credentials' AND constraint_name = 'fk_credentials_onboarding_requirement'
  ) THEN
    ALTER TABLE credentials
      ADD CONSTRAINT fk_credentials_onboarding_requirement
      FOREIGN KEY (onboarding_requirement_id) REFERENCES onboarding_requirements(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'credentials' AND constraint_name = 'credentials_lifecycle_status_check'
  ) THEN
    -- Vocabulary mirrors the ISSUING AUTHORITIES rather than being flattened
    -- into a generic pass/fail, because the difference between "interim bar"
    -- and "exclusion" is the difference between a pause and a prohibition.
    --
    -- The NDIS Worker Screening Database publishes exactly six statuses:
    -- Clearance, Pending, Interim bar, Exclusion, Suspension, No valid
    -- clearance. Note that "expired" is NOT one of them — expiry is DERIVED
    -- from the expiry date field, and modelling it as a peer status would
    -- misrepresent what the database actually says about a worker.
    -- 'expired' below therefore exists for the credentials that really do
    -- expire as a state (a driver's licence, a WWCC card), not for screening.
    ALTER TABLE credentials ADD CONSTRAINT credentials_lifecycle_status_check
      CHECK (lifecycle_status IS NULL OR lifecycle_status IN (
        -- workflow states before any authority has spoken
        'not_required', 'requirement_pending_determination', 'application_required',
        'application_pending', 'employer_verification_required', 'not_verified',
        -- NDIS Worker Screening Database vocabulary, verbatim
        'clearance', 'pending', 'interim_bar', 'exclusion', 'suspension', 'no_valid_clearance',
        -- generic credential lifecycle (Ahpra, WWCC, licences, insurance)
        'current', 'conditions_apply', 'suspended', 'cancelled', 'expired',
        -- Ahpra renewal falls due 30 November; between 1 and 31 December a
        -- practitioner may legitimately show "Registered" with a past expiry
        -- date while their renewal is assessed. Naive expiry logic would flag
        -- a compliant clinician as lapsed, so the late period is its own state.
        'renewal_late_period', 'lapsed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_credentials_lifecycle
  ON credentials (organisation_id, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_credentials_onboarding_req
  ON credentials (onboarding_requirement_id) WHERE onboarding_requirement_id IS NOT NULL;

-- ── pd_documents ────────────────────────────────────────────────────────────
-- Employee evidence uploaded through onboarding is the SAME kind of object as
-- a CPD certificate, so it reuses this table (and therefore its private
-- download route and storage abstraction) rather than a parallel store.
ALTER TABLE pd_documents ADD COLUMN IF NOT EXISTS onboarding_requirement_id UUID;
ALTER TABLE pd_documents ADD COLUMN IF NOT EXISTS onboarding_assignment_id  UUID;
ALTER TABLE pd_documents ADD COLUMN IF NOT EXISTS sensitivity VARCHAR(20) NOT NULL DEFAULT 'standard';
ALTER TABLE pd_documents ADD COLUMN IF NOT EXISTS file_sha256 VARCHAR(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'pd_documents' AND constraint_name = 'fk_pd_documents_onboarding_requirement'
  ) THEN
    ALTER TABLE pd_documents
      ADD CONSTRAINT fk_pd_documents_onboarding_requirement
      FOREIGN KEY (onboarding_requirement_id) REFERENCES onboarding_requirements(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'pd_documents' AND constraint_name = 'fk_pd_documents_onboarding_assignment'
  ) THEN
    ALTER TABLE pd_documents
      ADD CONSTRAINT fk_pd_documents_onboarding_assignment
      FOREIGN KEY (onboarding_assignment_id) REFERENCES onboarding_assignments(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'pd_documents' AND constraint_name = 'pd_documents_sensitivity_check'
  ) THEN
    ALTER TABLE pd_documents ADD CONSTRAINT pd_documents_sensitivity_check
      CHECK (sensitivity IN ('standard', 'sensitive', 'restricted'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pd_documents_onboarding_req
  ON pd_documents (onboarding_requirement_id) WHERE onboarding_requirement_id IS NOT NULL;

-- ── user_invites ────────────────────────────────────────────────────────────
-- The pre-employee role joins the invite vocabulary, and an invite can now be
-- tied to the onboarding run it was issued for.
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS onboarding_assignment_id UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'user_invites' AND constraint_type = 'CHECK'
       AND constraint_name = 'user_invites_role_check_v2'
  ) THEN
    ALTER TABLE user_invites DROP CONSTRAINT user_invites_role_check_v2;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'user_invites' AND constraint_type = 'CHECK'
       AND constraint_name = 'user_invites_role_check'
  ) THEN
    ALTER TABLE user_invites DROP CONSTRAINT user_invites_role_check;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'user_invites' AND constraint_type = 'CHECK'
       AND constraint_name = 'user_invites_role_check_v3'
  ) THEN
    ALTER TABLE user_invites ADD CONSTRAINT user_invites_role_check_v3
      CHECK (role IN ('owner', 'admin', 'therapist', 'read_only', 'pre_employee'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'user_invites' AND constraint_name = 'fk_user_invites_onboarding_assignment'
  ) THEN
    ALTER TABLE user_invites
      ADD CONSTRAINT fk_user_invites_onboarding_assignment
      FOREIGN KEY (onboarding_assignment_id) REFERENCES onboarding_assignments(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_invites_onboarding_assignment
  ON user_invites (onboarding_assignment_id) WHERE onboarding_assignment_id IS NOT NULL;

-- ── users ───────────────────────────────────────────────────────────────────
-- users.role is VARCHAR(20) with no CHECK constraint, so 'pre_employee' needs
-- no DDL. This column records the moment a pre-employee became staff, which
-- the activation path asserts on to guarantee it never runs twice.
ALTER TABLE users ADD COLUMN IF NOT EXISTS activated_from_onboarding_at TIMESTAMPTZ;
