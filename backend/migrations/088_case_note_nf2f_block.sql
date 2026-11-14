-- ═══════════════════════════════════════════════════════════════════════════
--  088 — A case note written from a case-noting block remembers that block
-- ═══════════════════════════════════════════════════════════════════════════
-- The Case Notes workspace lists a week's non-face-to-face (case noting)
-- blocks; each block names several clients and a note is written per client.
-- Such a note stays CLIENT-linked (splose_patient_id: header from the Splose
-- client, no billing line — billing is the block's timer split), and records
-- the block it was written from here. linked_event_id keeps its meaning (the
-- one appointment a note is about), so header, regeneration and billing
-- rules are unchanged. Soft reference, like linked_event_id: no FK.

ALTER TABLE case_note_drafts ADD COLUMN IF NOT EXISTS nf2f_event_id UUID;

CREATE INDEX IF NOT EXISTS idx_case_note_drafts_nf2f
  ON case_note_drafts (user_id, nf2f_event_id)
  WHERE nf2f_event_id IS NOT NULL;
