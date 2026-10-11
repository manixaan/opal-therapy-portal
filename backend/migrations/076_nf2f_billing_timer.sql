-- 076: Non-face-to-face billable time (billing/nf2f-timer.js, nf2f-routes.js).
--
-- A non-face-to-face block (case noting, case management, emails, phone
-- calls, resource prep) can name several clients, or none (then it is not
-- billable). With clients, the clinician runs a timer on the block; the timed
-- seconds are billed, split across the clients — equally by default, or by
-- the percentages chosen in "Allocate billing", less any non-billable share.
-- The timer stops itself once it has run for the block's length.
--
-- One timer row per block. Allocation is [{clientId, clientName, percent}];
-- NULL means an equal split. Invoicing bills each client as an NF2F line.

CREATE TABLE IF NOT EXISTS event_billing_timers (
  event_id             UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  organisation_id      UUID REFERENCES organisations(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status               VARCHAR(10) NOT NULL DEFAULT 'IDLE' CHECK (status IN ('IDLE', 'RUNNING', 'STOPPED')),
  run_started_at       TIMESTAMPTZ,
  accumulated_seconds  INTEGER NOT NULL DEFAULT 0 CHECK (accumulated_seconds >= 0),
  limit_seconds        INTEGER NOT NULL CHECK (limit_seconds > 0),
  auto_stopped         BOOLEAN NOT NULL DEFAULT FALSE,
  stopped_at           TIMESTAMPTZ,
  non_billable_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (non_billable_percent BETWEEN 0 AND 100),
  allocation           JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_event_billing_timers_running ON event_billing_timers (user_id) WHERE status = 'RUNNING';

-- Invoice lines: a non-face-to-face component, one live claim per block per client.
ALTER TABLE invoice_lines DROP CONSTRAINT IF EXISTS invoice_lines_component_check;
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_component_check
  CHECK (component IN ('SESSION', 'TRAVEL_LABOUR', 'TRAVEL_KM', 'TRIP_COST', 'MANUAL', 'NF2F'));

DROP INDEX IF EXISTS uq_invoice_lines_event_component;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_lines_event_component
  ON invoice_lines (calendar_event_id, component)
  WHERE calendar_event_id IS NOT NULL AND line_status IN ('ACTIVE', 'REMOVED') AND component <> 'NF2F';
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_lines_event_nf2f_client
  ON invoice_lines (calendar_event_id, client_id)
  WHERE calendar_event_id IS NOT NULL AND line_status IN ('ACTIVE', 'REMOVED') AND component = 'NF2F';
