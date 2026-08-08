-- 010 — suburb centroid cache for the Scheduler Map (Phase 5).
--
-- Privacy-first geography: the scheduler map shows SUBURB-level points, so
-- we geocode a suburb string ("Willetton WA Australia") at most once and
-- reuse the centroid forever. Failures are recorded with attempts so a bad
-- locality is not re-geocoded on every map open.
--
-- Derived enrichment only — the canonical events store is untouched.

CREATE TABLE IF NOT EXISTS suburb_centroids (
  id          SERIAL PRIMARY KEY,
  suburb_key  TEXT NOT NULL UNIQUE,          -- normalised: lower(trim(suburb)) + '|' + state
  suburb      TEXT NOT NULL,                 -- display form
  state       TEXT NOT NULL DEFAULT 'WA',
  postcode    TEXT,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  status      TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  provider    TEXT DEFAULT 'google',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suburb_centroids_key ON suburb_centroids (suburb_key);
