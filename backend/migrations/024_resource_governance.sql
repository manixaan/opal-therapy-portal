-- ═══════════════════════════════════════════════════════════════════════════
--  024 — Resource Hub governance retrofit (staff-side, non-destructive)
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Adds the governance layer described in the Opal Resource Hub handoff
--  (00_ADMIN/CONTENT_GOVERNANCE.md) to the EXISTING R2 hub, without disturbing
--  the 163 live resources, the six-value `status` lifecycle, or the 36 routes
--  that depend on them.
--
--  DESIGN RULES THIS MIGRATION OBEYS
--
--  1. `status`, `visibility` and `version` are NOT altered. `status` remains the
--     operational lifecycle; `publication_state` is added ALONGSIDE it as the
--     governance lifecycle. Nothing is backfilled to 'published'.
--  2. `version` stays INTEGER. Semantic versions ('0.1') live in the new
--     `content_version` text column.
--  3. `access_tier` records what this application can ACTUALLY enforce today.
--     It deliberately excludes 'public' and 'participant': the portal has no
--     participant or carer login, so those tiers would name an audience that
--     cannot authenticate. Editorial intent for such an audience is recorded
--     separately in `intended_audience`, which grants nothing.
--  4. `source_class` is the governance-critical field — it is what stops a
--     third-party work being badged as Opal-authored. It is NOT a rights
--     determination: `rights_status`, `source_publisher` and `provenance`
--     carry ownership and permission, and a source_class of 'opal-original'
--     confers no redistribution right on its own.
--  5. Existing rows are backfilled honestly. No resource has had a rights or
--     clinical review, so all 163 land on 'unknown' / 'unreviewed' rather than
--     being optimistically classified. That is the conservative default the
--     governance document requires, and it means no existing record can render
--     an Opal-authored badge until a human classifies it.
--
--  Idempotent: re-running is a no-op. See backend/migrations/README.md.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Governance columns ──────────────────────────────────────────────────────

ALTER TABLE resources ADD COLUMN IF NOT EXISTS source_class        VARCHAR(40);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS rights_status       VARCHAR(40);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS access_tier         VARCHAR(30);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS publication_state   VARCHAR(40);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS clinical_status     VARCHAR(30);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS brand_review_status VARCHAR(30);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS content_version     VARCHAR(20);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS intended_audience   JSONB DEFAULT '[]'::jsonb;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS age_groups          JSONB DEFAULT '[]'::jsonb;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS provenance          JSONB DEFAULT '{}'::jsonb;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS instrument_key      VARCHAR(60);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS external_ref        VARCHAR(80);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS duplicate_of        UUID;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS superseded_by       UUID;

COMMENT ON COLUMN resources.source_class IS
  'Who authored the work. Drives the publisher badge. NOT a rights determination — see rights_status.';
COMMENT ON COLUMN resources.access_tier IS
  'What this app can enforce today. Excludes public/participant: there is no participant login.';
COMMENT ON COLUMN resources.intended_audience IS
  'Editorial intent only. Grants no access. A participant audience here is aspirational until client auth exists.';
COMMENT ON COLUMN resources.publication_state IS
  'Governance lifecycle, parallel to status. status remains the operational lifecycle.';
COMMENT ON COLUMN resources.content_version IS
  'Semantic content version such as 0.1. The integer `version` column is untouched and unrelated.';
COMMENT ON COLUMN resources.instrument_key IS
  'Links a standardised-instrument record to its implementing module, e.g. whodas-2.0-36.';

-- ── Backfill BEFORE constraints, so existing rows satisfy them ──────────────
-- Conservative by design: nothing here asserts ownership or review that has
-- not happened.

UPDATE resources SET source_class  = 'unknown'    WHERE source_class  IS NULL;
UPDATE resources SET rights_status = 'unreviewed' WHERE rights_status IS NULL;
UPDATE resources SET clinical_status = 'unreviewed' WHERE clinical_status IS NULL;
UPDATE resources SET brand_review_status = 'not-required' WHERE brand_review_status IS NULL;

-- access_tier mirrors today's visibility. Every live row is 'staff'; anything
-- unexpected also lands on 'staff' because that is the most restrictive tier
-- with a real audience.
UPDATE resources
   SET access_tier = CASE WHEN visibility = 'admin' THEN 'admin' ELSE 'staff' END
 WHERE access_tier IS NULL;

-- publication_state derives from the operational status. Note that 'approved'
-- maps to 'approved' and NOT to 'published': publication is a separate,
-- deliberate act and no existing record has had one.
UPDATE resources
   SET publication_state = CASE status
         WHEN 'draft'                THEN 'inventory'
         WHEN 'submitted_for_review' THEN 'rights-review'
         WHEN 'approved'             THEN 'approved'
         WHEN 'needs_update'         THEN 'clinical-review'
         WHEN 'archived'             THEN 'retired'
         WHEN 'rejected'             THEN 'retired'
         ELSE 'inventory'
       END
 WHERE publication_state IS NULL;

ALTER TABLE resources ALTER COLUMN source_class      SET DEFAULT 'unknown';
ALTER TABLE resources ALTER COLUMN rights_status     SET DEFAULT 'unreviewed';
ALTER TABLE resources ALTER COLUMN clinical_status   SET DEFAULT 'unreviewed';
ALTER TABLE resources ALTER COLUMN access_tier       SET DEFAULT 'staff';
ALTER TABLE resources ALTER COLUMN publication_state SET DEFAULT 'inventory';

ALTER TABLE resources ALTER COLUMN source_class      SET NOT NULL;
ALTER TABLE resources ALTER COLUMN rights_status     SET NOT NULL;
ALTER TABLE resources ALTER COLUMN access_tier       SET NOT NULL;
ALTER TABLE resources ALTER COLUMN publication_state SET NOT NULL;

-- ── Vocabularies ────────────────────────────────────────────────────────────
-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS, hence the catalogue guards.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_resource_source_class') THEN
    ALTER TABLE resources ADD CONSTRAINT valid_resource_source_class CHECK (
      source_class IN ('opal-original','government-official','nonprofit',
                       'standardised-instrument','commercial','provider-company',
                       'internal','unknown'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_resource_rights_status') THEN
    ALTER TABLE resources ADD CONSTRAINT valid_resource_rights_status CHECK (
      rights_status IN ('unreviewed','opal-owned','licensed-for-portal',
                        'official-link-only','reference-only','restricted','unknown'));
  END IF;
END $$;

-- Deliberately NOT ('public','participant') — see design rule 3 in the header.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_resource_access_tier') THEN
    ALTER TABLE resources ADD CONSTRAINT valid_resource_access_tier CHECK (
      access_tier IN ('clinician','staff','admin','excluded-private'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_resource_publication_state') THEN
    ALTER TABLE resources ADD CONSTRAINT valid_resource_publication_state CHECK (
      publication_state IN ('inventory','rights-review','clinical-review',
                            'brand-accessibility-review','approved','published',
                            'retired','excluded-private'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_resource_clinical_status') THEN
    ALTER TABLE resources ADD CONSTRAINT valid_resource_clinical_status CHECK (
      clinical_status IN ('unreviewed','draft','clinically-reviewed','superseded'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_resource_brand_review_status') THEN
    ALTER TABLE resources ADD CONSTRAINT valid_resource_brand_review_status CHECK (
      brand_review_status IN ('pending','approved','not-required'));
  END IF;
END $$;

-- An excluded-private record is client-derived or otherwise unpublishable. It
-- must never sit in a state that any listing predicate treats as servable.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'excluded_private_is_terminal') THEN
    ALTER TABLE resources ADD CONSTRAINT excluded_private_is_terminal CHECK (
      access_tier <> 'excluded-private' OR publication_state = 'excluded-private');
  END IF;
END $$;

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_resources_access_tier       ON resources (organisation_id, access_tier);
CREATE INDEX IF NOT EXISTS idx_resources_publication_state ON resources (organisation_id, publication_state);
CREATE INDEX IF NOT EXISTS idx_resources_source_class      ON resources (organisation_id, source_class);
CREATE INDEX IF NOT EXISTS idx_resources_instrument_key    ON resources (instrument_key)
  WHERE instrument_key IS NOT NULL;

-- Stable external identity for idempotent seeding (the handoff's 'ot-er-001'),
-- so re-importing updates rather than duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_resources_external_ref
  ON resources (organisation_id, external_ref) WHERE external_ref IS NOT NULL;

-- ── Governance transition audit ─────────────────────────────────────────────
-- The handoff requires reviewer, timestamp and reason on every state change.
-- Separate from the generic audit log so the review trail is queryable per
-- resource without scanning global audit history.

CREATE TABLE IF NOT EXISTS resource_governance_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id),
  resource_id      UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  field            VARCHAR(40) NOT NULL,
  from_value       VARCHAR(60),
  to_value         VARCHAR(60),
  reason           TEXT,
  actor_user_id    UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resource_governance_events_resource
  ON resource_governance_events (resource_id, created_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_governance_event_field') THEN
    ALTER TABLE resource_governance_events ADD CONSTRAINT valid_governance_event_field CHECK (
      field IN ('publication_state','access_tier','rights_status','clinical_status',
                'source_class','brand_review_status'));
  END IF;
END $$;
