-- ═══════════════════════════════════════════════════════════════════════════
-- 033 — Owner-controlled learning workflows, versions and assignments
--
-- Additive only. Four tables forming the Owner-controlled learning layer
-- that the Resource Hub's learning primitives (011) and the interactive
-- induction (032) deliberately do not provide: Owner-AUTHORED workflows,
-- immutable published versions, per-EMPLOYEE assignments with their own
-- lifecycle, and per-assignment item completion.
--
-- Concept map:
--   learning_workflows          — the Owner's master library. `draft_content`
--                                 is the working copy the Owner edits freely;
--                                 it is never what an employee sees.
--   learning_workflow_versions  — immutable snapshots. A version is cut
--                                 automatically the moment the Owner assigns
--                                 a workflow whose draft differs from the
--                                 last published snapshot, so "what was this
--                                 employee actually asked to complete?" is
--                                 always answerable. Versions are never
--                                 updated or deleted while referenced.
--   learning_assignments        — "employee X was assigned version V of
--                                 workflow W". Own lifecycle (assigned →
--                                 in_progress → completed | cancelled),
--                                 denormalised progress counters, due date,
--                                 owner note. Historical record: cancelled
--                                 and completed rows are kept forever.
--   learning_item_progress      — one row per completed item per assignment
--                                 ("not done" is the absence of a row, like
--                                 tutorial_progress). `evidence` holds the
--                                 completion proof where one exists (quiz
--                                 score, acknowledgement statement hash) —
--                                 never free-text employee content.
--
-- Versioning rule: editing the master NEVER touches existing assignments —
-- they stay pinned to their workflow_version_id. Deleting a workflow is
-- refused by FK RESTRICT once any assignment exists (the route only offers
-- deletion for never-assigned drafts; everything else archives).
--
-- Content shape (learning_workflow_versions.content / draft_content JSONB):
--   { "sections": [ { "key", "title", "items": [ { "key", "type":
--     content|resource|acknowledgement|quiz|task, "title", "body",
--     "minutes", "required", "resource_id", "ack_statement",
--     "quiz": { "passThreshold", "questions": [...] } } ] } ] }
-- Item keys are stable across edits so progress survives a version push.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS learning_workflows (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID REFERENCES organisations(id),
  title            VARCHAR(200) NOT NULL,
  description      VARCHAR(1000),
  category         VARCHAR(60) NOT NULL DEFAULT 'induction',
  status           VARCHAR(20) NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'archived')),
  draft_content    JSONB NOT NULL DEFAULT '{"sections": []}',
  current_version  INTEGER NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at      TIMESTAMPTZ
);

-- category is a free vocabulary (the UI suggests induction/clinical/
-- compliance/safety/administration/rural_remote/professional_development/
-- policy_update/other; new categories need no migration).

CREATE INDEX IF NOT EXISTS idx_learning_workflows_org
  ON learning_workflows (organisation_id, status);

CREATE TABLE IF NOT EXISTS learning_workflow_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id   UUID NOT NULL REFERENCES learning_workflows(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL CHECK (version >= 1),
  title         VARCHAR(200) NOT NULL,
  description   VARCHAR(1000),
  category      VARCHAR(60),
  content       JSONB NOT NULL,
  published_by  UUID REFERENCES users(id),
  published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_learning_workflow_version UNIQUE (workflow_id, version)
);

CREATE TABLE IF NOT EXISTS learning_assignments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      UUID REFERENCES organisations(id),
  -- No ON DELETE CASCADE: an assignment (history) blocks workflow deletion.
  workflow_id          UUID NOT NULL REFERENCES learning_workflows(id),
  workflow_version_id  UUID NOT NULL REFERENCES learning_workflow_versions(id),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by          UUID REFERENCES users(id),
  assigned_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at               TIMESTAMPTZ,
  mandatory            BOOLEAN NOT NULL DEFAULT TRUE,
  priority             VARCHAR(10) NOT NULL DEFAULT 'normal'
                         CHECK (priority IN ('low', 'normal', 'high')),
  owner_note           VARCHAR(1000),
  status               VARCHAR(20) NOT NULL DEFAULT 'assigned'
                         CHECK (status IN ('assigned', 'in_progress', 'completed', 'cancelled')),
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ,
  cancelled_by         UUID REFERENCES users(id),
  last_activity_at     TIMESTAMPTZ,
  progress_percent     INTEGER NOT NULL DEFAULT 0
                         CHECK (progress_percent >= 0 AND progress_percent <= 100),
  required_total       INTEGER NOT NULL DEFAULT 0 CHECK (required_total >= 0),
  required_done        INTEGER NOT NULL DEFAULT 0 CHECK (required_done >= 0)
);

-- One ACTIVE assignment per employee per workflow. Completed/cancelled rows
-- do not block reassignment (annual refreshers, deliberate repeats).
CREATE UNIQUE INDEX IF NOT EXISTS uq_learning_assignment_active
  ON learning_assignments (user_id, workflow_id)
  WHERE status IN ('assigned', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_learning_assignments_user
  ON learning_assignments (user_id, status);
CREATE INDEX IF NOT EXISTS idx_learning_assignments_org
  ON learning_assignments (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_learning_assignments_workflow
  ON learning_assignments (workflow_id);

CREATE TABLE IF NOT EXISTS learning_item_progress (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  UUID NOT NULL REFERENCES learning_assignments(id) ON DELETE CASCADE,
  item_key       VARCHAR(80) NOT NULL,
  item_type      VARCHAR(20) NOT NULL,
  completed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evidence       JSONB,
  CONSTRAINT uq_learning_item_once UNIQUE (assignment_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_learning_item_progress_assignment
  ON learning_item_progress (assignment_id);
