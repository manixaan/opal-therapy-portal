-- 096: drafts prepared in the background.
--
-- Each night the portal drafts the current week so far (Monday → today) for
-- every practitioner, so "Create drafts" on Monday only tops up what changed.
-- The run is the same idempotent run the owner presses: lines already on a
-- draft are recalculated in place, nothing is claimed twice, finalised
-- invoices are never touched.

ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS auto_drafts_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS auto_drafts_last_date DATE;
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS auto_drafts_last_at TIMESTAMPTZ;
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS auto_drafts_last_period JSONB;
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS auto_drafts_last_error TEXT;

-- The owner's answer for a calendar block invoicing cannot judge on its own
-- (a report-writing block with no matching Splose activity): bill it from the
-- calendar, it is not billable, or Splose bills it. Asked once, remembered.
CREATE TABLE IF NOT EXISTS billing_event_decisions (
  event_id        UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  decision        VARCHAR(20) NOT NULL CHECK (decision IN ('BILL', 'NOT_BILLABLE', 'SPLOSE')),
  set_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  set_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_event_decisions_org ON billing_event_decisions (organisation_id);
