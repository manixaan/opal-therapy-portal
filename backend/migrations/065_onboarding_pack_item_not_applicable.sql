-- ═══════════════════════════════════════════════════════════════════════════
-- 065 — Onboarding pack items: a returned document marked "not applicable"
--
-- A supporting document that does not apply to this person (visa evidence for
-- a citizen, say) can be set aside by the practice instead of waiting for it.
-- It no longer counts towards the documentation stage, so internal induction
-- can begin without an upload against it. Reversible from the same slot.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE onboarding_pack_items DROP CONSTRAINT IF EXISTS onboarding_pack_items_verification_status_check;
ALTER TABLE onboarding_pack_items ADD CONSTRAINT onboarding_pack_items_verification_status_check
  CHECK (verification_status IN ('pending', 'verified', 'attention', 'rejected', 'not_applicable'));
