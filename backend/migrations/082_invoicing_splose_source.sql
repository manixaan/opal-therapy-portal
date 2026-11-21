-- 082: Invoicing reads Splose (billing/splose-billing-source.js).
--
-- 1. The payer. Splose's client record does not say who the plan manager is;
--    the only link is the contact on the client's latest Splose invoice. A
--    payer filled from there records where it came from, and an owner edit
--    clears that.
-- 2. Splose support activities (report writing, non-face-to-face work logged
--    in Splose) become SPLOSE_ACTIVITY invoice lines. One live claim per
--    activity, the same guard the calendar components have.
-- 3. Numbering continues after Splose's: the highest number Splose has issued
--    with the same prefix is remembered, so Opal never allocates one at or
--    below it even when Splose cannot be read.

ALTER TABLE billing_profiles ADD COLUMN IF NOT EXISTS payer_source VARCHAR(30);
ALTER TABLE billing_profiles ADD COLUMN IF NOT EXISTS payer_source_detail VARCHAR(255);

ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS splose_invoice_number_high INTEGER;
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS splose_numbers_checked_at TIMESTAMPTZ;

ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS splose_activity_id VARCHAR(40);

ALTER TABLE invoice_lines DROP CONSTRAINT IF EXISTS invoice_lines_component_check;
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_component_check
  CHECK (component IN ('SESSION', 'TRAVEL_LABOUR', 'TRAVEL_KM', 'TRIP_COST', 'MANUAL', 'NF2F', 'SPLOSE_ACTIVITY'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_lines_splose_activity
  ON invoice_lines (organisation_id, splose_activity_id)
  WHERE splose_activity_id IS NOT NULL AND line_status IN ('ACTIVE', 'REMOVED');
