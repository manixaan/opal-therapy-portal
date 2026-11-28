-- 097: a session address's MMM zone, answered once and remembered.
--
-- A session at an address whose suburb straddles two MMM zones raised
-- "Session MMM zone needs confirmation" on every invoicing run. The owner's
-- answer (Needs attention → Fix) is now kept per address, so the next session
-- at the same address is zoned without asking again.

CREATE TABLE IF NOT EXISTS billing_address_zones (
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  address_key     TEXT NOT NULL,
  address         TEXT NOT NULL,
  mmm_zone        SMALLINT NOT NULL CHECK (mmm_zone BETWEEN 1 AND 7),
  set_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  set_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organisation_id, address_key)
);
