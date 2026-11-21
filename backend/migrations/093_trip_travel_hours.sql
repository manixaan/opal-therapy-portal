-- 093 — Remote trip travel time pooled over the whole trip (21 Nov 2026).
--
-- Owner rule book, rule 11: MMM6–7 has no time cap — ALL of a trip's travel
-- (flying + driving) is divided by the clients seen on the trip. A day-by-day
-- route cannot see flights, so the owner enters the trip's total travel hours.
-- When set, Generate Trip Invoices bills it ÷ clients on the trip (each client
-- once) instead of the per-day route; NULL keeps the per-day route.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS travel_hours NUMERIC(7,2);
ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_travel_hours_check;
ALTER TABLE trips ADD CONSTRAINT trips_travel_hours_check CHECK (travel_hours IS NULL OR (travel_hours >= 0 AND travel_hours <= 500));
