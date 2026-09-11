-- ═══════════════════════════════════════════════════════════════════════════
-- 066 — Letter of Offer: wording edited for one record
--
-- "Edit the letter" on a record used to edit the practice-wide template.
-- The wording of a single letter can now be edited on its own: the record
-- keeps its own copy of the template (the practice's wording with this
-- record's edits applied, fields still as fields) and the letter regenerates
-- from it, so a later change to the terms still flows into the letter.
-- It is one more kind of offer document — 'wording' — beside the uploaded
-- letter and the signed copy. At most one live file of each kind.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE onboarding_offer_documents DROP CONSTRAINT IF EXISTS onboarding_offer_documents_kind_check;
ALTER TABLE onboarding_offer_documents ADD CONSTRAINT onboarding_offer_documents_kind_check
  CHECK (kind IN ('letter', 'signed', 'wording'));
