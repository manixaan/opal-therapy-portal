-- ═══════════════════════════════════════════════════════════════════════════
-- 047 — The three-stage onboarding journey
--
--   1. Letter of Offer            → onboarding_offers
--   2. Onboarding Documentation   → onboarding_requirements (034, unchanged)
--   3. Internal Induction & Access→ onboarding_internal_tasks
--
-- Additive only. onboarding_assignments stays the single record for a person
-- from offer to completion; its status ladder (034/038) is NOT widened. The
-- offer stage happens entirely while status = 'created', and acceptance is
-- what performs the release that 034 already defines. That keeps every
-- existing guard ("release requires created", recomputeAssignment's
-- pre-release set) true without a second ladder to keep in step.
--
-- The offer TERMS are also copied onto the assignment (pay basis, rate, hours,
-- award, probation) because they are the facts every later stage reuses —
-- the employment profile at release, the payroll task at induction — and the
-- Owner must never be asked to type them twice.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Offer terms on the record ───────────────────────────────────────────────
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS pay_basis            VARCHAR(10)
  CHECK (pay_basis IS NULL OR pay_basis IN ('annual', 'hourly'));
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS pay_rate             NUMERIC(12,2);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS hours_per_week       NUMERIC(5,2);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS award_classification VARCHAR(150);
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS probation_months     INTEGER
  CHECK (probation_months IS NULL OR (probation_months >= 0 AND probation_months <= 12));
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS offer_accepted_at    TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS offer_declined_at    TIMESTAMPTZ;
ALTER TABLE onboarding_assignments ADD COLUMN IF NOT EXISTS induction_started_at TIMESTAMPTZ;

-- ── 1. Letters of offer ─────────────────────────────────────────────────────
-- One row per issued version. A declined or withdrawn offer is kept and a new
-- version is issued beside it, so the history of what was offered is never
-- rewritten. `terms` is the frozen snapshot the letter was generated from.
CREATE TABLE IF NOT EXISTS onboarding_offers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID REFERENCES organisations(id),
  assignment_id         UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  version               INTEGER NOT NULL DEFAULT 1,
  status                VARCHAR(20) NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'approved', 'sent', 'accepted',
                                            'declined', 'withdrawn', 'not_required')),
  terms                 JSONB NOT NULL DEFAULT '{}',

  approved_at           TIMESTAMPTZ,
  approved_by           UUID REFERENCES users(id),
  sent_at               TIMESTAMPTZ,
  sent_by               UUID REFERENCES users(id),
  sent_to               VARCHAR(255),
  reminder_count        INTEGER NOT NULL DEFAULT 0,
  last_reminder_at      TIMESTAMPTZ,
  first_viewed_at       TIMESTAMPTZ,
  responded_at          TIMESTAMPTZ,
  signed_name           VARCHAR(200),
  decline_reason        VARCHAR(1000),
  withdrawn_at          TIMESTAMPTZ,
  withdrawn_by          UUID REFERENCES users(id),
  withdraw_reason       VARCHAR(500),

  -- The response link. Only the sha256 of the token is stored.
  response_token_hash   VARCHAR(64),
  token_expires_at      TIMESTAMPTZ,

  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_onboarding_offer_version UNIQUE (assignment_id, version)
);

-- At most one offer can be open at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_offer_live
  ON onboarding_offers (assignment_id)
  WHERE status IN ('draft', 'approved', 'sent');

CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_offer_token
  ON onboarding_offers (response_token_hash)
  WHERE response_token_hash IS NOT NULL;

-- ── 3. Internal induction & access tasks ────────────────────────────────────
-- Generated from a checklist keyed to the role when the record reaches the
-- induction stage. `automation` names a portal action the task can run itself
-- (portal_access = activate the account); a NULL automation is a task a named
-- person does by hand and ticks off.
CREATE TABLE IF NOT EXISTS onboarding_internal_tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   UUID REFERENCES organisations(id),
  assignment_id     UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  code              VARCHAR(60) NOT NULL,
  title             VARCHAR(200) NOT NULL,
  description       VARCHAR(1000),
  automation        VARCHAR(40),
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'in_progress', 'done', 'skipped', 'failed')),
  assignee_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  due_at            TIMESTAMPTZ,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  completed_at      TIMESTAMPTZ,
  completed_by      UUID REFERENCES users(id),
  note              VARCHAR(1000),
  detail            JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_onboarding_internal_task UNIQUE (assignment_id, code)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_internal_tasks_open
  ON onboarding_internal_tasks (organisation_id, status)
  WHERE status IN ('pending', 'in_progress');

-- ── Email dispatch kinds for the offer stage ────────────────────────────────
-- 038 records every onboarding email in onboarding_email_dispatches. The
-- letter of offer and its reminder are two more kinds of the same thing.
ALTER TABLE onboarding_email_dispatches DROP CONSTRAINT IF EXISTS onboarding_email_dispatches_kind_check;
ALTER TABLE onboarding_email_dispatches
  ADD CONSTRAINT onboarding_email_dispatches_kind_check CHECK (kind IN (
    'starter_pack', 'login_invitation', 'reminder', 'letter_of_offer', 'offer_reminder'
  ));
