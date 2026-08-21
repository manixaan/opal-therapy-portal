-- ═══════════════════════════════════════════════════════════════════════════
--  039 — Resource Library organisation (semantic folders)
-- ═══════════════════════════════════════════════════════════════════════════
-- The Library had grown to ~700 records presented as one list. This migration
-- adds the metadata a NAVIGATION layer needs, and nothing else.
--
-- ── ADDITIVE AND NON-DESTRUCTIVE, DELIBERATELY ────────────────────────────
-- `resources.folder_id` already exists and already carries data: the resource
-- ingestion run filed 516 records into twelve FORMAT-shaped folders
-- ("Worksheet Form", "Slide Deck"). That column is read by the legacy
-- resources-routes.js browse, so repurposing it would rewrite live data and
-- change what an existing route returns.
--
-- So the semantic taxonomy does not touch it. Folder membership for the new
-- Library lives in `resource_folder_assignments` — one row per resource,
-- pointing at a folder of kind 'library'. The ingestion folders stay exactly
-- as they are, marked kind='ingestion', and nothing that reads them changes.
-- A resource keeps its id, its files, its blob keys, its tags, its versions
-- and its URL; all that is added is a row saying where it is shelved.
--
-- ── WHY A HISTORY TABLE ───────────────────────────────────────────────────
-- An automatic organisation run touches hundreds of rows at once. If a
-- classification change turns out badly the Owner must not have to rebuild
-- the library by hand, so every assignment change records what it replaced
-- and which run made it. Rollback is then a data operation, not an
-- archaeology exercise.

-- ── resource_folders: taxonomy metadata on the existing table ─────────────
ALTER TABLE resource_folders ADD COLUMN IF NOT EXISTS slug        VARCHAR(160);
ALTER TABLE resource_folders ADD COLUMN IF NOT EXISTS kind        VARCHAR(20) NOT NULL DEFAULT 'ingestion';
ALTER TABLE resource_folders ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE resource_folders ADD COLUMN IF NOT EXISTS is_review_bucket BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE resource_folders ADD COLUMN IF NOT EXISTS source      VARCHAR(20) NOT NULL DEFAULT 'ai';
ALTER TABLE resource_folders ADD COLUMN IF NOT EXISTS name_locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE resource_folders ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN resource_folders.kind IS
  'ingestion = pre-existing format folders read by resources-routes.js; library = the semantic Library taxonomy.';
COMMENT ON COLUMN resource_folders.name_locked IS
  'TRUE once a person has renamed the folder. Automatic reorganisation must not rename it again.';

-- Existing rows predate the taxonomy and keep their meaning.
UPDATE resource_folders SET kind = 'ingestion' WHERE kind IS NULL;

DO $$ BEGIN
  ALTER TABLE resource_folders ADD CONSTRAINT valid_resource_folder_kind
    CHECK (kind IN ('ingestion','library'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE resource_folders ADD CONSTRAINT valid_resource_folder_source
    CHECK (source IN ('ai','rules','manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Deep links address a folder by slug, so the URL survives a rename.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_resource_folder_slug
  ON resource_folders (organisation_id, slug) WHERE slug IS NOT NULL AND kind = 'library';
CREATE INDEX IF NOT EXISTS idx_resource_folders_kind
  ON resource_folders (organisation_id, kind, is_active);

-- ── the semantic profile behind one resource's placement ──────────────────
-- Built once per content fingerprint and reused: browsing must never re-read
-- a document. `signals` holds the deterministic lexicon scores, `source` says
-- whether a model refined them.
CREATE TABLE IF NOT EXISTS resource_semantic_profiles (
  resource_id      UUID PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
  organisation_id  UUID REFERENCES organisations(id),
  summary          VARCHAR(600),
  primary_purpose  VARCHAR(120),
  resource_kind    VARCHAR(60),
  audience         VARCHAR(60),
  topics           JSONB NOT NULL DEFAULT '[]',
  signals          JSONB NOT NULL DEFAULT '{}',
  source           VARCHAR(10) NOT NULL DEFAULT 'rules',
  confidence       NUMERIC(4,3),
  text_source      VARCHAR(20),
  fingerprint      VARCHAR(64),
  built_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_profile_source CHECK (source IN ('rules','ai'))
);
CREATE INDEX IF NOT EXISTS idx_semantic_profiles_org ON resource_semantic_profiles (organisation_id);

-- ── where a resource is shelved ───────────────────────────────────────────
-- One primary home per resource (§12): tags keep carrying the cross-cutting
-- dimensions. manual_lock is the whole point of the table — an Owner's
-- placement must survive every later automatic run.
CREATE TABLE IF NOT EXISTS resource_folder_assignments (
  resource_id           UUID PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
  organisation_id       UUID REFERENCES organisations(id),
  folder_id             UUID NOT NULL REFERENCES resource_folders(id) ON DELETE CASCADE,
  classification_source VARCHAR(10) NOT NULL DEFAULT 'rules',
  confidence            NUMERIC(4,3),
  manual_lock           BOOLEAN NOT NULL DEFAULT FALSE,
  rationale             VARCHAR(300),
  run_id                UUID,
  classified_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_assignment_source CHECK (classification_source IN ('ai','rules','manual'))
);
CREATE INDEX IF NOT EXISTS idx_folder_assignments_folder ON resource_folder_assignments (folder_id);
CREATE INDEX IF NOT EXISTS idx_folder_assignments_org    ON resource_folder_assignments (organisation_id);
CREATE INDEX IF NOT EXISTS idx_folder_assignments_locked ON resource_folder_assignments (organisation_id) WHERE manual_lock;

-- ── one automatic organisation run ────────────────────────────────────────
-- `phase` drives the progress the Owner sees; the words shown are chosen in
-- the client so no database vocabulary reaches a user (§16).
CREATE TABLE IF NOT EXISTS resource_classification_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID REFERENCES organisations(id),
  status           VARCHAR(20) NOT NULL DEFAULT 'running',
  phase            VARCHAR(30) NOT NULL DEFAULT 'scanning',
  mode             VARCHAR(20) NOT NULL DEFAULT 'organise',
  scanned_count    INTEGER NOT NULL DEFAULT 0,
  profiled_count   INTEGER NOT NULL DEFAULT 0,
  assigned_count   INTEGER NOT NULL DEFAULT 0,
  skipped_locked   INTEGER NOT NULL DEFAULT 0,
  review_count     INTEGER NOT NULL DEFAULT 0,
  folders_created  INTEGER NOT NULL DEFAULT 0,
  ai_used          BOOLEAN NOT NULL DEFAULT FALSE,
  ai_unavailable_reason VARCHAR(80),
  taxonomy         JSONB,
  duplicates       JSONB NOT NULL DEFAULT '[]',
  error            VARCHAR(300),
  rolled_back_at   TIMESTAMPTZ,
  started_by       UUID REFERENCES users(id),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  CONSTRAINT valid_run_status CHECK (status IN ('running','complete','failed','rolled_back')),
  CONSTRAINT valid_run_mode   CHECK (mode IN ('organise','reorganise','single'))
);
CREATE INDEX IF NOT EXISTS idx_classification_runs_org
  ON resource_classification_runs (organisation_id, started_at DESC);

-- Only one run at a time per organisation: two concurrent runs would race on
-- the same assignments and neither snapshot would describe the result.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_classification_run_active
  ON resource_classification_runs (organisation_id) WHERE status = 'running';

-- ── what a run replaced, so it can be put back ────────────────────────────
CREATE TABLE IF NOT EXISTS resource_assignment_history (
  id             BIGSERIAL PRIMARY KEY,
  run_id         UUID REFERENCES resource_classification_runs(id) ON DELETE CASCADE,
  organisation_id UUID REFERENCES organisations(id),
  resource_id    UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  from_folder_id UUID REFERENCES resource_folders(id) ON DELETE SET NULL,
  to_folder_id   UUID REFERENCES resource_folders(id) ON DELETE SET NULL,
  from_source    VARCHAR(10),
  to_source      VARCHAR(10),
  from_locked    BOOLEAN,
  changed_by     UUID REFERENCES users(id),
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assignment_history_run ON resource_assignment_history (run_id);
CREATE INDEX IF NOT EXISTS idx_assignment_history_resource ON resource_assignment_history (resource_id, changed_at DESC);
