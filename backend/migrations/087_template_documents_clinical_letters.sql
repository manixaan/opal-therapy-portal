-- ═══════════════════════════════════════════════════════════════════════════
--  087 — Template documents: Support Letter and Progress Report
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Two new controlled masters join the Templates catalogue:
--   support_letter   fca/templates/support-letter-v1.docx
--   progress_report  fca/templates/progress-report-v1.docx
--
-- The CHECK constraint from 043 names every template id a document may carry,
-- so it is widened here. 'progress_note' stays allowed: the card is retired
-- (no new documents), but documents already started from it remain valid and
-- keep opening and exporting.
--
-- Drop-and-recreate is idempotent: re-running leaves the same constraint.

ALTER TABLE template_documents
  DROP CONSTRAINT IF EXISTS valid_template_document_template_id;

ALTER TABLE template_documents
  ADD CONSTRAINT valid_template_document_template_id
  CHECK (template_id IN ('service_agreement', 'progress_note', 'fca', 'support_letter', 'progress_report'));
