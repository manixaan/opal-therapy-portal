-- ═══════════════════════════════════════════════════════════════════════════
-- 053 — Microsoft 365 account provisioning from onboarding
--
-- Onboarding can now create the employee's Microsoft 365 account (a work
-- address on the practice domain plus a licence) through Microsoft Graph.
-- What is stored is the LINK, never the credential: the Entra object id,
-- the address, which licence tier was chosen, and when it happened. The
-- temporary password is shown to the Owner once and never written down.
--
-- The users row carries the link so that deactivating an account can find
-- and disable the Microsoft side; the assignment row carries it so the
-- journey screen can show the step without a join to a user that may not
-- exist yet.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS m365_object_id       VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS m365_upn             VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS m365_licence         VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS m365_provisioned_at  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS m365_provisioned_by  UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS m365_disabled_at     TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_m365_object_id
  ON users (m365_object_id) WHERE m365_object_id IS NOT NULL;

ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS m365_object_id        VARCHAR(64);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS m365_upn              VARCHAR(255);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS m365_licence          VARCHAR(10);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS m365_licence_assigned BOOLEAN;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS m365_created_at       TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS m365_created_by       UUID REFERENCES users(id);
