-- 092 — A copy of every sent Opal invoice in Xero, exactly once (21 Nov 2026).
--
-- Owner decision (30 Oct + 21 Nov 2026): Opal creates and emails the invoice;
-- a copy goes to Xero as AUTHORISED with the SAME invoice number; Xero never
-- emails it; payments are tracked in Xero (bank feed) and flow back to Opal.
--
-- xero_invoice_links — one row per Opal invoice copied to Xero. The row is
-- claimed (PENDING) before the Xero call, and the call carries a fixed
-- Idempotency-Key, so a retry or a timeout can never make a second Xero
-- invoice. A Xero invoice number is unique per tenant here.
CREATE TABLE IF NOT EXISTS xero_invoice_links (
  invoice_id        UUID PRIMARY KEY REFERENCES invoices(id) ON DELETE RESTRICT,
  organisation_id   UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  xero_tenant_id    VARCHAR(64) NOT NULL,
  invoice_number    VARCHAR(40) NOT NULL,
  idempotency_key   VARCHAR(120) NOT NULL,
  state             VARCHAR(12) NOT NULL DEFAULT 'PENDING'
                    CHECK (state IN ('PENDING', 'PUSHED', 'FAILED', 'VOIDED')),
  xero_invoice_id   VARCHAR(64),
  xero_contact_id   VARCHAR(64),
  xero_status       VARCHAR(20),
  xero_total        NUMERIC(14,2),
  xero_amount_paid  NUMERIC(14,2),
  last_error        TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  pushed_at         TIMESTAMPTZ,
  payments_synced_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (xero_tenant_id, invoice_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_xero_invoice_links_xero_id
  ON xero_invoice_links (xero_tenant_id, xero_invoice_id) WHERE xero_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_xero_invoice_links_open
  ON xero_invoice_links (organisation_id) WHERE state = 'PUSHED';

-- Which Xero contact each payer is (plan manager, participant, nominee).
-- Filled automatically only on an exact, single name match; otherwise the
-- owner maps it. Never guessed.
CREATE TABLE IF NOT EXISTS xero_payer_contacts (
  organisation_id   UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  payer_key         VARCHAR(300) NOT NULL,
  xero_tenant_id    VARCHAR(64) NOT NULL,
  xero_contact_id   VARCHAR(64) NOT NULL,
  contact_name      VARCHAR(255),
  source            VARCHAR(20) NOT NULL CHECK (source IN ('EXACT_MATCH', 'CREATED', 'OWNER')),
  set_by_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organisation_id, xero_tenant_id, payer_key)
);

-- Xero coding for invoice lines (owner settings). NULL account code = not
-- set up: nothing is pushed until it is.
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS xero_sales_account_code VARCHAR(20);
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS xero_tax_type_gst_free VARCHAR(30) NOT NULL DEFAULT 'EXEMPTOUTPUT';
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS xero_tax_type_gst VARCHAR(30) NOT NULL DEFAULT 'OUTPUT';
