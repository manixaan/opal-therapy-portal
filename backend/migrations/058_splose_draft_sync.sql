-- ═══════════════════════════════════════════════════════════════════════════
-- 058 — Splose draft-and-publish sync
--
-- The portal becomes the place a client appointment is created, moved or
-- cancelled. Nothing reaches Splose as it happens: each change is queued as a
-- pending row, the user reviews the week, and "Sync Splose" publishes the
-- queue one call at a time under Splose's 60-calls-a-minute limit.
--
-- A second table records changes that were made INSIDE Splose (the wrong
-- door). A watcher compares Splose against the portal every couple of minutes
-- and writes an alert; the user is shown it and says whether the change was
-- valid. Valid changes are applied to the portal's copy; invalid ones stay on
-- record for the owner and are corrected in Splose by hand.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS splose_sync_queue (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  event_id              UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  -- create | update | cancel
  action                VARCHAR(10) NOT NULL,
  -- what will be sent: start/end ISO, serviceId, locationId, practitionerId,
  -- patientId, caseId, note, reasonId, plus a human summary for the review list
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- pending | publishing | done | failed | discarded
  status                VARCHAR(12) NOT NULL DEFAULT 'pending',
  splose_appointment_id VARCHAR(50),
  error                 TEXT,
  attempts              INTEGER NOT NULL DEFAULT 0,
  batch_id              UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at          TIMESTAMPTZ,
  CONSTRAINT splose_sync_queue_action_chk CHECK (action IN ('create', 'update', 'cancel')),
  CONSTRAINT splose_sync_queue_status_chk CHECK (status IN ('pending', 'publishing', 'done', 'failed', 'discarded'))
);

-- One live (pending or failed) change per event: a second edit amends it.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_splose_sync_queue_live_event
  ON splose_sync_queue (event_id)
  WHERE status IN ('pending', 'publishing', 'failed');

CREATE INDEX IF NOT EXISTS idx_splose_sync_queue_user_status
  ON splose_sync_queue (user_id, status, created_at);

CREATE TABLE IF NOT EXISTS splose_change_alerts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- the portal user whose calendar the appointment belongs to (null when the
  -- practitioner is not linked to a portal account yet)
  user_id               UUID REFERENCES users(id) ON DELETE CASCADE,
  event_id              UUID REFERENCES events(id) ON DELETE SET NULL,
  splose_appointment_id VARCHAR(50) NOT NULL,
  -- cancelled | moved | created | deleted
  kind                  VARCHAR(12) NOT NULL,
  -- stable digest of the observed state so the same change is recorded once
  fingerprint           VARCHAR(120) NOT NULL,
  details               JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at       TIMESTAMPTZ,
  acknowledged_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  -- valid | invalid
  verdict               VARCHAR(10),
  note                  TEXT,
  CONSTRAINT splose_change_alerts_kind_chk CHECK (kind IN ('cancelled', 'moved', 'created', 'deleted')),
  CONSTRAINT splose_change_alerts_verdict_chk CHECK (verdict IS NULL OR verdict IN ('valid', 'invalid'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_splose_change_alerts_fingerprint
  ON splose_change_alerts (splose_appointment_id, kind, fingerprint);

CREATE INDEX IF NOT EXISTS idx_splose_change_alerts_open
  ON splose_change_alerts (user_id, detected_at)
  WHERE acknowledged_at IS NULL;

COMMENT ON TABLE splose_sync_queue IS
  'Draft calendar changes waiting to be published to Splose (058).';
COMMENT ON TABLE splose_change_alerts IS
  'Appointment changes detected in Splose that did not come through the portal (058).';
