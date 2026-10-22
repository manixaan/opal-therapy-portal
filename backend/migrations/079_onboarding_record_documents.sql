-- ═══════════════════════════════════════════════════════════════════════════
-- 079 — Onboarding: the record's own contract and position description
--
-- The portal route asks the starter to acknowledge their Employment contract
-- and Position description, but neither requirement pointed at a document:
-- the starter "acknowledged" nothing (audit B-5). Both are personal to the
-- record, so the Owner attaches them to it — two more kinds of offer document
-- beside the uploaded letter, the signed copy and the edited wording. At most
-- one live file of each kind (uq_onboarding_offer_document_live, 048).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE onboarding_offer_documents DROP CONSTRAINT IF EXISTS onboarding_offer_documents_kind_check;
ALTER TABLE onboarding_offer_documents ADD CONSTRAINT onboarding_offer_documents_kind_check
  CHECK (kind IN ('letter', 'signed', 'wording', 'contract', 'position_description'));
