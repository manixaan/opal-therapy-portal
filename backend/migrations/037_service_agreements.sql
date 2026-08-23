-- ═══════════════════════════════════════════════════════════════════════════
--  037 — Service Agreements
--
--  The Resource Hub's third document workflow, after the FCA report (018) and
--  the progress-note letter (020). It reuses the shared DOCX engine, the
--  scalar resolver, the document-reference convention, the storage abstraction,
--  the email adapter and the ONE canonical audit_logs table.
--
--  ── WHY NEW TABLES, WHEN 020 SAID NOT TO ──────────────────────────────────
--  020 added a second document type to fca_templates / fca_report_drafts and
--  said, correctly, that parallel tables would mean parallel RBAC and two
--  places to get the frozen-snapshot rule wrong. That reasoning still holds and
--  is why this migration does NOT create a second audit table, a second
--  storage abstraction or a second permission system.
--
--  It does create new tables, because a service agreement is not a variant of
--  a report — it is a different KIND of object with three properties the FCA
--  tables have no way to express:
--
--    1. A master with a real lifecycle: draft → validated → published →
--       retired, many versions, exactly one current. fca_templates has a
--       single is_active flag and a trigger that freezes the row; there is
--       nowhere to put a draft, a validation result or a clause snapshot.
--    2. An instance with EIGHT states and a counterparty. A report is drafted
--       then generated. An agreement is issued, viewed, partly completed,
--       completed, signed — or expired, revoked or voided.
--    3. An external signatory. No existing table has a token, an expiry, a
--       recipient or a consent record, because until now nothing in this
--       portal was ever sent to somebody who does not have a login.
--
--  Forcing those onto fca_report_drafts would mean a dozen nullable columns
--  that mean nothing for a report and a status CHECK that no longer describes
--  either document type. The shared thing is the ENGINE, not the row shape.
--
--  ── IMMUTABILITY ──────────────────────────────────────────────────────────
--  Publishing never overwrites. A published master version row is frozen by a
--  trigger, exactly as fca_templates is (018), so an agreement issued last
--  month reproduces byte-for-byte next year. Every instance pins the master
--  version id, the template hash, the clause snapshot, the organisation
--  snapshot, the pricing snapshot and the field-source manifest at ISSUE time.
--  Publishing a new master therefore affects future agreements only.
--
--  ── PARTICIPANTS ──────────────────────────────────────────────────────────
--  participant_client_id is TEXT: it is a Splose identifier, not a local
--  foreign key, and there is still no clients table in this database (018:126,
--  021:32). The participant's name and contact details are denormalised onto
--  the instance so an issued agreement stays readable and reproducible when
--  Splose is unreachable — and, more importantly, so that an agreement records
--  what it said WHEN IT WAS SIGNED rather than what Splose says today.
--
--  ── ORGANISATION IDENTITY ─────────────────────────────────────────────────
--  No table is added for the provider's legal identity. It belongs to the
--  organisation, it is owner-controlled, and org_settings.settings already is
--  the owner-controlled organisation store with an owner-only PATCH allowlist
--  (app-routes.js). This migration adds nothing there; the route layer widens
--  the allowlist with a `serviceAgreement` key. What IS stored here is the
--  SNAPSHOT of those values at issue time, which is a different fact.
--
--  Additive only. No existing table is altered.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
--  1. Master template versions
-- ───────────────────────────────────────────────────────────────────────────
--
--  One row per version of the master Word document. `status` is the lifecycle;
--  `superseded_version_id` chains a version to the one it replaced, so the
--  history reads in either direction.
--
--  tag_manifest    JSONB {scalars:{tag:count}, blocks:{tag:count}, custom:[],
--                         unknown:[]} — the validator's own output, stored so a
--                         later reviewer sees what was checked, not just that
--                         something was.
--  clause_snapshot JSONB {clauses:[{tag,label,enabled,order,body?}],
--                         custom:[{tag,title,body,order}]} — the owner's clause
--                         configuration AT PUBLICATION. An instance pins this,
--                         so editing a clause tomorrow cannot alter a document
--                         issued today.
--  validation      JSONB the full report {ok,sha256,counts,errors,warnings}.

CREATE TABLE IF NOT EXISTS service_agreement_master_versions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id        UUID REFERENCES organisations(id) ON DELETE CASCADE,
  template_key           VARCHAR(40)  NOT NULL DEFAULT 'service_agreement',
  version_label          VARCHAR(20)  NOT NULL,
  name                   TEXT         NOT NULL,

  status                 VARCHAR(20)  NOT NULL DEFAULT 'draft',

  storage_backend        VARCHAR(20)  NOT NULL DEFAULT 'db',
  storage_key            TEXT,
  file_data              TEXT,
  byte_size              INTEGER      NOT NULL,
  source_sha256          VARCHAR(64)  NOT NULL,

  preview_pdf_backend    VARCHAR(20),
  preview_pdf_key        TEXT,
  preview_pdf_data       TEXT,

  tag_manifest           JSONB        NOT NULL DEFAULT '{}'::jsonb,
  clause_snapshot        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  organisation_snapshot  JSONB        NOT NULL DEFAULT '{}'::jsonb,
  validation             JSONB        NOT NULL DEFAULT '{}'::jsonb,

  superseded_version_id  UUID REFERENCES service_agreement_master_versions(id) ON DELETE SET NULL,

  created_by_user_id     UUID REFERENCES users(id),
  published_by_user_id   UUID REFERENCES users(id),
  retired_by_user_id     UUID REFERENCES users(id),

  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  validated_at           TIMESTAMPTZ,
  published_at           TIMESTAMPTZ,
  retired_at             TIMESTAMPTZ,

  CONSTRAINT valid_sa_master_status
    CHECK (status IN ('draft', 'validated', 'published', 'retired')),
  CONSTRAINT valid_sa_master_size   CHECK (byte_size > 0),
  CONSTRAINT valid_sa_master_bytes  CHECK (file_data IS NOT NULL OR storage_key IS NOT NULL),
  CONSTRAINT valid_sa_master_sha    CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT valid_sa_master_manifest CHECK (jsonb_typeof(tag_manifest) = 'object'),
  CONSTRAINT valid_sa_master_clauses  CHECK (jsonb_typeof(clause_snapshot) = 'object'),
  CONSTRAINT valid_sa_master_org      CHECK (jsonb_typeof(organisation_snapshot) = 'object'),
  CONSTRAINT valid_sa_master_validation CHECK (jsonb_typeof(validation) = 'object'),
  -- A published version must record who published it and when. Without this a
  -- row could reach 'published' with no accountable person on it.
  CONSTRAINT valid_sa_master_published_by
    CHECK (status <> 'published' OR (published_by_user_id IS NOT NULL AND published_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sa_master_version
  ON service_agreement_master_versions (organisation_id, template_key, version_label);

-- EXACTLY ONE current published master per organisation and template scope.
-- Enforced in the schema, not in a route: two published masters would mean the
-- next agreement issued is decided by ORDER BY, which is not a decision
-- anybody made.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sa_master_one_published
  ON service_agreement_master_versions (organisation_id, template_key)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_sa_master_org_status
  ON service_agreement_master_versions (organisation_id, status, published_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
--  2. Agreement instances
-- ───────────────────────────────────────────────────────────────────────────
--
--  form_data      JSONB {tag: value} for every portal-authority scalar, plus
--                 `supports: [{...}]`. The wizard's autosave target.
--  field_sources  JSONB {tag: 'splose'|'profile'|'plan'|'org'|'user'|'manual'
--                        |'server'|'esign'} — where each value came from. It is
--                 what lets the review step say "we filled this in, you typed
--                 that", and it is frozen with the rest at issue.
--  support_rows   JSONB [{tag: value}] one entry per agreed support.
--  *_snapshot     frozen at ISSUE. Before issue they are empty and the live
--                 sources are read; after issue nothing re-reads anything.

CREATE TABLE IF NOT EXISTS service_agreements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,

  reference                VARCHAR(40),

  participant_client_id    TEXT NOT NULL,
  participant_name         TEXT,
  participant_preferred_name TEXT,
  participant_email        TEXT,
  representative_name      TEXT,
  representative_email     TEXT,

  master_version_id        UUID REFERENCES service_agreement_master_versions(id),
  master_sha256            VARCHAR(64),
  master_version_label     VARCHAR(20),

  state                    VARCHAR(30) NOT NULL DEFAULT 'draft',
  completion_mode          VARCHAR(20) NOT NULL DEFAULT 'portal',

  form_data                JSONB NOT NULL DEFAULT '{}'::jsonb,
  field_sources            JSONB NOT NULL DEFAULT '{}'::jsonb,
  support_rows             JSONB NOT NULL DEFAULT '[]'::jsonb,
  clause_snapshot          JSONB NOT NULL DEFAULT '{}'::jsonb,
  organisation_snapshot    JSONB NOT NULL DEFAULT '{}'::jsonb,
  pricing_snapshot         JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_fields           JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_by_user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_by_user_id       UUID REFERENCES users(id),
  issued_by_user_id        UUID REFERENCES users(id),

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_at                TIMESTAMPTZ,
  first_viewed_at          TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  signed_at                TIMESTAMPTZ,
  voided_at                TIMESTAMPTZ,
  void_reason              VARCHAR(500),

  CONSTRAINT valid_sa_state CHECK (state IN (
    'draft', 'ready', 'issued', 'viewed', 'partially_completed',
    'completed', 'signed', 'expired', 'revoked', 'void'
  )),
  CONSTRAINT valid_sa_completion_mode CHECK (completion_mode IN ('portal', 'manual')),
  CONSTRAINT valid_sa_form_data     CHECK (jsonb_typeof(form_data) = 'object'),
  CONSTRAINT valid_sa_field_sources CHECK (jsonb_typeof(field_sources) = 'object'),
  CONSTRAINT valid_sa_support_rows  CHECK (jsonb_typeof(support_rows) = 'array'),
  CONSTRAINT valid_sa_clauses       CHECK (jsonb_typeof(clause_snapshot) = 'object'),
  CONSTRAINT valid_sa_org_snapshot  CHECK (jsonb_typeof(organisation_snapshot) = 'object'),
  CONSTRAINT valid_sa_pricing       CHECK (jsonb_typeof(pricing_snapshot) = 'object'),
  CONSTRAINT valid_sa_missing       CHECK (jsonb_typeof(missing_fields) = 'array'),
  CONSTRAINT valid_sa_master_sha    CHECK (master_sha256 IS NULL OR master_sha256 ~ '^[0-9a-f]{64}$'),
  -- An issued agreement is pinned. Reaching any post-issue state without a
  -- master version and hash means the pin was skipped, and the document could
  -- not be reproduced.
  --
  -- 'void' is exempt alongside the pre-issue states because voiding is also
  -- how an ABANDONED DRAFT is retired — one that was never issued and so has
  -- nothing to pin. An agreement that WAS issued keeps its pin through the
  -- transition regardless: the immutability trigger refuses to clear it.
  CONSTRAINT valid_sa_issued_is_pinned CHECK (
    state IN ('draft', 'ready', 'void')
    OR (master_version_id IS NOT NULL AND master_sha256 IS NOT NULL AND issued_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_sa_org_state
  ON service_agreements (organisation_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sa_org_participant
  ON service_agreements (organisation_id, participant_client_id);
CREATE INDEX IF NOT EXISTS idx_sa_created_by
  ON service_agreements (created_by_user_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sa_reference
  ON service_agreements (organisation_id, reference) WHERE reference IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
--  3. Generated artifacts
-- ───────────────────────────────────────────────────────────────────────────
--
--  Every file the workflow produces, kept rather than regenerated. An agreement
--  that was signed must be reproducible EXACTLY, and "regenerate it from the
--  snapshot" is a promise about code that may since have changed.
--
--  kind:  draft_pdf     a working fillable PDF, superseded freely
--         issued_pdf    the fillable PDF actually sent or downloaded
--         issued_docx   owner-only Word copy of the instance
--         final_pdf     the locked, completed agreement
--         returned_pdf  a completed PDF a participant sent back
--         master_docx   an owner's download of the master itself
--         master_pdf    the master's PDF preview

CREATE TABLE IF NOT EXISTS service_agreement_artifacts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id        UUID REFERENCES service_agreements(id) ON DELETE CASCADE,
  master_version_id   UUID REFERENCES service_agreement_master_versions(id) ON DELETE CASCADE,

  kind                VARCHAR(30) NOT NULL,
  filename            TEXT NOT NULL,
  mime_type           VARCHAR(120) NOT NULL,

  storage_backend     VARCHAR(20) NOT NULL DEFAULT 'db',
  storage_key         TEXT,
  file_data           TEXT,
  byte_size           INTEGER NOT NULL,
  checksum_sha256     VARCHAR(64) NOT NULL,

  page_count          INTEGER,
  field_count         INTEGER,
  audience            VARCHAR(20) NOT NULL DEFAULT 'participant',

  created_by_user_id  UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_sa_artifact_kind CHECK (kind IN (
    'draft_pdf', 'issued_pdf', 'issued_docx', 'final_pdf',
    'returned_pdf', 'master_docx', 'master_pdf'
  )),
  CONSTRAINT valid_sa_artifact_audience CHECK (audience IN ('participant', 'internal', 'owner')),
  CONSTRAINT valid_sa_artifact_size  CHECK (byte_size > 0),
  CONSTRAINT valid_sa_artifact_bytes CHECK (file_data IS NOT NULL OR storage_key IS NOT NULL),
  CONSTRAINT valid_sa_artifact_sha   CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  -- Every artifact belongs to exactly one of an agreement or a master version.
  CONSTRAINT valid_sa_artifact_owner CHECK (
    (agreement_id IS NOT NULL AND master_version_id IS NULL)
    OR (agreement_id IS NULL AND master_version_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_sa_artifacts_agreement
  ON service_agreement_artifacts (agreement_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sa_artifacts_master
  ON service_agreement_artifacts (master_version_id, kind, created_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
--  4. Signing sessions
-- ───────────────────────────────────────────────────────────────────────────
--
--  The one place in this portal that grants access to somebody without a
--  login, which is why every column here is a constraint on that access.
--
--  token_sha256   the SHA-256 of the token. The token ITSELF is never stored:
--                 a database copy would be a bearer credential at rest, and
--                 the link is already in the recipient's inbox. Lookup hashes
--                 the presented token and compares.
--  recipient_email  the token is bound to it. A link forwarded to somebody
--                 else still asks for the address it was issued to.
--  assigned_tags  exactly which fields this session may write. Not "the
--                 participant fields" as a category resolved at request time —
--                 the list, frozen, so widening the category later cannot
--                 retroactively widen a live session.

CREATE TABLE IF NOT EXISTS service_agreement_signing_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id          UUID NOT NULL REFERENCES service_agreements(id) ON DELETE CASCADE,
  organisation_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,

  token_sha256          VARCHAR(64) NOT NULL,
  signatory_type        VARCHAR(30) NOT NULL,
  recipient_email       TEXT NOT NULL,
  recipient_name        TEXT,

  assigned_tags         JSONB NOT NULL DEFAULT '[]'::jsonb,

  status                VARCHAR(20) NOT NULL DEFAULT 'pending',
  verification_state    VARCHAR(20) NOT NULL DEFAULT 'unverified',
  verification_attempts INTEGER NOT NULL DEFAULT 0,

  consent_electronic    BOOLEAN NOT NULL DEFAULT FALSE,
  consent_recorded_at   TIMESTAMPTZ,

  signature_name        TEXT,
  signature_capacity    TEXT,
  signature_intent      BOOLEAN NOT NULL DEFAULT FALSE,
  signature_metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,

  final_document_sha256 VARCHAR(64),

  expires_at            TIMESTAMPTZ NOT NULL,
  issued_by_user_id     UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_viewed_at       TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  revoked_at            TIMESTAMPTZ,
  revoked_by_user_id    UUID REFERENCES users(id),

  CONSTRAINT valid_sa_session_type
    CHECK (signatory_type IN ('participant', 'representative', 'witness')),
  CONSTRAINT valid_sa_session_status
    CHECK (status IN ('pending', 'viewed', 'in_progress', 'completed', 'expired', 'revoked')),
  CONSTRAINT valid_sa_session_verification
    CHECK (verification_state IN ('unverified', 'verified', 'failed')),
  CONSTRAINT valid_sa_session_token   CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT valid_sa_session_tags    CHECK (jsonb_typeof(assigned_tags) = 'array'),
  CONSTRAINT valid_sa_session_meta    CHECK (jsonb_typeof(signature_metadata) = 'object'),
  CONSTRAINT valid_sa_session_final_sha
    CHECK (final_document_sha256 IS NULL OR final_document_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sa_session_token
  ON service_agreement_signing_sessions (token_sha256);
CREATE INDEX IF NOT EXISTS idx_sa_sessions_agreement
  ON service_agreement_signing_sessions (agreement_id, created_at DESC);
-- At most ONE live session per agreement per signatory type. Two live links
-- for the same person is two documents that can be signed independently.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sa_session_live
  ON service_agreement_signing_sessions (agreement_id, signatory_type)
  WHERE status IN ('pending', 'viewed', 'in_progress');

-- ───────────────────────────────────────────────────────────────────────────
--  5. Delivery log
-- ───────────────────────────────────────────────────────────────────────────
--
--  What was sent, to whom, when, and what happened. Separate from audit_logs
--  because a delivery has a RESULT that arrives later (and because an audit
--  row is append-only by policy, while a delivery's status legitimately moves
--  from queued to sent to failed).

CREATE TABLE IF NOT EXISTS service_agreement_deliveries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id        UUID NOT NULL REFERENCES service_agreements(id) ON DELETE CASCADE,
  signing_session_id  UUID REFERENCES service_agreement_signing_sessions(id) ON DELETE SET NULL,
  organisation_id     UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,

  method              VARCHAR(20) NOT NULL DEFAULT 'email',
  recipient_email     TEXT NOT NULL,
  sender_user_id      UUID REFERENCES users(id),
  message             VARCHAR(2000),

  included_pdf        BOOLEAN NOT NULL DEFAULT FALSE,
  master_version_label VARCHAR(20),
  agreement_reference VARCHAR(40),

  result              VARCHAR(20) NOT NULL DEFAULT 'queued',
  result_detail       VARCHAR(500),
  link_expires_at     TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_sa_delivery_method CHECK (method IN ('email', 'download', 'print')),
  CONSTRAINT valid_sa_delivery_result
    CHECK (result IN ('queued', 'sent', 'skipped', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_sa_deliveries_agreement
  ON service_agreement_deliveries (agreement_id, created_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
--  6. Immutability triggers
-- ───────────────────────────────────────────────────────────────────────────
--
--  Enforced in the DATABASE, following 018's precedent, because "the route
--  does not allow it" stops being true the moment somebody writes a second
--  route.

CREATE OR REPLACE FUNCTION service_agreement_master_refuse_update()
RETURNS TRIGGER AS $$
BEGIN
  -- A published version is frozen except for the transition to 'retired' and
  -- the supersession pointer that the NEXT publication writes onto it.
  IF OLD.status = 'published' THEN
    IF NEW.source_sha256      IS DISTINCT FROM OLD.source_sha256
    OR NEW.storage_key        IS DISTINCT FROM OLD.storage_key
    OR NEW.file_data          IS DISTINCT FROM OLD.file_data
    OR NEW.tag_manifest       IS DISTINCT FROM OLD.tag_manifest
    OR NEW.clause_snapshot    IS DISTINCT FROM OLD.clause_snapshot
    OR NEW.organisation_snapshot IS DISTINCT FROM OLD.organisation_snapshot
    OR NEW.version_label      IS DISTINCT FROM OLD.version_label
    OR NEW.published_at       IS DISTINCT FROM OLD.published_at
    OR NEW.published_by_user_id IS DISTINCT FROM OLD.published_by_user_id THEN
      RAISE EXCEPTION
        'A published service agreement master is immutable. Publish a new version instead.';
    END IF;
    IF NEW.status NOT IN ('published', 'retired') THEN
      RAISE EXCEPTION 'A published master may only be retired, not returned to %.', NEW.status;
    END IF;
  END IF;

  -- A retired version is frozen outright.
  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
    RAISE EXCEPTION 'A retired master version cannot be reactivated. Republish it as a new version.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sa_master_immutable ON service_agreement_master_versions;
CREATE TRIGGER trg_sa_master_immutable
  BEFORE UPDATE ON service_agreement_master_versions
  FOR EACH ROW EXECUTE FUNCTION service_agreement_master_refuse_update();

CREATE OR REPLACE FUNCTION service_agreement_refuse_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Once signed or voided, the agreement's content is history. Only the
  -- receipt columns — how and when the signed copy reached the participant —
  -- may still be written, because that genuinely happens afterwards.
  IF OLD.state IN ('signed', 'void') THEN
    IF NEW.form_data             IS DISTINCT FROM OLD.form_data
    OR NEW.support_rows          IS DISTINCT FROM OLD.support_rows
    OR NEW.clause_snapshot       IS DISTINCT FROM OLD.clause_snapshot
    OR NEW.organisation_snapshot IS DISTINCT FROM OLD.organisation_snapshot
    OR NEW.pricing_snapshot      IS DISTINCT FROM OLD.pricing_snapshot
    OR NEW.master_version_id     IS DISTINCT FROM OLD.master_version_id
    OR NEW.master_sha256         IS DISTINCT FROM OLD.master_sha256
    OR NEW.participant_client_id IS DISTINCT FROM OLD.participant_client_id THEN
      RAISE EXCEPTION
        'Service agreement % is % and cannot be edited.', OLD.id, OLD.state;
    END IF;
  END IF;

  -- The pin itself never moves once set, in any state.
  IF OLD.master_version_id IS NOT NULL
     AND NEW.master_version_id IS DISTINCT FROM OLD.master_version_id THEN
    RAISE EXCEPTION 'A service agreement stays pinned to the master version it was issued against.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sa_immutable ON service_agreements;
CREATE TRIGGER trg_sa_immutable
  BEFORE UPDATE ON service_agreements
  FOR EACH ROW EXECUTE FUNCTION service_agreement_refuse_update();

-- An artifact is a record of bytes that were produced. Rewriting one would
-- mean the checksum in the audit trail no longer describes the file.
CREATE OR REPLACE FUNCTION service_agreement_artifact_refuse_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Service agreement artifacts are immutable. Generate a new one.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sa_artifact_immutable ON service_agreement_artifacts;
CREATE TRIGGER trg_sa_artifact_immutable
  BEFORE UPDATE ON service_agreement_artifacts
  FOR EACH ROW EXECUTE FUNCTION service_agreement_artifact_refuse_update();
