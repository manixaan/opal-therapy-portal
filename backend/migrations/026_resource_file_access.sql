-- ═══════════════════════════════════════════════════════════════════════════
--  026 — File-level access, integrity and governed storage keys
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Prepares `resource_files` to actually deliver bytes safely. Today the table
--  holds no rows and the hub has no download route at all, so this is additive
--  with nothing to migrate.
--
--  DESIGN RULES
--
--  1. `access_tier` is NULLABLE and means INHERIT. A file with no tier of its
--     own is exactly as restricted as its resource. This is the safe default:
--     forgetting to set a file tier cannot widen access, it can only match the
--     parent.
--  2. The effective tier is always the MORE RESTRICTIVE of resource and file —
--     never the file alone. A clinician-only DOCX hanging off a staff resource
--     stays clinician-only; a staff-tier file on a clinician-only resource does
--     NOT become staff-readable. The rule lives in resource-governance.js
--     (effectiveAccessTier) so routes and tests share one implementation.
--  3. `storage_key` must be a RELATIVE key inside the governed root. Absolute
--     paths and traversal are refused by CHECK constraint, not merely by
--     application code — the historical 1.97GB source vault must be
--     unreachable even if a bug tries to point at it.
--  4. Integrity: sha256 + byte size are recorded so a served file can be shown
--     to be the file that was reviewed.
--
--  Idempotent. See backend/migrations/README.md.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS access_tier     VARCHAR(30);
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS format          VARCHAR(20);
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS checksum_sha256 VARCHAR(64);
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS is_primary      BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN resource_files.access_tier IS
  'NULL means inherit the resource tier. Effective access is always the MORE restrictive of the two.';
COMMENT ON COLUMN resource_files.storage_key IS
  'Relative key inside the governed storage root. Absolute paths and traversal are refused by CHECK.';
COMMENT ON COLUMN resource_files.checksum_sha256 IS
  'SHA-256 of the stored bytes, so a served file can be shown to be the reviewed file.';

-- A file tier, when set, uses the same vocabulary as a resource tier. NULL is
-- allowed and is the inherit case.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_resource_file_access_tier') THEN
    ALTER TABLE resource_files ADD CONSTRAINT valid_resource_file_access_tier CHECK (
      access_tier IS NULL
      OR access_tier IN ('clinician','staff','admin','excluded-private'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_resource_file_format') THEN
    ALTER TABLE resource_files ADD CONSTRAINT valid_resource_file_format CHECK (
      format IS NULL OR format IN ('pdf','docx','pptx','xlsx','png','jpg','link'));
  END IF;
END $$;

-- Traversal, absolute paths, Windows drive letters and UNC prefixes are refused
-- at the storage layer. Belt and braces: the download route validates too, but
-- a constraint cannot be forgotten by a future caller.
-- (No NUL check: a text column cannot hold one — Postgres rejects it outright.)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_file_storage_key_is_relative') THEN
    ALTER TABLE resource_files ADD CONSTRAINT resource_file_storage_key_is_relative CHECK (
      storage_key IS NULL
      OR (storage_key <> ''
          AND storage_key NOT LIKE '/%'
          AND storage_key NOT LIKE '\\%'
          AND storage_key !~ '^[A-Za-z]:'
          AND storage_key NOT LIKE '%..%'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_file_checksum_is_sha256') THEN
    ALTER TABLE resource_files ADD CONSTRAINT resource_file_checksum_is_sha256 CHECK (
      checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_file_size_is_sane') THEN
    ALTER TABLE resource_files ADD CONSTRAINT resource_file_size_is_sane CHECK (
      file_size_bytes IS NULL OR (file_size_bytes >= 0 AND file_size_bytes <= 104857600));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_resource_files_resource ON resource_files (resource_id);
CREATE INDEX IF NOT EXISTS idx_resource_files_tier     ON resource_files (access_tier)
  WHERE access_tier IS NOT NULL;

-- One primary file per resource — the participant-facing download. Partial
-- unique index rather than a constraint so non-primary files are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_resource_files_primary
  ON resource_files (resource_id) WHERE is_primary;

-- Idempotent re-seeding needs a stable identity for a file within a resource.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_resource_files_key
  ON resource_files (resource_id, storage_key) WHERE storage_key IS NOT NULL;
