-- 073: Travel legs mirrored to Outlook (backend/travel-outlook-sync.js).
--
-- The portal works out each day's travel legs from the physical appointments
-- (frontend travel.js) and mirrors them to the therapist's Outlook calendar
-- as ordinary events (event_type 'travel', category 'Travel'). Each mirrored
-- leg is one events row carrying custom_metadata.travelLegKey —
-- "<owner event id>|before" (the drive into an appointment) or
-- "<owner event id>|after" (the drive away from one) — and related_event_id =
-- the owner, so deleting the appointment cascades to its legs (016).
--
-- This index is the no-duplicates guarantee: a live leg key exists at most
-- once per user, however many tabs, retries or syncs race. Nothing goes to
-- Splose. Rows hold times and suburbs only — no clinical content.

CREATE UNIQUE INDEX IF NOT EXISTS events_travel_leg_key_live
  ON events (user_id, (custom_metadata->>'travelLegKey'))
  WHERE custom_metadata ? 'travelLegKey' AND (is_deleted IS NULL OR is_deleted = FALSE);
