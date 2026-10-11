-- 075: Recurring appointments (series-routes.js, recurrence.js).
--
-- A series is stored as ordinary dated events, one row per appointment,
-- linked to an event_series row that holds the Outlook-style rule. Travel,
-- invoicing, MMM, case notes and the Splose draft queue keep working per
-- appointment; the series only groups them so they can be shown, extended
-- and deleted together ("this / this and following / all").
--
-- Capped at 12 months / 52 appointments by recurrence.js. Deleting a series
-- row unlinks its events (they stay); deleting an event leaves the series.

CREATE TABLE IF NOT EXISTS event_series (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
  anchor_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  rule            JSONB NOT NULL,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES event_series(id) ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS series_index INTEGER;

CREATE INDEX IF NOT EXISTS idx_events_series ON events (series_id) WHERE series_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_series_user ON event_series (user_id);
