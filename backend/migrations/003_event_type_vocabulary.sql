-- ═══════════════════════════════════════════════════════════════════════════
--  003 — align valid_event_type with the classifier's full vocabulary
-- ═══════════════════════════════════════════════════════════════════════════
-- classifyEventType (sync-utils.js) returns 'outlook' for uncategorised
-- mailbox events (its documented safe default) and 'report' for case
-- management / report writing — neither was in the CHECK, so the first real
-- mailbox synced on staging failed on every uncategorised event:
--   "new row … violates check constraint valid_event_type"
-- Development never enforced the constraint: its events table predates the
-- CHECK and CREATE TABLE IF NOT EXISTS never re-applies. Fresh databases
-- (like staging) got the strict version. This migration is the single
-- source of truth for the event-type vocabulary from here on.
ALTER TABLE events DROP CONSTRAINT IF EXISTS valid_event_type;
ALTER TABLE events ADD CONSTRAINT valid_event_type CHECK (event_type IN (
  'therapy', 'leave', 'cpd', 'travel', 'admin', 'lunch', 'meeting',
  'teams_meeting', 'outlook', 'report'
));
