-- 072: Smart Booking — where a client is seen, and where a clinician goes
-- between clients (backend/client-locations-db.js, client-location-routes.js).
--
-- client_service_locations — the extra service locations the portal has
-- learned for a Splose client (school, day program, a second home…). Splose
-- stays authoritative for the client's own address: it is read live and is
-- NEVER copied in here, so a row is only ever an address a clinician added or
-- one a booking used. client_id is the Splose patient id (there is no local
-- client table). Deduplicated per client on Google Place ID and on a
-- normalised address; coordinates are a third check in code.
--
-- travel_destinations — a clinician's own non-client destinations ("Go
-- Somewhere Else": hospital, supplier, meeting venue). Deliberately separate
-- from client locations and keyed by the clinician, never by a client.
--
-- Both tables hold addresses only — no clinical content, no names.

CREATE TABLE IF NOT EXISTS client_service_locations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     UUID REFERENCES organisations(id) ON DELETE SET NULL,
  client_id           VARCHAR(64) NOT NULL,
  label               VARCHAR(40) NOT NULL DEFAULT 'Other',
  formatted_address   VARCHAR(300) NOT NULL,
  normalized_address  VARCHAR(300) NOT NULL,
  place_id            VARCHAR(300),
  lat                 DOUBLE PRECISION,
  lng                 DOUBLE PRECISION,
  source              VARCHAR(20) NOT NULL DEFAULT 'manual'
                      CHECK (source IN ('manual', 'previous_booking', 'portal')),
  source_ref          VARCHAR(100),
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  use_count           INTEGER NOT NULL DEFAULT 0,
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS client_service_locations_addr_uq
  ON client_service_locations (client_id, normalized_address) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_service_locations_place_uq
  ON client_service_locations (client_id, place_id) WHERE archived_at IS NULL AND place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_service_locations_client_idx
  ON client_service_locations (client_id, last_used_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS travel_destinations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label               VARCHAR(80) NOT NULL,
  formatted_address   VARCHAR(300) NOT NULL,
  normalized_address  VARCHAR(300) NOT NULL,
  place_id            VARCHAR(300),
  lat                 DOUBLE PRECISION,
  lng                 DOUBLE PRECISION,
  use_count           INTEGER NOT NULL DEFAULT 0,
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS travel_destinations_addr_uq
  ON travel_destinations (user_id, normalized_address) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS travel_destinations_place_uq
  ON travel_destinations (user_id, place_id) WHERE archived_at IS NULL AND place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS travel_destinations_user_idx
  ON travel_destinations (user_id, last_used_at DESC NULLS LAST);
