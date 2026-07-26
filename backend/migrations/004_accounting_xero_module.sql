-- ═══════════════════════════════════════════════════════════════════════════
--  004 — Accounting / Xero module (owner-only finance)
-- ═══════════════════════════════════════════════════════════════════════════
-- Owner-only financial module. Splose stays the clinical/practice source of
-- truth; Xero stays the accounting source of truth; the portal is the
-- operational bridge. We cache only the minimal fields needed for matching,
-- dashboarding, invoicing workflow state, reconciliation workflow state, and
-- audit. Tokens are stored ENCRYPTED (AES-256-GCM via crypto-utils, "enc:"
-- prefix) — never in plaintext.
--
-- All DDL is idempotent (IF NOT EXISTS) so a re-run after partial failure is
-- safe. One org connection is expected for the pilot, but the schema is
-- keyed by organisation_id to stay multi-tenant-correct.

-- ── Connection + tokens ─────────────────────────────────────────────────────
-- One row per connected Xero tenant. connected_by_user_id records WHO linked
-- it (audit), but the connection belongs to the ORGANISATION context, never a
-- Xero-email-derived portal user (avoids the Outlook session-switch bug).
CREATE TABLE IF NOT EXISTS xero_connections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID REFERENCES organisations(id),
  xero_tenant_id        VARCHAR(100) NOT NULL,
  xero_tenant_name      VARCHAR(255),
  tenant_type           VARCHAR(50),
  connected_by_user_id  UUID REFERENCES users(id),
  -- Encrypted at rest ("enc:…"); decrypted only at the API choke point.
  access_token          TEXT,
  refresh_token         TEXT,
  token_expires_at      TIMESTAMPTZ,
  base_currency         VARCHAR(3),
  status                VARCHAR(20) NOT NULL DEFAULT 'connected',  -- connected | disconnected | error
  last_error            TEXT,
  connected_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, xero_tenant_id)
);

-- ── Sync state (per resource, per connection) ───────────────────────────────
CREATE TABLE IF NOT EXISTS xero_sync_state (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     UUID NOT NULL REFERENCES xero_connections(id) ON DELETE CASCADE,
  resource          VARCHAR(40) NOT NULL,   -- contacts | invoices | payments | accounts | items | organisation | reports
  last_synced_at    TIMESTAMPTZ,
  last_modified_ref TIMESTAMPTZ,            -- value passed as If-Modified-Since next run
  last_status       VARCHAR(20),           -- ok | error | blocked | running
  last_error        TEXT,
  records_synced    INTEGER DEFAULT 0,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (connection_id, resource)
);

-- ── Read-only caches (minimal fields only) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS xero_contacts_cache (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    UUID NOT NULL REFERENCES xero_connections(id) ON DELETE CASCADE,
  xero_contact_id  VARCHAR(100) NOT NULL,
  name             VARCHAR(255),
  email            VARCHAR(255),
  is_customer      BOOLEAN,
  updated_date_utc TIMESTAMPTZ,
  synced_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (connection_id, xero_contact_id)
);

CREATE TABLE IF NOT EXISTS xero_invoices_cache (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     UUID NOT NULL REFERENCES xero_connections(id) ON DELETE CASCADE,
  xero_invoice_id   VARCHAR(100) NOT NULL,
  invoice_number    VARCHAR(100),
  xero_contact_id   VARCHAR(100),
  contact_name      VARCHAR(255),
  type              VARCHAR(20),            -- ACCREC (sales) | ACCPAY
  status            VARCHAR(20),            -- DRAFT | SUBMITTED | AUTHORISED | PAID | VOIDED | DELETED
  invoice_date      DATE,
  due_date          DATE,
  currency_code     VARCHAR(3),
  sub_total         NUMERIC(14,2),
  total_tax         NUMERIC(14,2),
  total             NUMERIC(14,2),
  amount_due        NUMERIC(14,2),
  amount_paid       NUMERIC(14,2),
  reference         VARCHAR(255),
  updated_date_utc  TIMESTAMPTZ,
  synced_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (connection_id, xero_invoice_id)
);

CREATE TABLE IF NOT EXISTS xero_payments_cache (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id    UUID NOT NULL REFERENCES xero_connections(id) ON DELETE CASCADE,
  xero_payment_id  VARCHAR(100) NOT NULL,
  xero_invoice_id  VARCHAR(100),
  invoice_number   VARCHAR(100),
  xero_contact_id  VARCHAR(100),
  contact_name     VARCHAR(255),
  amount           NUMERIC(14,2),
  currency_code    VARCHAR(3),
  payment_date     DATE,
  reference        VARCHAR(255),
  status           VARCHAR(20),
  updated_date_utc TIMESTAMPTZ,
  synced_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (connection_id, xero_payment_id)
);

CREATE TABLE IF NOT EXISTS xero_accounts_cache (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES xero_connections(id) ON DELETE CASCADE,
  xero_account_id VARCHAR(100) NOT NULL,
  code            VARCHAR(50),
  name            VARCHAR(255),
  type            VARCHAR(50),
  tax_type        VARCHAR(50),
  class           VARCHAR(50),
  status          VARCHAR(20),
  synced_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (connection_id, xero_account_id)
);

CREATE TABLE IF NOT EXISTS xero_items_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES xero_connections(id) ON DELETE CASCADE,
  xero_item_id  VARCHAR(100) NOT NULL,
  code          VARCHAR(50),
  name          VARCHAR(255),
  description   TEXT,
  sales_unit_price NUMERIC(14,2),
  sales_account_code VARCHAR(50),
  sales_tax_type   VARCHAR(50),
  synced_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (connection_id, xero_item_id)
);

-- Dashboard snapshots (pre-aggregated report figures) — keeps dashboards cheap
-- and avoids re-hitting the reports API on every page load.
CREATE TABLE IF NOT EXISTS finance_dashboard_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  UUID NOT NULL REFERENCES xero_connections(id) ON DELETE CASCADE,
  snapshot_type  VARCHAR(40) NOT NULL,     -- overview | aged_receivables | revenue_by_month
  period_key     VARCHAR(20),              -- e.g. 2026-07
  data           JSONB NOT NULL,           -- aggregated figures only, no client content
  generated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (connection_id, snapshot_type, period_key)
);

-- ── Splose↔Xero mapping layer ───────────────────────────────────────────────
-- Maps a Splose service to a Xero item/account + a default billing rule.
CREATE TABLE IF NOT EXISTS finance_service_mappings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    UUID REFERENCES organisations(id),
  splose_service_id  VARCHAR(100),
  splose_service_name VARCHAR(255),
  xero_item_code     VARCHAR(50),
  xero_account_code  VARCHAR(50),
  tax_type           VARCHAR(50),
  status             VARCHAR(30) NOT NULL DEFAULT 'unmapped', -- mapped | unmapped | ambiguous | manual_review_required | ignored
  created_by_user_id UUID REFERENCES users(id),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, splose_service_id)
);

-- Maps a Splose client to a Xero contact.
CREATE TABLE IF NOT EXISTS finance_contact_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   UUID REFERENCES organisations(id),
  splose_client_id  VARCHAR(100),
  xero_contact_id   VARCHAR(100),
  match_confidence  VARCHAR(20),           -- high | medium | low
  status            VARCHAR(30) NOT NULL DEFAULT 'unmapped',
  created_by_user_id UUID REFERENCES users(id),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, splose_client_id)
);

-- ── Pricing engine ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_pricing_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   UUID REFERENCES organisations(id),
  name              VARCHAR(255) NOT NULL,
  splose_service_id VARCHAR(100),          -- NULL = applies to any service
  appointment_type  VARCHAR(50),           -- therapy | travel | report | telehealth | ... (NULL = any)
  funding_type      VARCHAR(50),           -- ndis | private | plan_managed | self_managed (NULL = any)
  mmm_classification VARCHAR(10),          -- rural/remote loading key (NULL = any)
  support_item_code VARCHAR(50),
  unit_amount       NUMERIC(14,2) NOT NULL,
  tax_type          VARCHAR(50) NOT NULL DEFAULT 'NONE',
  xero_account_code VARCHAR(50),
  xero_item_code    VARCHAR(50),
  effective_from    DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to      DATE,                  -- NULL = open-ended
  priority          INTEGER NOT NULL DEFAULT 100, -- lower = more specific, wins
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_lookup
  ON finance_pricing_rules (organisation_id, active, priority);

-- ── Invoice candidates ──────────────────────────────────────────────────────
-- One candidate per billable Splose appointment. UNIQUE on the appointment
-- guarantees a repeated generation job cannot create duplicates.
CREATE TABLE IF NOT EXISTS finance_invoice_candidates (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      UUID REFERENCES organisations(id),
  splose_appointment_id VARCHAR(100) NOT NULL,
  splose_client_id     VARCHAR(100),
  splose_service_id    VARCHAR(100),
  practitioner_ref     VARCHAR(100),
  appointment_date     DATE,
  appointment_status   VARCHAR(40),
  xero_contact_id      VARCHAR(100),
  xero_invoice_id      VARCHAR(100),        -- set once a draft is created in Xero
  status               VARCHAR(30) NOT NULL DEFAULT 'draft_candidate',
    -- draft_candidate | needs_mapping | needs_pricing | duplicate_risk
    -- | ready_for_review | approved_for_draft | draft_created_in_xero | ignored | error
  currency_code        VARCHAR(3) DEFAULT 'AUD',
  total_amount         NUMERIC(14,2),
  total_tax            NUMERIC(14,2),
  warnings             JSONB,               -- array of warning codes, no client content
  pricing_source       VARCHAR(255),
  manual_override_reason TEXT,
  reviewed_by_user_id  UUID REFERENCES users(id),
  reviewed_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, splose_appointment_id)
);
CREATE INDEX IF NOT EXISTS idx_invoice_candidates_status
  ON finance_invoice_candidates (organisation_id, status);

CREATE TABLE IF NOT EXISTS finance_invoice_candidate_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  UUID NOT NULL REFERENCES finance_invoice_candidates(id) ON DELETE CASCADE,
  description   VARCHAR(500),
  quantity      NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_amount   NUMERIC(14,2) NOT NULL,
  tax_type      VARCHAR(50),
  account_code  VARCHAR(50),
  item_code     VARCHAR(50),
  line_total    NUMERIC(14,2),
  sort_order    INTEGER DEFAULT 0
);

-- Records every invoice ACTION taken (draft created, etc.) with the Xero result.
CREATE TABLE IF NOT EXISTS finance_invoice_actions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  UUID REFERENCES finance_invoice_candidates(id) ON DELETE SET NULL,
  action        VARCHAR(40) NOT NULL,       -- draft_created | approve | send | payment_applied
  actor_user_id UUID REFERENCES users(id),
  xero_invoice_id VARCHAR(100),
  xero_result   VARCHAR(20),                -- success | error
  detail        VARCHAR(500),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Reconciliation assistant (suggestion-only; NOT bank reconciliation) ──────
CREATE TABLE IF NOT EXISTS finance_reconciliation_candidates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   UUID REFERENCES organisations(id),
  connection_id     UUID REFERENCES xero_connections(id) ON DELETE CASCADE,
  xero_payment_id   VARCHAR(100),
  xero_invoice_id   VARCHAR(100),
  match_type        VARCHAR(40),            -- exact | partial | overpayment | underpayment | reference | ambiguous | unmatched_payment | unmatched_invoice
  confidence        VARCHAR(20),            -- high | medium | low | manual_review_required
  amount_payment    NUMERIC(14,2),
  amount_invoice    NUMERIC(14,2),
  reasons           JSONB,                  -- why this was suggested (codes only)
  decision          VARCHAR(20) NOT NULL DEFAULT 'suggested', -- suggested | accepted | rejected | needs_xero_reconciliation
  decided_by_user_id UUID REFERENCES users(id),
  decided_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recon_candidates_decision
  ON finance_reconciliation_candidates (organisation_id, decision);

-- ── Sync + audit logs ───────────────────────────────────────────────────────
-- Operational sync log for the finance sync layer (distinct from the app-wide
-- audit_logs, which still records every financial ACTION via logAuditEvent).
CREATE TABLE IF NOT EXISTS finance_sync_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID REFERENCES xero_connections(id) ON DELETE CASCADE,
  resource      VARCHAR(40),
  status        VARCHAR(20),                -- ok | error | blocked
  records       INTEGER DEFAULT 0,
  duration_ms   INTEGER,
  message       VARCHAR(500),               -- sanitised; never tokens/payloads
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_finance_sync_log_created
  ON finance_sync_log (connection_id, created_at);
