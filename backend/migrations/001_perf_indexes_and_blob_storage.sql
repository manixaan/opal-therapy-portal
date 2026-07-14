-- ═══════════════════════════════════════════════════════════════════════════
--  001 — performance indexes + document blob-storage columns
-- ═══════════════════════════════════════════════════════════════════════════

-- Missing indexes flagged in handover/DATABASE_SCHEMA.md.
-- The hot calendar read filters non-deleted events for a user by time.
CREATE INDEX IF NOT EXISTS idx_events_user_active_start
  ON events (user_id, start_time)
  WHERE is_deleted = FALSE;

-- Diagnostics / failed-writeback queries scan sync_log by status + recency.
CREATE INDEX IF NOT EXISTS idx_sync_log_status_created
  ON sync_log (status, created_at);

-- Audit lookups by actor before an audit UI ships.
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
  ON audit_logs (actor_user_id, created_at);

-- ── Document storage abstraction (Phase 7) ──────────────────────────────────
-- pd_documents currently stores file bytes as base64 in file_data (TEXT).
-- These columns let a row point at an external blob instead. When
-- storage_backend='blob', file_data is NULL and storage_key holds the
-- private blob path. Existing rows keep storage_backend='db' — no data move
-- required for the pilot; the abstraction handles both transparently.
ALTER TABLE pd_documents ADD COLUMN IF NOT EXISTS storage_backend VARCHAR(10) NOT NULL DEFAULT 'db';
ALTER TABLE pd_documents ADD COLUMN IF NOT EXISTS storage_key TEXT;

ALTER TABLE pd_documents
  DROP CONSTRAINT IF EXISTS pd_documents_storage_backend_check;
ALTER TABLE pd_documents
  ADD CONSTRAINT pd_documents_storage_backend_check
  CHECK (storage_backend IN ('db', 'local', 'blob'));
