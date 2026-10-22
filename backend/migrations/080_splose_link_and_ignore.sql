-- ═══════════════════════════════════════════════════════════════════════════
-- 080 — Splose sync: match, link or ignore
--
-- A calendar migrated into the portal by hand queues a Splose "create" for
-- every client booking, although most of them already exist in Splose. The
-- review list now offers, per queued create:
--
--   LINK    — the booking IS an existing Splose appointment: the event takes
--             that splose_id and the queue row is resolved without a write.
--   IGNORE  — the booking is never to be written to Splose. The event is
--             stamped never-sync; enqueueChange refuses it and the watcher's
--             "unlinked" check skips it. An Owner/Admin can undo it.
--
-- 1. events.splose_sync_ignored_at / _by — the never-sync stamp.
-- 2. splose_sync_queue.resolution — why a row left the queue without a
--    Splose call ('linked' with status 'done', 'ignored' with 'discarded').
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE events ADD COLUMN IF NOT EXISTS splose_sync_ignored_at TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS splose_sync_ignored_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_splose_sync_ignored
  ON events (user_id, splose_sync_ignored_at)
  WHERE splose_sync_ignored_at IS NOT NULL;

ALTER TABLE splose_sync_queue ADD COLUMN IF NOT EXISTS resolution VARCHAR(12);
ALTER TABLE splose_sync_queue DROP CONSTRAINT IF EXISTS splose_sync_queue_resolution_chk;
ALTER TABLE splose_sync_queue
  ADD CONSTRAINT splose_sync_queue_resolution_chk
  CHECK (resolution IS NULL OR resolution IN ('linked', 'ignored'));

COMMENT ON COLUMN events.splose_sync_ignored_at IS
  'Set when the owner chose "ignore permanently" for Splose sync: never queued, never offered as unlinked (080).';
COMMENT ON COLUMN splose_sync_queue.resolution IS
  'Why a row left the queue without a Splose write: linked to an existing appointment, or ignored (080).';
