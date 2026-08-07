-- ═══════════════════════════════════════════════════════════════════════════
--  009 — Travel logbook: local address overrides
-- ═══════════════════════════════════════════════════════════════════════════
-- Practice-level overlay keyed by the Splose support-item id. A row here
-- corrects/annotates the from/to addresses of one travel entry LOCALLY only —
-- Splose is never written to, and the original Splose address is always
-- preserved (the API returns it as sourceDestination). NULL in a column
-- means "no override for that leg". No external calls.

CREATE TABLE IF NOT EXISTS travel_address_overrides (
  splose_item_id     VARCHAR(100) PRIMARY KEY,
  organisation_id    UUID REFERENCES organisations(id),
  from_address       TEXT,
  to_address         TEXT,
  updated_by_user_id UUID REFERENCES users(id),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
