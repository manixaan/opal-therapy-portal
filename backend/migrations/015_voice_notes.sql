-- ═══════════════════════════════════════════════════════════════════════════
--  015 — Voice notes: mobile dictation drafts
-- ═══════════════════════════════════════════════════════════════════════════
-- Draft transcripts captured on the Opa Mobile Companion (tap-to-record,
-- on-device transcription; the phone uploads reviewed TEXT only — no audio
-- is stored or accepted in V1). Strictly user-scoped in mobile-routes.js,
-- following the snapshot_* model: every read and write filters on user_id,
-- and NO role — owner included — can see another user's rows. Nothing here
-- is a finalised clinical record: rows are drafts until a human reviews
-- them. linked_* columns are soft references (no FK) so a note survives its
-- linked event/task/reminder; ownership of the link target is verified in
-- the route layer at link time. No external calls.

CREATE TABLE IF NOT EXISTS voice_notes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id    UUID REFERENCES organisations(id),
  title              VARCHAR(300),
  transcript         TEXT NOT NULL,
  note_type          VARCHAR(30) NOT NULL DEFAULT 'general_note',
    CONSTRAINT valid_voice_note_type CHECK
      (note_type IN ('appointment_note','general_note','task_candidate','reminder_candidate')),
  status             VARCHAR(20) NOT NULL DEFAULT 'draft',
    CONSTRAINT valid_voice_note_status CHECK (status IN ('draft','reviewed','archived')),
  source             VARCHAR(20) NOT NULL DEFAULT 'mobile_voice',
    CONSTRAINT valid_voice_note_source CHECK (source IN ('mobile_voice','typed','imported')),
  linked_event_id    UUID,
  linked_task_id     UUID,
  linked_reminder_id UUID,
  captured_at        TIMESTAMPTZ,
  reviewed_at        TIMESTAMPTZ,
  archived_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_notes_user_created
  ON voice_notes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_notes_user_status
  ON voice_notes (user_id, status);
CREATE INDEX IF NOT EXISTS idx_voice_notes_linked_event
  ON voice_notes (linked_event_id) WHERE linked_event_id IS NOT NULL;
