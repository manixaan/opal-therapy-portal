-- ═══════════════════════════════════════════════════════════════════════════
-- 032 — Interactive induction / tutorial progress
--
-- Additive only. One table: tutorial_progress — one row per user per
-- tutorial module. "Not started" is the absence of a row.
--
-- The module catalogue itself (keys, versions, step counts, role gates)
-- is code-owned in frontend/current/induction-modules.js, which the
-- backend requires directly — the database stores only per-user state.
--
-- Versioning: `version` is the definition version the user is currently
-- taking. `completed_version` records the version that was completed and
-- survives restarts, so "completed on v1, definition now v2" renders as
-- an Updated badge rather than silently discarding the completion.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tutorial_progress (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID REFERENCES organisations(id),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tutorial_key     VARCHAR(80) NOT NULL,
  version          INTEGER NOT NULL DEFAULT 1,
  status           VARCHAR(20) NOT NULL DEFAULT 'in_progress'
                     CHECK (status IN ('in_progress', 'completed')),
  current_step     INTEGER NOT NULL DEFAULT 0 CHECK (current_step >= 0),
  furthest_step    INTEGER NOT NULL DEFAULT 0 CHECK (furthest_step >= 0),
  step_count       INTEGER,                    -- of the version being taken
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_viewed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  completed_version INTEGER,
  restart_count    INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT tutorial_progress_user_module UNIQUE (user_id, tutorial_key)
);

CREATE INDEX IF NOT EXISTS idx_tutorial_progress_user
  ON tutorial_progress (user_id);

-- Owner/admin induction-completion overview reads by organisation.
CREATE INDEX IF NOT EXISTS idx_tutorial_progress_org
  ON tutorial_progress (organisation_id);
