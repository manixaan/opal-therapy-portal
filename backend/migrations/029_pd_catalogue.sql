-- ═══════════════════════════════════════════════════════════════════════════
--  029 — Professional development catalogue: provenance and multi-provider
-- ═══════════════════════════════════════════════════════════════════════════
--
--  pd_events already carries most of what a catalogue needs: title, provider,
--  description, topic, start/end, timezone, mode, location, cost_cents,
--  cpd_hours, registration_url, target_roles and status. This adds only what is
--  genuinely missing, and prepares the table for events arriving from somewhere
--  other than a person typing them in.
--
--  WHERE EVENTS COME FROM TODAY
--  A human. All 12 rows were entered through the admin PD tab. There is no
--  provider API, no feed and no scraper anywhere in this application. These
--  columns describe an origin so that a future integration can be added
--  without a second table — they do not imply one exists.
--
--  BOOKING HAPPENS AT THE PROVIDER
--  `registration_url` is the provider's own booking page. Opal has no booking
--  integration, so nothing in this schema records a booking, a seat or a
--  payment. Adding such a column would invite an interface that implies Opal
--  can book on a therapist's behalf, which it cannot.
--
--  Idempotent. See backend/migrations/README.md.
-- ═══════════════════════════════════════════════════════════════════════════

-- Provenance: who supplied this row, and where the authoritative page lives.
ALTER TABLE pd_events ADD COLUMN IF NOT EXISTS source_url    TEXT;
ALTER TABLE pd_events ADD COLUMN IF NOT EXISTS image_url     TEXT;
ALTER TABLE pd_events ADD COLUMN IF NOT EXISTS provider_key  VARCHAR(60);
ALTER TABLE pd_events ADD COLUMN IF NOT EXISTS external_ref  VARCHAR(200);
ALTER TABLE pd_events ADD COLUMN IF NOT EXISTS synced_at     TIMESTAMPTZ;
ALTER TABLE pd_events ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN pd_events.source_url IS
  'The authoritative page for this event. Distinct from registration_url: a listing may not be the booking form.';
COMMENT ON COLUMN pd_events.provider_key IS
  'Origin of the row. NULL or manual = entered by a person. A future feed sets its own key.';
COMMENT ON COLUMN pd_events.external_ref IS
  'The provider''s own id, so a re-sync updates a row rather than duplicating it.';
COMMENT ON COLUMN pd_events.synced_at IS
  'When a feed last confirmed this row. NULL for manually curated events — they are not stale, they are simply not synced.';

-- Every outward link must be an ordinary web address. A pd row must never be
-- able to point the browser at a local file or a javascript: URL.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pd_urls_are_web') THEN
    ALTER TABLE pd_events ADD CONSTRAINT pd_urls_are_web CHECK (
      (registration_url IS NULL OR registration_url ~* '^https?://')
      AND (source_url IS NULL OR source_url ~* '^https?://')
      AND (image_url   IS NULL OR image_url   ~* '^https://')
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_pd_cost') THEN
    ALTER TABLE pd_events ADD CONSTRAINT valid_pd_cost CHECK (
      cost_cents IS NULL OR cost_cents >= 0);
  END IF;
END $$;

-- One row per provider event, so a future re-sync is an upsert rather than a
-- duplicate. Partial: manually curated rows have no external_ref and are
-- unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pd_events_external
  ON pd_events (organisation_id, provider_key, external_ref)
  WHERE provider_key IS NOT NULL AND external_ref IS NOT NULL;

-- The catalogue's default ordering and its commonest filters.
CREATE INDEX IF NOT EXISTS idx_pd_events_catalogue
  ON pd_events (organisation_id, status, starts_at);
CREATE INDEX IF NOT EXISTS idx_pd_events_topic
  ON pd_events (organisation_id, topic) WHERE topic IS NOT NULL;

-- Existing rows predate updated_at; seed it from created_at rather than NOW()
-- so nothing appears to have been edited today when it was not.
UPDATE pd_events SET updated_at = created_at WHERE updated_at IS NULL OR updated_at > NOW();
