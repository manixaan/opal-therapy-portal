-- ═══════════════════════════════════════════════════════════════════════════
--  078 — Resource Library: file version history
-- ═══════════════════════════════════════════════════════════════════════════
-- Replacing a document's file makes the new file live immediately and keeps
-- the old one as a previous version: who uploaded it, when, its size and its
-- file name, viewable and downloadable, and restorable by an Owner or Admin.
-- Restoring never destroys history — it adds a new version that points at the
-- older file.
--
-- ── WHY A SEPARATE TABLE ──────────────────────────────────────────────────
-- resource_files is unique on (resource_id, storage_key): one stored blob per
-- resource. A restore re-uses an existing file row rather than storing the
-- same bytes again, so one file can be "version 2" and "version 4" at once.
-- That is a list of events, not a property of the file, hence its own table.
--
-- resource_files.superseded_at marks a file that is a previous version rather
-- than a current attachment. Superseded files drop out of a resource's file
-- list (they used to linger there as confusing extra downloads) but stay
-- reachable through the version history.
--
-- ── EXISTING DATA ─────────────────────────────────────────────────────────
-- Every resource that already has a primary file gets a version-1 row for it,
-- attributed to whoever uploaded it, at the time it was uploaded. Attachments
-- (non-primary files) are not versions and get no row.

ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS resource_file_versions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id           UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  organisation_id       UUID REFERENCES organisations(id),
  version_no            INTEGER NOT NULL CHECK (version_no >= 1),
  file_id               UUID REFERENCES resource_files(id) ON DELETE SET NULL,
  file_name             VARCHAR(300),
  format                VARCHAR(20),
  file_size_bytes       BIGINT,
  checksum_sha256       VARCHAR(64),
  action                VARCHAR(20) NOT NULL DEFAULT 'upload',
  restored_from_version INTEGER,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_resource_file_version UNIQUE (resource_id, version_no),
  CONSTRAINT valid_resource_file_version_action
    CHECK (action IN ('initial', 'upload', 'replace', 'restore'))
);
CREATE INDEX IF NOT EXISTS idx_resource_file_versions_resource
  ON resource_file_versions (resource_id, version_no DESC);
CREATE INDEX IF NOT EXISTS idx_resource_file_versions_file
  ON resource_file_versions (file_id);

-- Backfill: the current primary file of every resource is its version 1.
INSERT INTO resource_file_versions
  (resource_id, organisation_id, version_no, file_id, file_name, format,
   file_size_bytes, checksum_sha256, action, created_by, created_at)
SELECT DISTINCT ON (f.resource_id)
       f.resource_id, r.organisation_id, 1, f.id, f.file_name, f.format,
       f.file_size_bytes, f.checksum_sha256, 'initial', f.uploaded_by,
       COALESCE(f.uploaded_at, NOW())
  FROM resource_files f
  JOIN resources r ON r.id = f.resource_id
 WHERE f.is_primary
   AND NOT EXISTS (SELECT 1 FROM resource_file_versions v WHERE v.resource_id = f.resource_id)
 ORDER BY f.resource_id, f.uploaded_at DESC NULLS LAST;
