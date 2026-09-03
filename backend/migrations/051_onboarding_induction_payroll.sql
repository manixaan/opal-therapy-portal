-- ═══════════════════════════════════════════════════════════════════════════
-- 051 — Phase 3 (Internal Induction) and Payroll Setup
--
-- The document pack becomes PHASE-AWARE: the same onboarding_pack_items rows,
-- ZIP builder, Outlook draft and return processing serve the induction pack
-- as they serve the documentation pack. An induction item may also track an
-- internal task (Splose / Outlook / Portal account activated) or a training
-- requirement, rather than a document.
--
-- Payroll Setup is a review of information already gathered: nothing here
-- stores a new value, only the Owner's approval of the assembled set.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE onboarding_pack_items ADD COLUMN IF NOT EXISTS phase VARCHAR(20) NOT NULL DEFAULT 'documentation'
  CHECK (phase IN ('documentation', 'induction'));
ALTER TABLE onboarding_pack_items ADD COLUMN IF NOT EXISTS linked_task_code VARCHAR(60);
ALTER TABLE onboarding_pack_items ADD COLUMN IF NOT EXISTS item_kind VARCHAR(20) NOT NULL DEFAULT 'document'
  CHECK (item_kind IN ('document', 'account', 'training', 'action'));
ALTER TABLE onboarding_pack_items ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_onboarding_pack_items_phase ON onboarding_pack_items (assignment_id, phase, status);

-- Phase 3 milestones and Email 3 on the record.
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS induction_pack_prepared_at TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS induction_email_subject    VARCHAR(250);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS induction_email_body       TEXT;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS induction_email_draft_id   VARCHAR(300);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS induction_email_web_link   TEXT;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS induction_email_drafted_at TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS induction_email_drafted_by UUID REFERENCES users(id);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS induction_sent_at          TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS induction_sent_by          UUID REFERENCES users(id);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS induction_due_at           TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS induction_completed_at     TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS documentation_completed_at TIMESTAMPTZ;

-- Payroll Setup approval.
ALTER TABLE payroll_profiles ADD COLUMN IF NOT EXISTS payroll_approved_at TIMESTAMPTZ;
ALTER TABLE payroll_profiles ADD COLUMN IF NOT EXISTS payroll_approved_by UUID REFERENCES users(id);

-- Email 3 is one more kind of dispatch.
ALTER TABLE onboarding_email_dispatches DROP CONSTRAINT IF EXISTS onboarding_email_dispatches_kind_check;
ALTER TABLE onboarding_email_dispatches
  ADD CONSTRAINT onboarding_email_dispatches_kind_check CHECK (kind IN (
    'starter_pack', 'login_invitation', 'reminder', 'letter_of_offer', 'offer_reminder', 'onboarding_pack', 'induction_pack'
  ));
