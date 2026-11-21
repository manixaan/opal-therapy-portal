-- 089 — Non-face-to-face blocks that ended with no time entered (21 Nov 2026).
--
-- A billable non-face-to-face block (case noting, report writing…) whose
-- timer was never run used to bill $0 without a word. Now the clinician must
-- resolve it: claim the whole block (split evenly across its clients), give
-- each client's minutes, or say the work did not happen (not billed; the
-- owner is notified). Until resolved, invoicing holds those clients' drafts.
--
--   resolution      FULL_BLOCK | PER_CLIENT | DID_NOT_HAPPEN (NULL = timer only)
--   client_seconds  PER_CLIENT only: [{clientId, seconds}] billed exactly
ALTER TABLE event_billing_timers ADD COLUMN IF NOT EXISTS resolution VARCHAR(20);
ALTER TABLE event_billing_timers ADD COLUMN IF NOT EXISTS client_seconds JSONB;
ALTER TABLE event_billing_timers ADD COLUMN IF NOT EXISTS resolution_note TEXT;
ALTER TABLE event_billing_timers ADD COLUMN IF NOT EXISTS resolved_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE event_billing_timers ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

ALTER TABLE event_billing_timers DROP CONSTRAINT IF EXISTS event_billing_timers_resolution_check;
ALTER TABLE event_billing_timers ADD CONSTRAINT event_billing_timers_resolution_check
  CHECK (resolution IS NULL OR resolution IN ('FULL_BLOCK', 'PER_CLIENT', 'DID_NOT_HAPPEN'));
