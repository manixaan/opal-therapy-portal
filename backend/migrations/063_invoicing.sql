-- ═══════════════════════════════════════════════════════════════════════════
--  063 — Invoicing (owner-only): calendar-driven NDIS invoices
-- ═══════════════════════════════════════════════════════════════════════════
-- Invoices are built from calendar events (own + employee calendars) through
-- backend/ndis-billing-rules.js. Nothing here talks to Xero; a finished
-- invoice may later be pushed to Xero through the accounting module.
-- All DDL idempotent.

-- Per-client billing inputs the rules engine needs and the calendar does not
-- carry: funding, age band, MMM, agreed rate, service-agreement flags.
CREATE TABLE IF NOT EXISTS invoice_client_settings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     UUID REFERENCES organisations(id),
  client_id           VARCHAR(100) NOT NULL,          -- Splose patient id (events.client_id)
  client_name         VARCHAR(255),
  funding_type        VARCHAR(20) NOT NULL DEFAULT 'plan_managed', -- ndia_managed | plan_managed | self_managed
  age_band            VARCHAR(10) NOT NULL DEFAULT '9_plus',       -- 9_plus | under_9
  budget              VARCHAR(20) NOT NULL DEFAULT 'capacity_building', -- capacity_building | core | employment
  mmm                 SMALLINT NOT NULL DEFAULT 1 CHECK (mmm BETWEEN 1 AND 7),
  agreed_hourly_rate  NUMERIC(10,2),                  -- NULL = bill at the price limit
  per_km_rate         NUMERIC(6,2) NOT NULL DEFAULT 0.99,
  agreement           JSONB NOT NULL DEFAULT '{}'::jsonb, -- {telehealth,nonF2f,ndiaReports,cancellations,travel}: true|false
  invoice_to_name     VARCHAR(255),                   -- plan manager / participant / nominee
  invoice_to_email    VARCHAR(255),
  ndis_number         VARCHAR(40),
  notes               VARCHAR(500),
  updated_by_user_id  UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organisation_id, client_id)
);

-- Sequential numbering per organisation (INV-000001 …).
CREATE TABLE IF NOT EXISTS invoice_counters (
  organisation_id UUID PRIMARY KEY,
  next_number     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS invoices (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id         UUID REFERENCES organisations(id),
  invoice_number          VARCHAR(40) NOT NULL,
  batch_id                UUID,                       -- set when created by a batch run
  client_id               VARCHAR(100) NOT NULL,
  client_name             VARCHAR(255),
  invoice_to_name         VARCHAR(255),
  invoice_to_email        VARCHAR(255),
  practitioner_profile_id UUID REFERENCES therapist_profiles(id),
  practitioner_name       VARCHAR(255),
  issue_date              DATE NOT NULL,
  due_date                DATE,
  period_start            DATE,
  period_end              DATE,
  status                  VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft | approved | sent | paid | void
  subtotal                NUMERIC(14,2) NOT NULL DEFAULT 0,
  total                   NUMERIC(14,2) NOT NULL DEFAULT 0,
  warnings                JSONB NOT NULL DEFAULT '[]'::jsonb,   -- warning codes only, no client content
  reference               VARCHAR(255),
  notes                   VARCHAR(1000),
  xero_invoice_id         VARCHAR(100),
  created_by_user_id      UUID REFERENCES users(id),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  voided_at               TIMESTAMPTZ,
  UNIQUE (organisation_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_org_status ON invoices (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_org_client ON invoices (organisation_id, client_id);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  event_id      UUID REFERENCES events(id) ON DELETE SET NULL,
  kind          VARCHAR(30) NOT NULL,   -- direct | telehealth | non_f2f | ndia_report | cancellation | travel_labour | travel_non_labour
  item_code     VARCHAR(40),
  description   VARCHAR(500),
  service_date  DATE,
  minutes       NUMERIC(8,2),           -- pooled travel shares are fractional (35 min ÷ 3)
  quantity      NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_amount   NUMERIC(14,2) NOT NULL,
  price_limit   NUMERIC(14,2),
  amount        NUMERIC(14,2) NOT NULL,
  warnings      JSONB NOT NULL DEFAULT '[]'::jsonb,
  active        BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE once the invoice is voided
  sort_order    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines (invoice_id);
-- One live claim per event per kind: a repeated batch run cannot bill a
-- session twice. Voiding an invoice deactivates its lines and frees the event.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_lines_event_kind_active
  ON invoice_lines (event_id, kind) WHERE event_id IS NOT NULL AND active;
