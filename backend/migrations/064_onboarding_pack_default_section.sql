-- ═══════════════════════════════════════════════════════════════════════════
-- 064 — Onboarding pack defaults: the section a document files under
--
-- A document added to a package's default pack from a section heading
-- (Employment, Policies and agreements, …) keeps that heading, instead of
-- always falling to the phase's fallback section. NULL keeps the old
-- behaviour for existing rows.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE onboarding_pack_defaults ADD COLUMN IF NOT EXISTS section VARCHAR(40);
