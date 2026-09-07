-- ═══════════════════════════════════════════════════════════════════════════
-- 060 — Case-note de-identification record
--
-- Names are taken OUT of a dictation before it reaches the model and put
-- back afterwards (backend/ai/deidentify.js). Regeneration replays the same
-- substitution, so the draft keeps what the therapist decided at the names
-- check: which candidate words are people (confirmedNames), which are not
-- (ignoredWords), plus counts per token for the audit trail. Never the
-- transcript's text — that is already in `transcript`.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE case_note_drafts
  ADD COLUMN IF NOT EXISTS deidentification JSONB;

COMMENT ON COLUMN case_note_drafts.deidentification IS
  'Names-check decisions and token counts for this draft (060). {confirmedNames, ignoredWords, tokens:[{token,role,count}], version}';
