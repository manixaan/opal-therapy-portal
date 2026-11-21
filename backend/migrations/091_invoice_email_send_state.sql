-- 091 — Sending invoices by email exactly once (21 Nov 2026).
--
-- Sending is claimed before the email goes: sent_status moves to SENDING
-- under the invoice's row lock, so a double click, a retry or a second user
-- cannot email the same invoice twice. A send that fails is FAILED with the
-- reason kept for the owner; a deliberate resend is an explicit action.
--
--   email_attempted_at   when the current/last attempt was claimed
--   email_last_error     the last failure, for the owner (no addresses or content)
--   email_send_count     how many emails have gone for this invoice
--   email_batch_id       the "Send selected" batch that sent it, if any
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_sent_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_sent_status_check
  CHECK (sent_status IN ('NOT_SENT', 'SENDING', 'SENT', 'FAILED'));

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_attempted_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_last_error TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_send_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_batch_id UUID;
