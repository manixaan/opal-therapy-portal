-- ═══════════════════════════════════════════════════════════════════════════
-- 063 — Onboarding document checks
--
-- Every document uploaded into an onboarding (the signed letter of offer and
-- each returned document) is read by the portal before it counts: its
-- fillable fields are listed and the blank ones flagged. The result is kept
-- beside the document so the Owner sees what was checked and the Submit step
-- can ask before an incomplete document is accepted.
--
-- check_result: { status: 'ok' | 'attention' | 'unreadable' | 'unchecked',
--                 method, fields: [{ label, filled, preview? }], issues: [{ code, message }],
--                 checkedAt }
-- Field values are not stored for returned documents (they may be a TFN or a
-- bank account); only whether each field was filled.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE onboarding_offer_documents    ADD COLUMN IF NOT EXISTS check_result JSONB;
ALTER TABLE onboarding_returned_documents ADD COLUMN IF NOT EXISTS check_result JSONB;
