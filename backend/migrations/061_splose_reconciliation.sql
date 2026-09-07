-- ═══════════════════════════════════════════════════════════════════════════
-- 061 — Splose reconciliation
--
-- Two guarantees behind "an out-of-sync appointment can never be created":
--
-- 1. One live portal event per Splose appointment. A second local row for
--    the same splose_id (a phantom re-import of an appointment the portal had
--    cancelled, 7 Sep 2026) is now impossible at the database. Any existing
--    duplicates are tombstoned first, keeping the most recently updated row.
--
-- 2. The change watcher may record an 'unlinked' alert: a client booking that
--    exists in the portal but was never written to Splose and has nothing
--    queued. The user is asked whether to queue it or leave it.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1a. Tombstone duplicate live rows, newest wins.
UPDATE events e
   SET is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW(),
       last_modified_by = 'reconciliation'
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY splose_id ORDER BY updated_at DESC, created_at DESC) AS rn
      FROM events
     WHERE splose_id IS NOT NULL AND (is_deleted IS NULL OR is_deleted = FALSE)
  ) d
 WHERE e.id = d.id AND d.rn > 1;

-- 1b. The guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS events_one_live_row_per_splose_id
  ON events (splose_id)
  WHERE splose_id IS NOT NULL AND (is_deleted IS NULL OR is_deleted = FALSE);

-- 2. Alerts may say "unlinked".
ALTER TABLE splose_change_alerts DROP CONSTRAINT IF EXISTS splose_change_alerts_kind_chk;
ALTER TABLE splose_change_alerts
  ADD CONSTRAINT splose_change_alerts_kind_chk
  CHECK (kind IN ('cancelled', 'moved', 'created', 'deleted', 'unlinked'));
