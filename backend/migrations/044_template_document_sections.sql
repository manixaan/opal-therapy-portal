-- ═══════════════════════════════════════════════════════════════════════════
--  044 — Template document section structure (FCA in Templates)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A therapist completing the FCA through Templates can now shape the report's
-- section structure before export: preview the sections, drop an optional one,
-- restore it, and reorder among siblings. The choice belongs to ONE document
-- instance — the master is never touched — so it lives here, beside the
-- instance's field answers.
--
-- Shape: { "selected": ["OPAL_SECTION_..."], "order": ["OPAL_SECTION_..."] }.
-- NULL means the default: every section, in the master's own order — exactly
-- what every existing row already renders, so no backfill is needed.
--
-- The stored value is advisory, not authoritative: composition re-normalises
-- it through fca/manifest.js on every render, which drops unknown tags and
-- re-adds required sections whatever was stored. A row written by a regressed
-- or hostile client therefore cannot remove a mandatory clinical section.

ALTER TABLE template_documents
  ADD COLUMN IF NOT EXISTS sections JSONB;

COMMENT ON COLUMN template_documents.sections IS
  'Optional section selection/order for templates with a section catalogue (the FCA): {"selected": [tags], "order": [tags]}. NULL = complete master in master order. Re-normalised on every compose; required sections cannot be removed.';
