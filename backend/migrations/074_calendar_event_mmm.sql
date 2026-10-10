-- 074: MMM zone per session (billing/mmm-locality.js).
--
-- The NDIS price limit follows the MMM zone of where a session is delivered.
-- Invoicing now derives it from the session's own address through the
-- hard-coded WA MMM 2023 locality table. This table holds only the zone a
-- person set by hand for one session — chosen in the Smart Booking panel
-- (source BOOKING) or by the owner in Invoicing (source OWNER) — and that
-- choice wins over the lookup. No row = use the lookup.

CREATE TABLE IF NOT EXISTS calendar_event_mmm (
  event_id        UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  mmm_zone        SMALLINT NOT NULL CHECK (mmm_zone BETWEEN 1 AND 7),
  source          VARCHAR(10) NOT NULL CHECK (source IN ('BOOKING', 'OWNER')),
  reason          TEXT,
  set_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  set_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_mmm_org ON calendar_event_mmm (organisation_id);
