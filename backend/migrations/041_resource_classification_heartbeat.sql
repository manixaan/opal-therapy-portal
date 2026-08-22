-- ═══════════════════════════════════════════════════════════════════════════
--  041 — Resource classification runs: a heartbeat, so a dead run can be seen
-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 039 gave each organisation at most one active run, enforced by a
-- partial unique index on status = 'running'. That is the right constraint —
-- two concurrent runs would race on the same assignments and neither snapshot
-- would describe the result — but it had no way to tell a run that is WORKING
-- from a run whose process no longer exists.
--
-- On staging a full run takes about seventeen minutes, most of it waiting on
-- the model. An App Service restart inside that window (a deploy, a scale
-- event, a platform move) leaves the row saying 'running' for ever, and the
-- Owner's Organise Library button answers 409 for ever with it. Nothing short
-- of manual SQL recovers.
--
-- A heartbeat distinguishes the two cases honestly. A live run touches this
-- column every time it reports progress; a dead one stops. `startRun` reaps
-- anything that has not beaten for long enough and then proceeds, so recovery
-- costs the Owner one more press of the button rather than a support call.
--
-- Backfilled from started_at so existing rows are judged by the only evidence
-- they have.

ALTER TABLE resource_classification_runs
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;

UPDATE resource_classification_runs
   SET heartbeat_at = COALESCE(heartbeat_at, finished_at, started_at)
 WHERE heartbeat_at IS NULL;

ALTER TABLE resource_classification_runs
  ALTER COLUMN heartbeat_at SET DEFAULT NOW();

COMMENT ON COLUMN resource_classification_runs.heartbeat_at IS
  'Last progress report from the process running this. A run still marked running whose heartbeat is stale had its process die; startRun reaps it.';

-- Finding the stale ones is the only query this column serves.
CREATE INDEX IF NOT EXISTS idx_classification_runs_stale
  ON resource_classification_runs (organisation_id, heartbeat_at)
  WHERE status = 'running';
