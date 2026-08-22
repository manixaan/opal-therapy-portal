-- ═══════════════════════════════════════════════════════════════════════════
--  040 — Record what an AI call actually consumed
-- ═══════════════════════════════════════════════════════════════════════════
-- Bedrock returns input and output token counts on every successful
-- invocation, and the provider was discarding them. That left the practice
-- unable to answer the two questions that decide whether AI use can safely
-- grow: what does a feature cost, and how close is a request to the model's
-- context window. Both were previously answerable only by reading an AWS bill
-- that does not break down by feature, or not at all.
--
-- ── WHY THIS DOES NOT BREACH THE TABLE'S RULE ─────────────────────────────
-- ai_interactions holds no clinical content, and that rule is structural
-- rather than documented: backend/ai/ai-audit.js builds every row from a fixed
-- field allowlist and rejects objects and arrays outright.
--
-- Token counts are INTEGERS. They cannot carry a transcript, a client name or
-- a prompt — the most they disclose is that one request was larger than
-- another, which is the entire point of recording them. They are therefore the
-- rare addition that increases what the register can answer without increasing
-- what it holds.
--
-- ── WHY NULLABLE, AND WHY NOT DEFAULT 0 ───────────────────────────────────
-- NULL means "no count applies", and three real states produce it:
--   * a reserved clinical row, written BEFORE the model is called
--   * a denial — the call never happened, so nothing was consumed
--   * a provider error, or a response whose usage block did not parse
-- A default of 0 would render all three as "a call that consumed nothing",
-- which is a different and false claim. Aggregations must be able to exclude
-- rows that have no answer rather than average a fabricated zero in.
--
-- Every historical row keeps NULL. Backfilling is impossible — the counts were
-- never received — and inventing them would corrupt the first cost baseline
-- this table is able to produce.

ALTER TABLE ai_interactions
  ADD COLUMN IF NOT EXISTS input_tokens  INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER;

-- A negative count is a parsing fault, not data. Refuse it at the boundary
-- rather than discover it later in a cost report that quietly does not add up.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_interactions_token_counts_chk'
  ) THEN
    ALTER TABLE ai_interactions
      ADD CONSTRAINT ai_interactions_token_counts_chk
      CHECK ((input_tokens  IS NULL OR input_tokens  >= 0)
         AND (output_tokens IS NULL OR output_tokens >= 0));
  END IF;
END $$;

-- Supports "what did each feature consume over this period", which is the only
-- query these columns exist to serve. Partial, because rows without counts
-- (denials, reservations) are exactly the ones a usage report excludes.
CREATE INDEX IF NOT EXISTS idx_ai_interactions_usage
  ON ai_interactions (feature, created_at DESC)
  WHERE input_tokens IS NOT NULL;
