-- ═══════════════════════════════════════════════════════════════════════════
--  006 — Accounting Phase 2 slice 1: exception items + mapping metadata
-- ═══════════════════════════════════════════════════════════════════════════
-- The exception dashboard is the operational control centre for accounting
-- automation. Items are UPSERTED by the exception engine (dedup key below)
-- and carry no client content — identifiers, codes and counts only.
--
-- NULL-org note: this deployment runs with organisation_id NULL, and
-- Postgres UNIQUE treats NULLs as distinct — a plain UNIQUE(organisation_id,
-- …) key never fires ON CONFLICT. All dedupe/idempotency keys here (and the
-- repairs for two 004 tables below) therefore use COALESCE-to-zero-UUID
-- unique expression indexes, which PG 14 supports.

CREATE TABLE IF NOT EXISTS accounting_exception_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES organisations(id),
  exception_type  VARCHAR(60) NOT NULL,   -- unmapped_contact | missing_account_code | missing_tax_rate
                                          -- | missing_tracking | duplicate_invoice_risk | not_invoiced
                                          -- | candidate_blocked | sync_error | stale_draft | needs_review
  severity        VARCHAR(10) NOT NULL DEFAULT 'medium',  -- high | medium | low
  source          VARCHAR(40),            -- candidates | contacts | sync | invoices
  affected_type   VARCHAR(40),            -- invoice_candidate | contact_mapping | sync_run | ...
  affected_id     VARCHAR(120),           -- internal id / splose id / xero id (never names)
  explanation     VARCHAR(400),
  suggested_action VARCHAR(300),
  status          VARCHAR(20) NOT NULL DEFAULT 'open',    -- open | resolved | dismissed
  resolved_by     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_acct_exception_dedupe
  ON accounting_exception_items (
    COALESCE(organisation_id, '00000000-0000-0000-0000-000000000000'::uuid),
    exception_type, affected_type, affected_id);
CREATE INDEX IF NOT EXISTS idx_acct_exceptions_open
  ON accounting_exception_items (organisation_id, status, severity);

-- Contact-mapping metadata: WHY a suggestion has its confidence, and
-- duplicate reasoning on candidates.
ALTER TABLE finance_contact_mappings
  ADD COLUMN IF NOT EXISTS match_reason VARCHAR(50);   -- existing|email|name_exact|name_fuzzy|multiple|none|manual
ALTER TABLE finance_invoice_candidates
  ADD COLUMN IF NOT EXISTS duplicate_reason VARCHAR(120);

-- ── Idempotency repair for 004 tables under NULL organisation_id ────────────
-- The 004 UNIQUE(organisation_id, …) constraints never dedupe when the org is
-- NULL, so contact-mapping and candidate upserts would duplicate on every
-- run. These expression indexes give ON CONFLICT a working target. Both
-- tables are empty until this slice's code ships, so creation is safe.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_mapping_dedupe
  ON finance_contact_mappings (
    COALESCE(organisation_id, '00000000-0000-0000-0000-000000000000'::uuid),
    splose_client_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_candidate_dedupe
  ON finance_invoice_candidates (
    COALESCE(organisation_id, '00000000-0000-0000-0000-000000000000'::uuid),
    splose_appointment_id);
