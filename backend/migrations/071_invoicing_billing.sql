-- ═══════════════════════════════════════════════════════════════════════════
--  071 — Invoicing, automated NDIS billing and rural trip billing
-- ═══════════════════════════════════════════════════════════════════════════
-- Calendar events → travel legs → MMM + versioned rate card → invoice lines.
-- Architecture: docs/accounting/INVOICING_ARCHITECTURE.md
--
-- Additive only: no existing table is altered. `events` gains two triggers
-- that flag invoices when a billed source event changes; they never modify
-- an event. All DDL is idempotent.

-- ── Organisation billing settings (one row per organisation) ────────────────
-- Business name / address / phone / email stay in org_settings; only what the
-- portal did not already hold lives here.
CREATE TABLE IF NOT EXISTS billing_settings (
  organisation_id              UUID PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  invoice_prefix               VARCHAR(20)  NOT NULL DEFAULT 'INV-',
  next_invoice_number          INTEGER      NOT NULL DEFAULT 1 CHECK (next_invoice_number > 0),
  invoice_number_padding       SMALLINT     NOT NULL DEFAULT 0 CHECK (invoice_number_padding BETWEEN 0 AND 10),
  payment_terms_days           INTEGER      NOT NULL DEFAULT 7 CHECK (payment_terms_days BETWEEN 0 AND 365),
  business_name                VARCHAR(255),
  abn                          VARCHAR(20),
  business_email               VARCHAR(255),
  business_phone               VARCHAR(50),
  business_address             TEXT,
  payment_details              TEXT,
  invoice_footer               TEXT,
  return_travel_payable        BOOLEAN      NOT NULL DEFAULT FALSE,
  default_tax_treatment        VARCHAR(20)  NOT NULL DEFAULT 'GST_FREE'
                               CHECK (default_tax_treatment IN ('GST_FREE', 'GST_10_EXCLUSIVE')),
  default_trip_allocation_method VARCHAR(30) NOT NULL DEFAULT 'EQUAL_PER_CLIENT'
                               CHECK (default_trip_allocation_method IN ('EQUAL_PER_CLIENT', 'PER_SESSION', 'MANUAL_WEIGHTED')),
  completion_rule              VARCHAR(30)  NOT NULL DEFAULT 'PAST_CONFIRMED'
                               CHECK (completion_rule IN ('PAST_CONFIRMED', 'EXPLICIT_ONLY')),
  timezone                     VARCHAR(64)  NOT NULL DEFAULT 'Australia/Perth',
  session_description          VARCHAR(120) NOT NULL DEFAULT 'Therapy Session',
  updated_by_user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at                   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Versioned rate cards ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_rate_cards (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  discipline         VARCHAR(40)  NOT NULL DEFAULT 'OT',
  name               VARCHAR(160) NOT NULL,
  version            INTEGER      NOT NULL CHECK (version > 0),
  effective_from     DATE         NOT NULL,
  effective_to       DATE,
  status             VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  notes              TEXT,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (organisation_id, discipline, version)
);
CREATE INDEX IF NOT EXISTS idx_billing_rate_cards_lookup
  ON billing_rate_cards (organisation_id, discipline, status, effective_from);

CREATE TABLE IF NOT EXISTS billing_rate_rules (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_card_id                UUID NOT NULL REFERENCES billing_rate_cards(id) ON DELETE CASCADE,
  mmm_min                     SMALLINT NOT NULL CHECK (mmm_min BETWEEN 1 AND 7),
  mmm_max                     SMALLINT NOT NULL CHECK (mmm_max BETWEEN 1 AND 7),
  zone_label                  VARCHAR(60),
  session_hourly_rate         NUMERIC(10,2) NOT NULL CHECK (session_hourly_rate >= 0),
  travel_hourly_rate          NUMERIC(10,2) NOT NULL CHECK (travel_hourly_rate >= 0),
  travel_cap_minutes_each_way INTEGER CHECK (travel_cap_minutes_each_way IS NULL OR travel_cap_minutes_each_way >= 0),
  vehicle_rate_per_km         NUMERIC(6,2)  NOT NULL CHECK (vehicle_rate_per_km >= 0),
  session_item_code           VARCHAR(40),
  travel_item_code            VARCHAR(40),
  vehicle_item_code           VARCHAR(40),
  trip_cost_item_code         VARCHAR(40),
  CHECK (mmm_min <= mmm_max)
);
CREATE INDEX IF NOT EXISTS idx_billing_rate_rules_card ON billing_rate_rules (rate_card_id);

-- ── MMM reference dataset (official boundaries, versioned) ─────────────────
-- Loaded by backend/scripts/import-mmm-dataset.js from the Department of
-- Health MMM shapefile. One ring per row with its bounding box so a lookup
-- reads only the handful of rings around a point. Not organisation data.
CREATE TABLE IF NOT EXISTS mmm_datasets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version       VARCHAR(60) NOT NULL UNIQUE,
  source        TEXT NOT NULL,
  source_url    TEXT,
  published_on  DATE,
  ring_count    INTEGER,
  is_active     BOOLEAN NOT NULL DEFAULT FALSE,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mmm_datasets_one_active ON mmm_datasets (is_active) WHERE is_active;

CREATE TABLE IF NOT EXISTS mmm_dataset_rings (
  id          BIGSERIAL PRIMARY KEY,
  dataset_id  UUID NOT NULL REFERENCES mmm_datasets(id) ON DELETE CASCADE,
  mmm         SMALLINT NOT NULL CHECK (mmm BETWEEN 1 AND 7),
  part_index  INTEGER NOT NULL,
  min_lng     DOUBLE PRECISION NOT NULL,
  min_lat     DOUBLE PRECISION NOT NULL,
  max_lng     DOUBLE PRECISION NOT NULL,
  max_lat     DOUBLE PRECISION NOT NULL,
  coords      BYTEA NOT NULL           -- Float64 little-endian [lng,lat,lng,lat,…]
);
CREATE INDEX IF NOT EXISTS idx_mmm_rings_bbox ON mmm_dataset_rings (dataset_id, min_lng, max_lng, min_lat, max_lat);

-- ── Client billing profiles (clients live in Splose; keyed by patient id) ──
CREATE TABLE IF NOT EXISTS billing_profiles (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id             UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  client_id                   VARCHAR(255) NOT NULL,     -- events.client_id (Splose patient id)
  participant_name            VARCHAR(255),
  ndis_number                 VARCHAR(20),
  plan_start                  DATE,
  plan_end                    DATE,
  management_type             VARCHAR(20) CHECK (management_type IN ('PLAN_MANAGED', 'SELF_MANAGED', 'NDIA_MANAGED', 'OTHER')),
  payer_type                  VARCHAR(20) CHECK (payer_type IN ('PLAN_MANAGER', 'PARTICIPANT', 'NOMINEE', 'OTHER')),
  payer_name                  VARCHAR(255),
  payer_email                 VARCHAR(255),
  payer_reference             VARCHAR(255),
  payer_address               TEXT,
  participant_billing_address TEXT,
  default_practitioner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  service_address             TEXT,
  latitude                    DOUBLE PRECISION,
  longitude                   DOUBLE PRECISION,
  geocode_source              VARCHAR(40),
  mmm_zone                    SMALLINT CHECK (mmm_zone BETWEEN 1 AND 7),
  mmm_source                  VARCHAR(40),              -- dataset | manual
  mmm_dataset_version         VARCHAR(60),
  mmm_checked_at              TIMESTAMPTZ,
  mmm_confidence              VARCHAR(20),              -- CONFIDENT | REVIEW
  mmm_review_reason           VARCHAR(60),
  mmm_address_fingerprint     VARCHAR(64),              -- address the zone was computed for
  mmm_manual_override         SMALLINT CHECK (mmm_manual_override BETWEEN 1 AND 7),
  mmm_override_reason         TEXT,
  mmm_override_by_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  mmm_override_at             TIMESTAMPTZ,
  billing_notes               TEXT,
  payment_terms_days          INTEGER CHECK (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 365),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (organisation_id, client_id)
);

-- ── Persisted route facts: a route is fetched from Google once ─────────────
CREATE TABLE IF NOT EXISTS travel_route_facts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  route_key       TEXT NOT NULL,
  origin          TEXT NOT NULL,
  destination     TEXT NOT NULL,
  minutes         NUMERIC(8,2),
  km              NUMERIC(10,3),
  provider        VARCHAR(30) NOT NULL DEFAULT 'google_routes',   -- google_routes | manual
  status          VARCHAR(10) NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 1,
  set_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  override_reason TEXT,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, route_key)
);

-- ── Owner's billing mark on a calendar event (attendance / exclusion) ──────
CREATE TABLE IF NOT EXISTS calendar_event_billing (
  event_id        UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  attendance      VARCHAR(20) NOT NULL CHECK (attendance IN ('COMPLETED', 'DID_NOT_ATTEND', 'CANCELLED', 'NOT_BILLABLE')),
  reason          TEXT,
  set_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  set_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Trips (rural / remote service trips) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS trips (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name               VARCHAR(200) NOT NULL,
  destination        VARCHAR(255),
  start_date         DATE NOT NULL,
  end_date           DATE NOT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'PLANNED'
                     CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'INVOICED', 'CLOSED')),
  mmm_context        SMALLINT CHECK (mmm_context BETWEEN 1 AND 7),
  allocation_method  VARCHAR(30) NOT NULL DEFAULT 'EQUAL_PER_CLIENT'
                     CHECK (allocation_method IN ('EQUAL_PER_CLIENT', 'PER_SESSION', 'MANUAL_WEIGHTED')),
  route_notes        TEXT,
  notes              TEXT,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_trips_org_dates ON trips (organisation_id, start_date);

CREATE TABLE IF NOT EXISTS trip_practitioners (
  trip_id  UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (trip_id, user_id)
);

CREATE TABLE IF NOT EXISTS trip_clients (
  trip_id        UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  client_id      VARCHAR(255) NOT NULL,
  client_name    VARCHAR(255),
  included       BOOLEAN NOT NULL DEFAULT TRUE,
  weight         NUMERIC(10,4) NOT NULL DEFAULT 1 CHECK (weight >= 0),
  added_manually BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (trip_id, client_id)
);

CREATE TABLE IF NOT EXISTS trip_costs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id             UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  organisation_id     UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  category            VARCHAR(30) NOT NULL CHECK (category IN
                      ('FLIGHTS', 'ACCOMMODATION', 'CAR_HIRE', 'FUEL', 'TAXI_RIDESHARE', 'PARKING',
                       'BAGGAGE', 'REMOTE_TRAVEL', 'OTHER')),
  description         VARCHAR(255),
  cost_date           DATE,
  supplier            VARCHAR(255),
  amount              NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  billable_mode       VARCHAR(20) NOT NULL DEFAULT 'UNCLASSIFIED'
                      CHECK (billable_mode IN ('UNCLASSIFIED', 'SHARED_BILLABLE', 'NON_BILLABLE')),
  notes               TEXT,
  receipt_file_name   VARCHAR(255),
  receipt_mime        VARCHAR(100),
  receipt_storage_backend VARCHAR(20),
  receipt_storage_key TEXT,
  receipt_file_data   TEXT,
  created_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_trip_costs_trip ON trip_costs (trip_id) WHERE deleted_at IS NULL;

-- One row per client per allocation calculation; `is_current` marks the live set.
CREATE TABLE IF NOT EXISTS trip_allocations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id            UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  batch_id           UUID NOT NULL,
  client_id          VARCHAR(255) NOT NULL,
  method             VARCHAR(30) NOT NULL,
  weight             NUMERIC(14,4) NOT NULL,
  session_count      INTEGER NOT NULL DEFAULT 0,
  pool_amount        NUMERIC(12,2) NOT NULL,
  amount             NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  is_current         BOOLEAN NOT NULL DEFAULT TRUE,
  calculation        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_allocations_current
  ON trip_allocations (trip_id, client_id) WHERE is_current;

-- ── Invoice runs, invoices, lines ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  kind                 VARCHAR(10) NOT NULL DEFAULT 'NORMAL' CHECK (kind IN ('NORMAL', 'TRIP', 'REISSUE')),
  trip_id              UUID REFERENCES trips(id) ON DELETE SET NULL,
  period_start         DATE NOT NULL,
  period_end           DATE NOT NULL,
  practitioner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,   -- NULL = all practitioners
  status               VARCHAR(12) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  summary              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_invoice_runs_org ON invoice_runs (organisation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invoices (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id             UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  invoice_number              VARCHAR(40) NOT NULL,
  run_id                      UUID REFERENCES invoice_runs(id) ON DELETE SET NULL,
  trip_id                     UUID REFERENCES trips(id) ON DELETE SET NULL,
  client_id                   VARCHAR(255) NOT NULL,
  billing_profile_id          UUID REFERENCES billing_profiles(id) ON DELETE SET NULL,
  payer_key                   VARCHAR(300) NOT NULL,
  client_name                 VARCHAR(255),
  ndis_number                 VARCHAR(20),
  management_type             VARCHAR(20),
  payer_type                  VARCHAR(20),
  payer_name                  VARCHAR(255),
  payer_email                 VARCHAR(255),
  payer_reference             VARCHAR(255),
  payer_address               TEXT,
  practitioner_user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  practitioner_names          TEXT,
  issue_date                  DATE NOT NULL,
  due_date                    DATE,
  period_start                DATE,
  period_end                  DATE,
  status                      VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                              CHECK (status IN ('DRAFT', 'NEEDS_ATTENTION', 'READY', 'SENT', 'PART_PAID', 'PAID', 'VOID')),
  sent_status                 VARCHAR(20) NOT NULL DEFAULT 'NOT_SENT' CHECK (sent_status IN ('NOT_SENT', 'SENT', 'FAILED')),
  sent_at                     TIMESTAMPTZ,
  sent_to                     VARCHAR(255),
  tax_treatment               VARCHAR(20) NOT NULL DEFAULT 'GST_FREE',
  subtotal                    NUMERIC(14,2) NOT NULL DEFAULT 0,
  gst_total                   NUMERIC(14,2) NOT NULL DEFAULT 0,
  total                       NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_stale                    BOOLEAN NOT NULL DEFAULT FALSE,
  stale_reason                TEXT,
  source_changed_after_finalise BOOLEAN NOT NULL DEFAULT FALSE,
  notes                       TEXT,
  finalised_at                TIMESTAMPTZ,
  finalised_by_user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  voided_at                   TIMESTAMPTZ,
  voided_by_user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  void_reason                 TEXT,
  reissue_of_invoice_id       UUID REFERENCES invoices(id) ON DELETE SET NULL,
  created_by_user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_org_status ON invoices (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_org_client ON invoices (organisation_id, client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_org_issue ON invoices (organisation_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_trip ON invoices (trip_id) WHERE trip_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS travel_billing_allocations (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id              UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  run_id                       UUID REFERENCES invoice_runs(id) ON DELETE SET NULL,
  practitioner_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  service_date                 DATE NOT NULL,
  calendar_event_id            UUID REFERENCES events(id) ON DELETE SET NULL,
  client_id                    VARCHAR(255),
  day_total_minutes            NUMERIC(10,2) NOT NULL,
  day_total_km                 NUMERIC(10,3) NOT NULL,
  sessions_in_day              INTEGER NOT NULL,
  directions                   SMALLINT NOT NULL,
  allocated_minutes_before_cap NUMERIC(10,2) NOT NULL,
  cap_minutes                  NUMERIC(8,2),
  cap_applied                  BOOLEAN NOT NULL,
  claimable_minutes            NUMERIC(10,2) NOT NULL,
  travel_rate                  NUMERIC(10,2),
  labour_amount                NUMERIC(12,2),
  allocated_km                 NUMERIC(10,3) NOT NULL,
  vehicle_rate_per_km          NUMERIC(6,2),
  vehicle_amount               NUMERIC(12,2),
  return_payable               BOOLEAN NOT NULL,
  mmm_zone                     SMALLINT,
  rate_card_id                 UUID REFERENCES billing_rate_cards(id) ON DELETE SET NULL,
  rate_card_version            INTEGER,
  legs                         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_travel_alloc_event ON travel_billing_allocations (calendar_event_id);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id           UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  organisation_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  component            VARCHAR(20) NOT NULL CHECK (component IN ('SESSION', 'TRAVEL_LABOUR', 'TRAVEL_KM', 'TRIP_COST', 'MANUAL')),
  line_status          VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (line_status IN ('ACTIVE', 'REMOVED', 'VOIDED')),
  calendar_event_id    UUID REFERENCES events(id) ON DELETE SET NULL,
  client_id            VARCHAR(255),
  practitioner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  travel_allocation_id UUID REFERENCES travel_billing_allocations(id) ON DELETE SET NULL,
  trip_id              UUID REFERENCES trips(id) ON DELETE SET NULL,
  trip_allocation_id   UUID REFERENCES trip_allocations(id) ON DELETE SET NULL,
  rate_card_id         UUID REFERENCES billing_rate_cards(id) ON DELETE SET NULL,
  rate_card_version    INTEGER,
  mmm_zone             SMALLINT,
  service_date         DATE,
  item_code            VARCHAR(40),
  description          VARCHAR(500) NOT NULL,
  duration_minutes     NUMERIC(10,2),
  quantity             NUMERIC(12,4) NOT NULL,
  unit_price           NUMERIC(12,2) NOT NULL,
  gst_rate             NUMERIC(5,4) NOT NULL DEFAULT 0,
  gst_amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount               NUMERIC(12,2) NOT NULL,
  calculation          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- snapshot of every input
  is_overridden        BOOLEAN NOT NULL DEFAULT FALSE,
  removed_reason       TEXT,
  removed_by_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  removed_at           TIMESTAMPTZ,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_event ON invoice_lines (calendar_event_id) WHERE calendar_event_id IS NOT NULL;
-- THE duplicate-billing guard: one live claim per calendar event per component.
-- A line REMOVED from a draft keeps its claim (a re-run must not re-add what
-- the owner excluded); voiding an invoice sets its lines VOIDED and frees them.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_lines_event_component
  ON invoice_lines (calendar_event_id, component)
  WHERE calendar_event_id IS NOT NULL AND line_status IN ('ACTIVE', 'REMOVED');
-- One live trip-cost claim per client per trip.
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_lines_trip_cost
  ON invoice_lines (trip_id, client_id)
  WHERE component = 'TRIP_COST' AND line_status IN ('ACTIVE', 'REMOVED');

CREATE TABLE IF NOT EXISTS invoice_payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  organisation_id     UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid_on             DATE NOT NULL,
  method              VARCHAR(40),
  reference           VARCHAR(255),
  recorded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments (invoice_id);

-- Versioned PDFs. Drafts may have many; a finalised invoice has exactly one
-- final document and it is never regenerated.
CREATE TABLE IF NOT EXISTS invoice_documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id         UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  organisation_id    UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  version            INTEGER NOT NULL,
  is_final           BOOLEAN NOT NULL DEFAULT FALSE,
  file_name          VARCHAR(255) NOT NULL,
  byte_size          INTEGER NOT NULL,
  sha256             VARCHAR(64) NOT NULL,
  storage_backend    VARCHAR(20) NOT NULL,
  storage_key        TEXT,
  file_data          TEXT,
  generated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  generated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_documents_final ON invoice_documents (invoice_id) WHERE is_final;

-- ── Needs-attention queue ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_issues (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  run_id               UUID REFERENCES invoice_runs(id) ON DELETE SET NULL,
  issue_type           VARCHAR(40) NOT NULL,
  severity             VARCHAR(10) NOT NULL DEFAULT 'BLOCKING' CHECK (severity IN ('BLOCKING', 'WARNING')),
  calendar_event_id    UUID REFERENCES events(id) ON DELETE SET NULL,
  client_id            VARCHAR(255),
  practitioner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  trip_id              UUID REFERENCES trips(id) ON DELETE SET NULL,
  invoice_id           UUID REFERENCES invoices(id) ON DELETE SET NULL,
  service_date         DATE,
  message              TEXT NOT NULL,
  fix_target           JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key           VARCHAR(300) NOT NULL,
  status               VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at          TIMESTAMPTZ,
  resolved_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_issues_open
  ON billing_issues (organisation_id, dedupe_key) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_billing_issues_org_status ON billing_issues (organisation_id, status, created_at DESC);

-- ── Financial audit trail (append-only) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_audit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  action          VARCHAR(60) NOT NULL,
  entity_type     VARCHAR(40) NOT NULL,
  entity_id       VARCHAR(255),
  invoice_id      UUID,
  before_state    JSONB,
  after_state     JSONB,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_audit_entity ON billing_audit_events (organisation_id, entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_billing_audit_invoice ON billing_audit_events (invoice_id, created_at) WHERE invoice_id IS NOT NULL;

CREATE OR REPLACE FUNCTION billing_audit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'billing_audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_billing_audit_events_immutable ON billing_audit_events;
CREATE TRIGGER trg_billing_audit_events_immutable
  BEFORE UPDATE OR DELETE ON billing_audit_events
  FOR EACH ROW EXECUTE FUNCTION billing_audit_events_immutable();

-- ── Source-event change detection ──────────────────────────────────────────
-- Whatever writes an event (Outlook sync, Splose sync, the calendar UI), a
-- change to a billed field flags the invoice. Drafts become stale (regenerate);
-- finalised invoices are never touched financially — they get a flag and an
-- attention issue asking for an explicit correction / reissue.
CREATE OR REPLACE FUNCTION billing_flag_event_change_for(p_event_id UUID, p_what TEXT) RETURNS void AS $$
BEGIN
  UPDATE invoices i
     SET is_stale = TRUE,
         stale_reason = 'A source calendar event was ' || p_what || ' after this draft was calculated',
         updated_at = NOW()
   WHERE i.status IN ('DRAFT', 'NEEDS_ATTENTION')
     AND EXISTS (SELECT 1 FROM invoice_lines l
                  WHERE l.invoice_id = i.id AND l.calendar_event_id = p_event_id
                    AND l.line_status IN ('ACTIVE', 'REMOVED'));

  WITH flagged AS (
    UPDATE invoices i
       SET source_changed_after_finalise = TRUE, updated_at = NOW()
     WHERE i.status IN ('READY', 'SENT', 'PART_PAID', 'PAID')
       AND EXISTS (SELECT 1 FROM invoice_lines l
                    WHERE l.invoice_id = i.id AND l.calendar_event_id = p_event_id
                      AND l.line_status = 'ACTIVE')
    RETURNING i.id, i.organisation_id, i.client_id, i.invoice_number
  )
  INSERT INTO billing_issues (organisation_id, issue_type, severity, client_id,
                              invoice_id, message, fix_target, dedupe_key)
  SELECT f.organisation_id, 'SOURCE_CHANGED_AFTER_FINALISE', 'BLOCKING', f.client_id, f.id,
         'Source calendar event was ' || p_what || ' after invoice ' || f.invoice_number
           || ' was finalised. Void and reissue it, or dismiss if no correction is needed.',
         jsonb_build_object('kind', 'invoice', 'invoiceId', f.id, 'eventId', p_event_id),
         'SOURCE_CHANGED_AFTER_FINALISE|' || f.id || '|' || p_event_id
    FROM flagged f
  ON CONFLICT (organisation_id, dedupe_key) WHERE status = 'OPEN' DO NOTHING;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION billing_flag_event_change() RETURNS trigger AS $$
BEGIN
  IF NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.end_time IS DISTINCT FROM OLD.end_time
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.is_deleted IS DISTINCT FROM OLD.is_deleted
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.location IS DISTINCT FROM OLD.location
     OR NEW.manual_location IS DISTINCT FROM OLD.manual_location THEN
    PERFORM billing_flag_event_change_for(OLD.id, 'changed');
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_billing_event_update ON events;
CREATE TRIGGER trg_billing_event_update
  AFTER UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION billing_flag_event_change();

-- BEFORE DELETE so the lines still reference the event (the FK sets NULL after).
CREATE OR REPLACE FUNCTION billing_flag_event_delete() RETURNS trigger AS $$
BEGIN
  PERFORM billing_flag_event_change_for(OLD.id, 'deleted');
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_billing_event_delete ON events;
CREATE TRIGGER trg_billing_event_delete
  BEFORE DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION billing_flag_event_delete();
