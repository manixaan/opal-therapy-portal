-- ═══════════════════════════════════════════════════════════════════════════
-- 045 — Owner-authorable walkthrough (interactive induction) catalogue
--
-- Additive only. Until now the walkthrough catalogue — module keys, versions,
-- role gates and every step — was code-owned in
-- frontend/current/induction-modules.js, require()d directly by
-- backend/tutorial-routes.js so client and server could never disagree
-- (see migration 032, which stores only per-user progress).
--
-- That made the catalogue uneditable without a deploy. These two tables move
-- it into the database so the Owner can author walkthroughs, deliberately
-- mirroring the learning-workflow shape proven in migration 033:
--
--   walkthrough_modules          — the Owner's working copy. `draft_steps` is
--                                  edited freely and is never what a learner
--                                  is validated against.
--   walkthrough_module_versions  — immutable snapshots. `current_version` on
--                                  the parent names the newest published one;
--                                  tutorial_progress.version (032) continues
--                                  to pin what a learner is taking, so editing
--                                  a draft never disturbs someone mid-module.
--
-- `source` distinguishes the nine seeded built-ins from Owner-authored
-- modules. Built-ins are seeded from induction-modules.js — which remains the
-- shipped default and the fallback catalogue when an organisation has no rows
-- — and, per the agreed design, they are editable in place rather than
-- copy-on-edit: the snapshot rule above is what makes that safe.
--
-- Step shape (walkthrough_modules.draft_steps / versions.steps JSONB), the
-- same contract induction.js already renders and induction-registry.test.js
-- already enforces:
--   [ { "type": intro|highlight|action|screenshot|callout|warning|quiz|complete,
--       "title", "body", "target", "route", "menu", "pad", "rounded",
--       "image": { "src", "alt" }, "advance", "roles": [...],
--       "quiz": { "question", "options": [...], "correctIndex", "explain" },
--       "next" } ]
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS walkthrough_modules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID REFERENCES organisations(id),
  key              VARCHAR(80) NOT NULL,
  title            VARCHAR(200) NOT NULL,
  description      VARCHAR(1000),
  group_key        VARCHAR(40) NOT NULL DEFAULT 'portal',
  minutes          INTEGER NOT NULL DEFAULT 5 CHECK (minutes >= 1 AND minutes <= 120),
  roles            JSONB NOT NULL DEFAULT '["owner"]',
  thumb            VARCHAR(300),
  start_context    JSONB NOT NULL DEFAULT '{}',
  draft_steps      JSONB NOT NULL DEFAULT '[]',
  current_version  INTEGER NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  source           VARCHAR(20) NOT NULL DEFAULT 'custom'
                     CHECK (source IN ('builtin', 'custom')),
  status           VARCHAR(20) NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'archived')),
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at      TIMESTAMPTZ
);

-- One module per key per organisation. organisation_id is nullable and NULLs
-- compare as distinct, which would let duplicate org-less keys through — the
-- COALESCE sentinel closes that hole. A duplicate key would make
-- moduleByKey() ambiguous and the role gate unreliable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_walkthrough_module_key
  ON walkthrough_modules (
    COALESCE(organisation_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

CREATE INDEX IF NOT EXISTS idx_walkthrough_modules_org
  ON walkthrough_modules (organisation_id, status);

CREATE TABLE IF NOT EXISTS walkthrough_module_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id      UUID NOT NULL REFERENCES walkthrough_modules(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL CHECK (version >= 1),
  title          VARCHAR(200) NOT NULL,
  description    VARCHAR(1000),
  minutes        INTEGER,
  roles          JSONB NOT NULL DEFAULT '["owner"]',
  thumb          VARCHAR(300),
  start_context  JSONB NOT NULL DEFAULT '{}',
  steps          JSONB NOT NULL,
  published_by   UUID REFERENCES users(id),
  published_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_walkthrough_module_version UNIQUE (module_id, version)
);

CREATE INDEX IF NOT EXISTS idx_walkthrough_module_versions_module
  ON walkthrough_module_versions (module_id, version DESC);
