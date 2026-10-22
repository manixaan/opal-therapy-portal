-- ═══════════════════════════════════════════════════════════════════════════
--  077 — Resource Library: recycle bin and "modified by"
-- ═══════════════════════════════════════════════════════════════════════════
-- The Library becomes a document library: deleting a document or a folder
-- sends it to a recycle bin, from which an Owner or Admin can put it back
-- exactly where it was, and from which only the Owner can delete for good.
-- Anything left in the bin for 90 days is purged by a scheduled job.
--
-- ── HOW A DELETED DOCUMENT IS HIDDEN ──────────────────────────────────────
-- A deleted resource is stamped status='archived' + archived_at, which every
-- existing reader already refuses (LIVE_RESOURCE_SQL, the library scope, file
-- delivery, the therapist list). The bin columns below say WHY it is archived
-- and what it was before, so Restore can put back the exact prior state rather
-- than guessing one. deleted_prior holds {status, publication_state,
-- archived_at} as they were the moment it was deleted.
--
-- ── FOLDERS ───────────────────────────────────────────────────────────────
-- A deleted folder is is_active = FALSE (already what every folder reader
-- filters on) plus deleted_at. Its parent_id is left alone, so restoring it
-- puts it back in place. deleted_with_folder_id groups one delete: the folder
-- that was deleted and everything inside it share the id of that folder, so
-- the batch restores (or purges) together. A document deleted on its own has
-- deleted_with_folder_id NULL. Folders removed before this migration
-- (is_active = FALSE, deleted_at NULL) are not in the bin and stay as they were.
--
-- Additive only; no existing row changes.

ALTER TABLE resources ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS deleted_from_folder_id UUID REFERENCES resource_folders(id) ON DELETE SET NULL;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS deleted_with_folder_id UUID;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS deleted_prior JSONB;

COMMENT ON COLUMN resources.updated_by IS
  'Who last changed the document (rename, replace, restore). Shown as "Modified by" in the Library.';
COMMENT ON COLUMN resources.deleted_at IS
  'Set when the document is in the Library recycle bin. Purged 90 days later.';
COMMENT ON COLUMN resources.deleted_with_folder_id IS
  'The folder whose deletion took this document to the bin; NULL when deleted on its own.';

ALTER TABLE resource_folders ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE resource_folders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE resource_folders ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE resource_folders ADD COLUMN IF NOT EXISTS deleted_with_folder_id UUID;

CREATE INDEX IF NOT EXISTS idx_resources_recycle_bin
  ON resources (organisation_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_resource_folders_recycle_bin
  ON resource_folders (organisation_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_resource_folders_parent
  ON resource_folders (parent_id);
