-- 090 — The calendar's own travel minutes, kept for invoicing (21 Nov 2026).
--
-- The calendar prices each leg in the browser with traffic at departure time
-- (travel.js). Invoicing used its own cached Google lookup with no traffic,
-- so an invoice could bill a different number of minutes than the calendar
-- showed. The calendar now records each day's legs here; invoicing bills
-- these minutes when present (owner decision 21 Nov 2026).
--
-- One row per practitioner, day and leg (origin → destination, canonical).
-- A day is replaced as a whole while it is today or later; once a day is in
-- the past its recorded legs are frozen (written only if none exist yet).
CREATE TABLE IF NOT EXISTS calendar_travel_legs (
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date         DATE NOT NULL,
  origin_canon       TEXT NOT NULL,
  destination_canon  TEXT NOT NULL,
  origin             TEXT NOT NULL,
  destination        TEXT NOT NULL,
  minutes            INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
  owner_event_id     UUID,
  side               VARCHAR(10),
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, local_date, origin_canon, destination_canon)
);
CREATE INDEX IF NOT EXISTS idx_calendar_travel_legs_day ON calendar_travel_legs (local_date);
