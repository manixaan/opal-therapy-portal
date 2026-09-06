-- ═══════════════════════════════════════════════════════════════════════════
--  059 — Case-note drafts may link to a Splose CLIENT instead of an appointment
-- ═══════════════════════════════════════════════════════════════════════════
-- Opa Mobile now lets a therapist dictate a note against a client from their
-- Splose caseload without first booking or picking an appointment. The
-- header snapshot is then built from the Splose client record (name,
-- address) and the dictation date; there is no event to derive a service
-- title or billing from, so those are omitted — never guessed.
--
-- linked_event_id becomes optional; splose_patient_id is the alternative
-- soft reference (Splose ids are opaque strings, no FK). A draft must carry
-- at least one link — an unlinked clinical note is not allowed to exist.

ALTER TABLE case_note_drafts ALTER COLUMN linked_event_id DROP NOT NULL;

ALTER TABLE case_note_drafts
  ADD COLUMN IF NOT EXISTS splose_patient_id VARCHAR(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'case_note_drafts_link_chk'
  ) THEN
    ALTER TABLE case_note_drafts
      ADD CONSTRAINT case_note_drafts_link_chk
      CHECK (linked_event_id IS NOT NULL OR splose_patient_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_case_note_drafts_user_client
  ON case_note_drafts (user_id, splose_patient_id);
