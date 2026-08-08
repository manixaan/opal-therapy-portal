-- ═══════════════════════════════════════════════════════════════════════════
-- 011 — Resource Hub R2: Learning, Knowledge, Standards & Clinical Excellence
--
-- Additive only. R1 tables (resources, resource_tags, resource_folders,
-- resource_files, resource_favourites, user_resource_progress) are extended,
-- never rewritten. Existing rows keep working: every new column is nullable
-- or defaulted, and R1 statuses remain valid.
--
-- Concept map:
--   resources               — one row per resource of ANY type (article,
--                             policy, tutorial, external link, learning
--                             module…). content_type + authority_level +
--                             source_* metadata distinguish them (§50).
--   resource_collections    — curated shelves (Start Here, NDIS Knowledge…)
--   resource_versions       — immutable snapshots; policies bump versions
--   policy_acknowledgements — immutable per-user-per-version records
--   learning_paths/items    — server-side starter kits (replaces client-side
--                             RH_KITS; user_resource_progress stays for the
--                             legacy kits until content is migrated)
--   external_sources        — freshness + change-detection metadata (§9–10)
--   pd_events / cpd_entries — PD directory + lightweight CPD tracker
--   search_misses           — aggregate zero-result terms (no user linkage)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── resources: R2 metadata (all additive) ──────────────────────────────────
ALTER TABLE resources ADD COLUMN IF NOT EXISTS slug VARCHAR(160);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS content_format VARCHAR(20) NOT NULL DEFAULT 'markdown';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS content_type VARCHAR(40);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS learning_minutes INTEGER;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS mandatory BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS acknowledgement_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS cpd_eligible BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS cpd_hours NUMERIC(5,2);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS authority_level VARCHAR(30) NOT NULL DEFAULT 'internal';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS icon VARCHAR(40);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS target_roles JSONB NOT NULL DEFAULT '[]';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS clinical_population JSONB NOT NULL DEFAULT '[]';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS clinical_setting JSONB NOT NULL DEFAULT '[]';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS source_publisher VARCHAR(200);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS source_title VARCHAR(300);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS source_effective_date DATE;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS source_verified_at DATE;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS content_owner UUID REFERENCES users(id);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS last_reviewed_at DATE;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- authority_level: internal | opal_approved | official_regulatory |
--                  professional_body | external_reference
-- (no CHECK: R1 rows default 'internal'; route layer validates writes)

CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_org_slug
  ON resources (organisation_id, slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_resources_content_type ON resources (organisation_id, content_type);
CREATE INDEX IF NOT EXISTS idx_resources_mandatory ON resources (organisation_id, mandatory) WHERE mandatory = TRUE;

-- ── controlled vocabulary: aliases on existing tags ────────────────────────
ALTER TABLE resource_tags ADD COLUMN IF NOT EXISTS aliases JSONB NOT NULL DEFAULT '[]';

-- ── collections (curated shelves; folders remain for legacy grouping) ──────
CREATE TABLE IF NOT EXISTS resource_collections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id),
  key             VARCHAR(60) NOT NULL,
  name            VARCHAR(150) NOT NULL,
  tagline         VARCHAR(250),
  icon            VARCHAR(40),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_collection_key UNIQUE (organisation_id, key)
);

CREATE TABLE IF NOT EXISTS resource_collection_items (
  collection_id UUID NOT NULL REFERENCES resource_collections(id) ON DELETE CASCADE,
  resource_id   UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_collection_items_resource ON resource_collection_items (resource_id);

-- ── immutable version history (policies and important resources) ───────────
CREATE TABLE IF NOT EXISTS resource_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  title       VARCHAR(300),
  content     TEXT,
  change_note VARCHAR(300),
  change_kind VARCHAR(10) NOT NULL DEFAULT 'minor'
              CONSTRAINT valid_change_kind CHECK (change_kind IN ('initial','minor','material')),
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_resource_version UNIQUE (resource_id, version)
);

-- ── policy acknowledgements: append-only, never overwritten ────────────────
CREATE TABLE IF NOT EXISTS policy_acknowledgements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_id     UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ack_once UNIQUE (user_id, resource_id, version)
);
CREATE INDEX IF NOT EXISTS idx_acks_resource ON policy_acknowledgements (resource_id, version);

-- ── learning paths (server-side starter kits) ──────────────────────────────
CREATE TABLE IF NOT EXISTS learning_paths (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id),
  key             VARCHAR(60) NOT NULL,
  name            VARCHAR(150) NOT NULL,
  description     VARCHAR(500),
  target_role     VARCHAR(30),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_learning_path_key UNIQUE (organisation_id, key)
);

CREATE TABLE IF NOT EXISTS learning_path_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path_id     UUID NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  required    BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_path_item UNIQUE (path_id, resource_id)
);

-- ── per-resource completion (learning + tutorials + modules) ───────────────
CREATE TABLE IF NOT EXISTS user_learning_progress (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_id  UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, resource_id)
);

-- ── views: recents + aggregate usage (analytics, not surveillance) ─────────
CREATE TABLE IF NOT EXISTS resource_views (
  id              BIGSERIAL PRIMARY KEY,
  organisation_id UUID REFERENCES organisations(id),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  resource_id     UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  viewed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_views_user_recent ON resource_views (user_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_views_resource ON resource_views (resource_id);

-- ── external source registry: authority + freshness + change detection ─────
CREATE TABLE IF NOT EXISTS external_sources (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID REFERENCES organisations(id),
  name                  VARCHAR(200) NOT NULL,
  publisher             VARCHAR(200),
  url                   TEXT NOT NULL,
  authority             VARCHAR(30) NOT NULL DEFAULT 'external_reference',
  status                VARCHAR(20) NOT NULL DEFAULT 'current'
                        CONSTRAINT valid_source_status CHECK
                        (status IN ('current','review_due','source_changed','outdated','archived')),
  effective_date        DATE,
  last_verified_at      DATE,
  next_verify_at        DATE,
  http_status           INTEGER,
  etag                  VARCHAR(200),
  last_modified         VARCHAR(120),
  content_hash          VARCHAR(64),
  last_checked_at       TIMESTAMPTZ,
  change_detected_at    TIMESTAMPTZ,
  verified_after_change BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resource_external_sources (
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  source_id   UUID NOT NULL REFERENCES external_sources(id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, source_id)
);

-- ── professional development events ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pd_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID REFERENCES organisations(id),
  title            VARCHAR(300) NOT NULL,
  provider         VARCHAR(200),
  description      TEXT,
  topic            VARCHAR(100),
  starts_at        TIMESTAMPTZ,
  ends_at          TIMESTAMPTZ,
  timezone         VARCHAR(50) NOT NULL DEFAULT 'Australia/Perth',
  mode             VARCHAR(20) NOT NULL DEFAULT 'online'
                   CONSTRAINT valid_pd_mode CHECK (mode IN ('online','in_person','hybrid')),
  location         VARCHAR(300),
  cost_cents       INTEGER,
  cpd_hours        NUMERIC(5,2),
  registration_url TEXT,
  target_roles     JSONB NOT NULL DEFAULT '[]',
  source           VARCHAR(200),
  status           VARCHAR(20) NOT NULL DEFAULT 'upcoming'
                   CONSTRAINT valid_pd_status CHECK (status IN ('upcoming','past','archived','cancelled')),
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pd_events_start ON pd_events (organisation_id, starts_at);

-- ── lightweight CPD tracker (informational, practitioner-owned) ────────────
CREATE TABLE IF NOT EXISTS cpd_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   UUID REFERENCES organisations(id),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_date     DATE NOT NULL,
  activity          VARCHAR(300) NOT NULL,
  provider          VARCHAR(200),
  learning_goal     TEXT,
  hours             NUMERIC(5,2) NOT NULL DEFAULT 0,
  interactive_hours NUMERIC(5,2) NOT NULL DEFAULT 0,
  reflection        TEXT,
  competency_area   VARCHAR(100),
  evidence_note     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cpd_user_date ON cpd_entries (user_id, activity_date DESC);

-- ── structured feedback (replaces audit-only helpful/not) ──────────────────
CREATE TABLE IF NOT EXISTS resource_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id),
  resource_id     UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  kind            VARCHAR(20) NOT NULL
                  CONSTRAINT valid_feedback_kind CHECK (kind IN ('helpful','needs_update','missing')),
  comment         VARCHAR(1000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_resource ON resource_feedback (resource_id);

-- ── knowledge checks (reinforcement, not examination) ──────────────────────
CREATE TABLE IF NOT EXISTS quizzes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id    UUID NOT NULL UNIQUE REFERENCES resources(id) ON DELETE CASCADE,
  pass_threshold INTEGER NOT NULL DEFAULT 80,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id       UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  question      TEXT NOT NULL,
  kind          VARCHAR(15) NOT NULL DEFAULT 'multiple_choice'
                CONSTRAINT valid_question_kind CHECK (kind IN ('multiple_choice','true_false')),
  options       JSONB NOT NULL DEFAULT '[]',
  correct_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id      UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score        INTEGER NOT NULL,
  total        INTEGER NOT NULL,
  passed       BOOLEAN NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON quiz_attempts (user_id, quiz_id);

-- ── admin-configurable quick links ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resource_quick_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id),
  label           VARCHAR(100) NOT NULL,
  url             TEXT NOT NULL,
  icon            VARCHAR(40),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

-- ── zero-result search terms (aggregate only — no user linkage by design) ──
CREATE TABLE IF NOT EXISTS search_misses (
  id               BIGSERIAL PRIMARY KEY,
  organisation_id  UUID REFERENCES organisations(id),
  term             VARCHAR(200) NOT NULL,
  miss_count       INTEGER NOT NULL DEFAULT 1,
  last_searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_search_miss UNIQUE (organisation_id, term)
);
