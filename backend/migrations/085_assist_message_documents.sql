-- 085: Opal Assist — a reply can be an editable document.
--
-- A rephrase (email, letter, report section) or a case note is returned as a
-- small structured document the practitioner edits in place
-- (backend/assist/assist-document.js). Such a message stores that document
-- as JSON in `content`; `kind` says how to read it. Like every other turn it
-- holds tokens only — edits are de-identified and guarded before they are
-- saved, exactly as messages are before they are sent.
--
-- `edited_at` is set when the practitioner saves changes to the document.

ALTER TABLE assist_messages ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'text';
ALTER TABLE assist_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assist_messages_kind_check') THEN
    ALTER TABLE assist_messages ADD CONSTRAINT assist_messages_kind_check CHECK (kind IN ('text', 'document', 'casenote'));
  END IF;
END $$;
