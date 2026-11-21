-- 083: The payer directory (billing/payer-directory.js).
--
-- Who invoices go to, remembered by Opal itself so it no longer depends on
-- Splose being switched on:
--   billing_payers          one row per payer (plan manager, participant,
--                           nominee…). Seeded from every Splose invoice's
--                           contact; owners add new ones. Duplicate Splose
--                           contacts with the same type and name are one payer.
--   billing_payer_invoices  every invoice ever sent and to whom: the Splose
--                           history, then each finalised Opal invoice. A
--                           client's latest row is where their next invoice
--                           goes when their profile has no payer yet.
--   billing_profiles.payer_id  the client's chosen payer.

CREATE TABLE IF NOT EXISTS billing_payers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  payer_type          VARCHAR(20) NOT NULL CHECK (payer_type IN ('PLAN_MANAGER', 'PARTICIPANT', 'NOMINEE', 'OTHER')),
  name                VARCHAR(255) NOT NULL,
  name_key            VARCHAR(255) NOT NULL,
  email               VARCHAR(255),
  address             TEXT,
  reference           VARCHAR(255),
  source              VARCHAR(20) NOT NULL DEFAULT 'OWNER' CHECK (source IN ('SPLOSE_IMPORT', 'OWNER')),
  splose_contact_ids  TEXT[] NOT NULL DEFAULT '{}',
  archived            BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_payers_name ON billing_payers (organisation_id, payer_type, name_key);

CREATE TABLE IF NOT EXISTS billing_payer_invoices (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  payer_id           UUID NOT NULL REFERENCES billing_payers(id) ON DELETE CASCADE,
  client_id          VARCHAR(255) NOT NULL,
  source             VARCHAR(10) NOT NULL CHECK (source IN ('SPLOSE', 'OPAL')),
  source_invoice_id  VARCHAR(64) NOT NULL,
  invoice_number     VARCHAR(40),
  issue_date         DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, source, source_invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_billing_payer_invoices_client ON billing_payer_invoices (organisation_id, client_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_billing_payer_invoices_payer ON billing_payer_invoices (payer_id);

ALTER TABLE billing_profiles ADD COLUMN IF NOT EXISTS payer_id UUID REFERENCES billing_payers(id) ON DELETE SET NULL;
