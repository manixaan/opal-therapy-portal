-- ═══════════════════════════════════════════════════════════════════════════
-- 062 — Payroll & Xero Setup
--
-- The onboarding stage that turns an approved payroll set into an employee in
-- Opal Therapy's Xero Payroll AU organisation, through the Custom Connection.
--
-- WHAT IS AND IS NOT STORED HERE
-- ──────────────────────────────
-- payroll_xero_sync holds the WORKFLOW: the state machine, the Owner's pay
-- configuration, the approved (non-secret, masked) snapshot, the Xero
-- identifiers that come back, the idempotency key and attempt bookkeeping,
-- and a redacted last result. It never holds a TFN, a BSB, an account number,
-- an access token or a raw Xero request/response body. The secret values stay
-- in payroll_profiles (encrypted) and are decrypted in memory only for the
-- duration of a sync call.
--
-- payroll_xero_operations is the per-request log: which step, which
-- idempotency key, which HTTP status, which safe error code. It is what makes
-- a retry after a timeout safe — a create that may already have happened is
-- looked up before it is repeated.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payroll_xero_sync (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id            UUID REFERENCES organisations(id),
  assignment_id              UUID NOT NULL UNIQUE REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  user_id                    UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Workflow state. Uppercase on purpose: these are the names in the stage
  -- specification, and the UI maps them to plain-language labels.
  state                      VARCHAR(40) NOT NULL DEFAULT 'NOT_STARTED'
                               CHECK (state IN (
                                 'NOT_STARTED', 'APPLICANT_DRAFT', 'APPLICANT_SUBMITTED', 'ADMIN_REVIEW',
                                 'APPROVED_FOR_XERO', 'SYNC_IN_PROGRESS', 'SYNCED',
                                 'CHANGES_REQUESTED', 'SYNC_FAILED_RETRYABLE', 'SYNC_FAILED_ACTION_REQUIRED',
                                 'POSSIBLE_DUPLICATE', 'MANUAL_XERO_ACTION_REQUIRED')),
  -- Whether the employee will be picked up by the next regular pay run. Kept
  -- SEPARATE from `state`: SYNCED says the record is verified, this says
  -- whether payroll will pay them without someone opening Xero.
  next_pay_run_state         VARCHAR(40) NOT NULL DEFAULT 'UNKNOWN'
                               CHECK (next_pay_run_state IN (
                                 'UNKNOWN', 'READY_FOR_NEXT_PAY_RUN', 'INCLUDED_IN_DRAFT',
                                 'MANUAL_INCLUSION_REQUIRED', 'POSTED_PAY_RUN_REVIEW')),
  state_reason               VARCHAR(500),

  -- The Owner's employment and pay configuration (employee number, job title,
  -- employment basis, pay basis, rate, units, the CHOSEN Xero earnings rate,
  -- payroll calendar, leave lines, tax scale). Business settings only.
  config                     JSONB NOT NULL DEFAULT '{}'::jsonb,
  config_updated_at          TIMESTAMPTZ,
  config_updated_by          UUID REFERENCES users(id),

  -- The approved snapshot: every NON-SECRET field that will be sent, with bank
  -- and TFN values in their masked form. Immutable once approved; a new
  -- approval bumps the version. Read-back verification compares against it.
  approved_snapshot          JSONB,
  snapshot_version           INTEGER NOT NULL DEFAULT 0,
  approved_at                TIMESTAMPTZ,
  approved_by                UUID REFERENCES users(id),

  -- Consent evidence the applicant gave when they supplied the payroll data.
  privacy_notice_version     VARCHAR(40),
  privacy_notice_accepted_at TIMESTAMPTZ,
  privacy_notice_accepted_by UUID REFERENCES users(id),

  -- Identifiers Xero returned. Never a token.
  xero_tenant_id_suffix      VARCHAR(8),
  xero_employee_id           VARCHAR(60),
  xero_super_fund_id         VARCHAR(60),
  xero_super_membership_id   VARCHAR(60),
  xero_payroll_calendar_id   VARCHAR(60),
  xero_earnings_rate_id      VARCHAR(60),
  xero_leave_type_ids        TEXT[] NOT NULL DEFAULT '{}',
  xero_pay_run_id            VARCHAR(60),

  -- One logical operation per approval. Retries reuse it, so Xero sees the
  -- same Idempotency-Key and cannot create a second employee.
  operation_id               UUID,
  attempt_count              INTEGER NOT NULL DEFAULT 0,
  last_attempt_at            TIMESTAMPTZ,
  last_attempt_by            UUID REFERENCES users(id),
  retry_after                TIMESTAMPTZ,
  last_step                  VARCHAR(60),
  last_error_code            VARCHAR(80),
  last_error_message         VARCHAR(500),
  -- Redacted outcome of the read-back: which checks passed, which did not.
  verification               JSONB,
  -- Xero validation messages (safe text from Xero, capped) for the Owner.
  validation_messages        TEXT[] NOT NULL DEFAULT '{}',

  -- Owner/Admin checklist the API cannot do: include in an existing draft pay
  -- run, invite to Xero Me. Each is a code with a completed marker.
  manual_actions             JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Duplicate resolution, when the conservative check found a candidate.
  duplicate_candidates       JSONB,
  duplicate_resolution       VARCHAR(20)
                               CHECK (duplicate_resolution IS NULL OR duplicate_resolution IN ('link_existing', 'create_new')),
  duplicate_resolved_at      TIMESTAMPTZ,
  duplicate_resolved_by      UUID REFERENCES users(id),

  synced_at                  TIMESTAMPTZ,
  last_recheck_at            TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_xero_sync_org_state ON payroll_xero_sync (organisation_id, state);
CREATE INDEX IF NOT EXISTS idx_payroll_xero_sync_employee ON payroll_xero_sync (xero_employee_id);

CREATE TABLE IF NOT EXISTS payroll_xero_operations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_id           UUID NOT NULL REFERENCES payroll_xero_sync(id) ON DELETE CASCADE,
  operation_id      UUID NOT NULL,
  attempt           INTEGER NOT NULL,
  step              VARCHAR(60) NOT NULL,
  method            VARCHAR(8) NOT NULL,
  resource          VARCHAR(120) NOT NULL,
  idempotency_key   VARCHAR(128),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ,
  http_status       INTEGER,
  outcome           VARCHAR(20) NOT NULL DEFAULT 'started'
                      CHECK (outcome IN ('started', 'ok', 'validation_error', 'retryable_error', 'error', 'timeout')),
  error_code        VARCHAR(80),
  error_message     VARCHAR(500),
  xero_id           VARCHAR(60),
  actor_user_id     UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_xero_operations_sync ON payroll_xero_operations (sync_id, started_at);
CREATE INDEX IF NOT EXISTS idx_payroll_xero_operations_key ON payroll_xero_operations (idempotency_key);

-- The applicant's acceptance of the payroll privacy notice, recorded with the
-- payroll data itself so it travels with the record.
ALTER TABLE payroll_profiles ADD COLUMN IF NOT EXISTS privacy_notice_version     VARCHAR(40);
ALTER TABLE payroll_profiles ADD COLUMN IF NOT EXISTS privacy_notice_accepted_at TIMESTAMPTZ;
