/**
 * DATABASE CONNECTION & SETUP
 *
 * What this does:
 * - Connects to PostgreSQL database
 * - Defines the structure of data (schema)
 * - Creates tables if they don't exist
 * - Provides functions to read/write data
 *
 * PostgreSQL = A powerful database (like a filing system on steroids)
 * Tables = Like spreadsheets with rows and columns
 * Rows = Individual records (e.g., one event)
 * Columns = Fields (e.g., event name, start time, etc.)
 */

const { Pool, types } = require('pg');
const { v4: uuidv4 } = require('uuid');
const { encrypt, decrypt } = require('./crypto-utils');

// ===== FORCE TIMESTAMP COLUMNS TO BE UTC =====
// Postgres `TIMESTAMP` (without time zone) returns a wallclock string like
// "2026-05-15 00:30:00". pg's default parser turns that into a JS Date by
// interpreting it as the Node process's *local* time. On a Perth machine
// that means a UTC moment we stored gets re-parsed as Perth wallclock, then
// JSON-serialised back to UTC (with an 8-hour shift), and the frontend
// converts to Perth a second time — net 8h drift in whichever direction the
// arithmetic went last. process.env.TZ = 'UTC' is unreliable here because
// Node may have already cached the TZ before we set it. Overriding the type
// parser is the deterministic fix: parse every TIMESTAMP value as UTC,
// regardless of where Node thinks it lives.
//
// 1114 = OID for `timestamp without time zone`
// 1184 = OID for `timestamp with time zone` (already UTC-aware, but we
// reparse defensively in case the server timezone is set to anything other
// than UTC).
types.setTypeParser(1114, str => str ? new Date(str.replace(' ', 'T') + 'Z') : null);
types.setTypeParser(1184, str => str ? new Date(str) : null);

// ===== CONNECTION SETUP =====
// Creates a connection pool to the database
// Pool = multiple connections ready to use (faster than opening new ones each time)

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'therapy_scheduler',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  // Set UTC timezone at the connection level so every session is consistent.
  // Using options= is cleaner than pool.on('connect') + client.query() which
  // can trigger the pg@9 deprecation warning if the SET runs while pg's own
  // connection-init query is still in flight.
  options: '-c TimeZone=UTC',
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Force every pooled connection to UTC. Without this, Postgres uses the OS
// timezone of the machine it runs on (Australia/Perth on this laptop) when
// parsing/storing TIMESTAMP (no-tz) values. That meant an inbound
// "...01:30:00Z" got converted to "09:30" before being stored, then the
// frontend converted UTC→Perth again on read, leaving every event 8 hours
// late. Pinning the session to UTC keeps the TIMESTAMP columns honest as
// UTC wallclock values end-to-end.
// Timezone is set via the pool options: '-c TimeZone=UTC' above — no per-connect
// client.query() needed. Removed to eliminate the pg@9 deprecation warning that
// fires when client.query() is called while pg's own connection-init is in flight.

// ===== TABLE SCHEMAS =====
// This defines the structure of our data
//
// ⚠️ FROZEN AS MIGRATION BASELINE (v0) — 2026-07-14
// INIT_QUERIES is recorded by migrations/000_baseline.sql as the version-0
// schema. Do NOT add new tables/columns here. All schema changes from now on
// go in a new migrations/NNN_*.sql file applied via `npm run migrate`.
// (Boot still runs INIT_QUERIES idempotently so dev databases self-create;
// see migrations/README.md.)

const INIT_QUERIES = `
  -- Users table (stores login info)
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    microsoft_id VARCHAR(255) UNIQUE,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Events table (stores calendar events)
  CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Basic event info
    title VARCHAR(255) NOT NULL,
    description TEXT,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    location VARCHAR(255),

    -- Event type (therapy, leave, cpd, travel, etc.)
    event_type VARCHAR(50) DEFAULT 'therapy',

    -- Status
    status VARCHAR(50) DEFAULT 'confirmed',

    -- Linking IDs to other systems
    splose_id VARCHAR(255),
    outlook_id VARCHAR(255),
    teams_meeting_id VARCHAR(255),

    -- Rich app metadata
    client_id VARCHAR(255),
    client_name VARCHAR(255),
    regional_tag VARCHAR(50),
    travel_distance FLOAT,
    travel_time_minutes INT,
    ndis_plan_expiry DATE,
    custom_metadata JSONB, -- JSON data for any extra fields

    -- Sync tracking
    sync_status VARCHAR(50) DEFAULT 'pending',
    last_modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_modified_by VARCHAR(50) DEFAULT 'app',
    last_synced_to_outlook TIMESTAMP,
    last_synced_to_splose TIMESTAMP,

    -- Teams specific
    is_teams_meeting BOOLEAN DEFAULT false,
    teams_join_link VARCHAR(255),
    teams_organizer VARCHAR(255),

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT valid_event_type CHECK (event_type IN ('therapy', 'leave', 'cpd', 'travel', 'admin', 'lunch', 'meeting', 'teams_meeting'))
  );

  -- Sync log (tracks what happened with each event)
  CREATE TABLE IF NOT EXISTS sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL, -- 'created', 'updated', 'deleted'
    source VARCHAR(50) NOT NULL, -- 'app', 'outlook', 'splose'
    target VARCHAR(50) NOT NULL, -- 'app', 'outlook', 'splose'
    status VARCHAR(50) DEFAULT 'pending', -- 'success', 'failed', 'pending'
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Conflict log (tracks sync conflicts)
  CREATE TABLE IF NOT EXISTS conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    conflict_type VARCHAR(50) NOT NULL, -- 'simultaneous_edit', 'deletion_conflict'
    app_version JSONB,
    outlook_version JSONB,
    splose_version JSONB,
    resolution VARCHAR(50), -- 'app_wins', 'outlook_wins', 'splose_wins', 'manual'
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Create indexes for faster queries
  CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
  CREATE INDEX IF NOT EXISTS idx_events_outlook_id ON events(outlook_id);
  CREATE INDEX IF NOT EXISTS idx_events_splose_id ON events(splose_id);
  CREATE INDEX IF NOT EXISTS idx_events_start_time ON events(start_time);
  CREATE INDEX IF NOT EXISTS idx_sync_log_event_id ON sync_log(event_id);

  -- Migration: add categories column for Outlook category pass-through.
  -- Using TEXT[] keeps each category label intact so the frontend can colour
  -- tiles by category. Safe to run on every boot.
  ALTER TABLE events ADD COLUMN IF NOT EXISTS categories TEXT[];

  -- Migration: source tagging — 'outlook' | 'app' (default 'outlook' for
  -- backwards-compat since all existing rows came from Outlook syncs).
  ALTER TABLE events ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'outlook';

  -- Migration: soft-delete support so we can hide stale Outlook records
  -- without losing audit history.
  ALTER TABLE events ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

  -- Migration: stable Outlook identifiers for reliable matching.
  ALTER TABLE events ADD COLUMN IF NOT EXISTS outlook_ical_uid TEXT;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS outlook_change_key TEXT;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS outlook_last_modified_at TIMESTAMP;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP;

  -- Backfill source on existing rows.
  -- NOTE: After ALTER TABLE ... ADD COLUMN ... DEFAULT 'outlook', Postgres 11+
  -- synthesises 'outlook' for every old row at read time (fast-default), so
  -- WHERE source IS NULL matches nothing. We therefore use outlook_id as the
  -- unambiguous discriminator — app-created rows never have an outlook_id.
  UPDATE events SET source = 'app' WHERE outlook_id IS NULL AND source != 'app';

  -- Performance indexes for the new columns.
  CREATE INDEX IF NOT EXISTS idx_events_source     ON events(source);
  CREATE INDEX IF NOT EXISTS idx_events_is_deleted ON events(is_deleted);
  CREATE INDEX IF NOT EXISTS idx_events_ical_uid   ON events(outlook_ical_uid);

  -- Migration: manual location override — persists user-selected routing
  -- addresses across page reloads and protects them from Outlook sync overwrites.
  ALTER TABLE events ADD COLUMN IF NOT EXISTS manual_location JSONB;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS is_manual_location_override BOOLEAN DEFAULT FALSE;

  -- Migration: write-back tracking — records the outcome of every attempt
  -- to push an app-created event to Outlook.
  ALTER TABLE events ADD COLUMN IF NOT EXISTS write_error TEXT;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS last_write_attempt_at TIMESTAMP;

  -- ── Organisations table ────────────────────────────────────────────────
  -- Multi-tenancy foundation. For now a single org exists (Opal Therapy).
  CREATE TABLE IF NOT EXISTS organisations (
    id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- ── User role / auth migrations ─────────────────────────────────────────
  -- Applied idempotently on every boot so no separate migration runner needed.
  ALTER TABLE users ADD COLUMN IF NOT EXISTS name              VARCHAR(255);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash     TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS role              VARCHAR(20)  DEFAULT 'therapist';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions       JSONB;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS organisation_id   UUID         REFERENCES organisations(id);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active         BOOLEAN      DEFAULT TRUE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS is_treating_therapist BOOLEAN  DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS therapist_profile_id  VARCHAR(255);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at     TIMESTAMP;

  -- ── Audit log table ─────────────────────────────────────────────────────
  -- Tracks sensitive actions (login, role change, data export, Outlook writes).
  CREATE TABLE IF NOT EXISTS audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID REFERENCES organisations(id),
    actor_user_id   UUID REFERENCES users(id),
    action          VARCHAR(100) NOT NULL,
    target_type     VARCHAR(50),
    target_id       VARCHAR(255),
    metadata        JSONB,
    ip_address      VARCHAR(50),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Delta sync state: stores the Microsoft Graph deltaToken per user so the
  -- background poller can ask "what changed since last sync?" instead of
  -- re-importing everything. One row per user, upserted on every sync run.
  CREATE TABLE IF NOT EXISTS outlook_delta_state (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    delta_token TEXT,             -- opaque token returned by Graph /delta
    last_synced_at TIMESTAMP,     -- wall-clock of the last successful delta run
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- ── Therapist profiles ─────────────────────────────────────────────────────
  -- One row per treating therapist/employee. A user may have at most one profile
  -- (enforced by UNIQUE on user_id). Owners and admins who are NOT treating
  -- therapists do not have a profile — the row only exists when isTreatingTherapist=TRUE.
  CREATE TABLE IF NOT EXISTS therapist_profiles (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id         UUID REFERENCES organisations(id),
    user_id                 UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    display_name            TEXT NOT NULL,
    role_title              TEXT,
    -- Hex colour used to colour-code this therapist on the Master Calendar
    colour                  TEXT DEFAULT '#5b6af0',
    -- Microsoft Graph calendar ID (NULL = use primary calendar)
    outlook_calendar_id     TEXT,
    -- Splose practitioner/resource ID for filtering Splose appointments
    splose_practitioner_id  TEXT,
    -- Default work location (home, clinic, etc.)
    default_work_location_id TEXT,
    is_active               BOOLEAN DEFAULT TRUE,
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_therapist_profiles_user_id  ON therapist_profiles(user_id);
  CREATE INDEX IF NOT EXISTS idx_therapist_profiles_org_id   ON therapist_profiles(organisation_id);

  -- ── Event ownership migrations ─────────────────────────────────────────────
  -- Stamp each calendar event with the therapist profile it belongs to so that
  -- multi-therapist queries are a single indexed JOIN rather than a user-table lookup.
  ALTER TABLE events ADD COLUMN IF NOT EXISTS therapist_profile_id UUID REFERENCES therapist_profiles(id);
  ALTER TABLE events ADD COLUMN IF NOT EXISTS organisation_id       UUID REFERENCES organisations(id);

  CREATE INDEX IF NOT EXISTS idx_events_therapist_profile_id ON events(therapist_profile_id);
  CREATE INDEX IF NOT EXISTS idx_events_organisation_id       ON events(organisation_id);

  -- Fix up users.therapist_profile_id type: it was created as VARCHAR(255)
  -- in the earlier migration. We keep it VARCHAR to avoid a risky ALTER TYPE,
  -- but add a comment to clarify it stores the UUID text of therapist_profiles.id.
  COMMENT ON COLUMN users.therapist_profile_id IS
    'UUID (stored as text) referencing therapist_profiles.id. Cast to UUID for joins.';

  -- ── User profile / onboarding columns ─────────────────────────────────────
  -- These are added idempotently so they can be applied to existing databases.
  ALTER TABLE users ADD COLUMN IF NOT EXISTS phone             TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name      TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS role_title        TEXT;
  -- JSONB fields for location and scheduling
  ALTER TABLE users ADD COLUMN IF NOT EXISTS default_work_location  JSONB;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS work_location_schedule JSONB;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSONB;
  -- Onboarding / profile completion tracking
  ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completed     BOOLEAN   DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completed_at  TIMESTAMP;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_step       TEXT      DEFAULT 'account';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_steps JSONB DEFAULT '[]'::jsonb;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_skipped_steps   JSONB DEFAULT '[]'::jsonb;

  -- ── Account status lifecycle ──────────────────────────────────────────────
  -- pending_verification → (email verified) → pending_approval → (admin approves) → active
  -- active can be moved to suspended or deactivated by owner/admin.
  ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status
    TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('pending_verification','pending_approval','active','suspended','deactivated'));

  -- ── Email verification ────────────────────────────────────────────────────
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified              BOOLEAN   DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token    TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMP;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_sent_at  TIMESTAMP;

  -- ── Password reset ────────────────────────────────────────────────────────
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token        TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at   TIMESTAMP;

  -- ── Account approval / status change audit ────────────────────────────────
  ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by_user_id UUID;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at          TIMESTAMP;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_by_user_id UUID;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at         TIMESTAMP;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason     TEXT;

  -- Backfill: mark all existing accounts (created before the invite system) as
  -- profile-complete so they are not redirected to /onboarding on next login.
  -- Only touches rows that have a password_hash (i.e. real accounts, not OAuth-only stubs).
  UPDATE users
  SET profile_completed   = TRUE,
      onboarding_step     = 'complete',
      updated_at          = CURRENT_TIMESTAMP
  WHERE password_hash IS NOT NULL
    AND (profile_completed IS NULL OR profile_completed = FALSE)
    AND onboarding_step IS DISTINCT FROM 'complete';

  -- Backfill: mark all existing real accounts as active + email verified.
  -- New accounts created after this migration will start at pending_verification.
  UPDATE users
  SET account_status = 'active',
      email_verified = TRUE,
      updated_at     = CURRENT_TIMESTAMP
  WHERE password_hash IS NOT NULL
    AND account_status = 'active'
    AND email_verified IS NOT TRUE;

  -- ── Invite / pre-approved user table ──────────────────────────────────────
  -- Owner/Admin pre-registers an email+role before the employee creates their
  -- own login. Account creation is blocked unless a valid pending invite exists.
  CREATE TABLE IF NOT EXISTS user_invites (
    id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id     UUID    NOT NULL REFERENCES organisations(id),
    email               TEXT    NOT NULL,
    role                TEXT    NOT NULL CHECK (role IN ('owner', 'admin', 'therapist')),
    invited_by_user_id  UUID    REFERENCES users(id),
    status              TEXT    NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
    is_treating_therapist BOOLEAN DEFAULT FALSE,
    -- Optional: pre-link an existing therapist_profile so the user inherits it
    therapist_profile_id UUID   REFERENCES therapist_profiles(id),
    -- Secure random token included in the registration email link
    invite_token        TEXT    UNIQUE NOT NULL,
    invited_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    accepted_at         TIMESTAMP,
    expires_at          TIMESTAMP,
    revoked_at          TIMESTAMP,
    revoked_by_user_id  UUID    REFERENCES users(id),
    -- Optional pre-filled name hint shown on registration form
    display_name_hint   TEXT,
    metadata            JSONB   DEFAULT '{}',
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_user_invites_email    ON user_invites(email);
  CREATE INDEX IF NOT EXISTS idx_user_invites_token    ON user_invites(invite_token);
  CREATE INDEX IF NOT EXISTS idx_user_invites_status   ON user_invites(status);
  CREATE INDEX IF NOT EXISTS idx_user_invites_org_id   ON user_invites(organisation_id);

  -- ── Leave requests ──────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS leave_requests (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organisation_id       UUID REFERENCES organisations(id),
    leave_type            VARCHAR(50) NOT NULL,
    start_date            DATE NOT NULL,
    end_date              DATE NOT NULL,
    reason                TEXT,
    status                VARCHAR(20) NOT NULL DEFAULT 'submitted'
                          CHECK (status IN ('draft','submitted','approved','rejected')),
    submitted_at          TIMESTAMPTZ,
    approved_by_user_id   UUID REFERENCES users(id),
    approved_at           TIMESTAMPTZ,
    rejection_reason      TEXT,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_leave_requests_user_id   ON leave_requests(user_id);
  CREATE INDEX IF NOT EXISTS idx_leave_requests_org_id    ON leave_requests(organisation_id);
  CREATE INDEX IF NOT EXISTS idx_leave_requests_status    ON leave_requests(status);

  -- ── CPD / Professional development activities ────────────────────────────────
  CREATE TABLE IF NOT EXISTS cpd_activities (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organisation_id       UUID REFERENCES organisations(id),
    title                 VARCHAR(255) NOT NULL,
    provider              VARCHAR(255),
    completed_date        DATE,
    hours                 NUMERIC(5,1),
    cost_aud              NUMERIC(10,2),
    mode                  VARCHAR(50),
    category              VARCHAR(100),
    link                  TEXT,
    notes                 TEXT,
    status                VARCHAR(20) NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','submitted','approved','rejected')),
    submitted_at          TIMESTAMPTZ,
    reviewed_by_user_id   UUID REFERENCES users(id),
    reviewed_at           TIMESTAMPTZ,
    review_comments       TEXT,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_cpd_activities_user_id   ON cpd_activities(user_id);
  CREATE INDEX IF NOT EXISTS idx_cpd_activities_org_id    ON cpd_activities(organisation_id);
  CREATE INDEX IF NOT EXISTS idx_cpd_activities_status    ON cpd_activities(status);

  -- ── Professional development documents ──────────────────────────────────────
  CREATE TABLE IF NOT EXISTS pd_documents (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organisation_id           UUID REFERENCES organisations(id),
    title                     VARCHAR(255) NOT NULL,
    document_type             VARCHAR(100),
    file_name                 VARCHAR(255),
    file_mime                 VARCHAR(100),
    file_size_bytes           INTEGER,
    file_data                 TEXT,            -- base64 encoded file content (small files)
    uploaded_at               TIMESTAMPTZ DEFAULT NOW(),
    uploaded_by_user_id       UUID REFERENCES users(id),
    related_cpd_activity_id   UUID REFERENCES cpd_activities(id) ON DELETE SET NULL,
    status                    VARCHAR(20) DEFAULT 'active'
                              CHECK (status IN ('active','archived')),
    created_at                TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_pd_documents_user_id   ON pd_documents(user_id);
  CREATE INDEX IF NOT EXISTS idx_pd_documents_org_id    ON pd_documents(organisation_id);

  -- ── Credentials ─────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS credentials (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organisation_id       UUID REFERENCES organisations(id),
    credential_type       VARCHAR(100) NOT NULL,
    credential_name       VARCHAR(255) NOT NULL,
    issuing_body          VARCHAR(255),
    registration_number   VARCHAR(100),
    issue_date            DATE,
    expiry_date           DATE,
    document_id           UUID REFERENCES pd_documents(id) ON DELETE SET NULL,
    status                VARCHAR(30) NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','expired','pending_review','missing','verified','rejected')),
    verified_by_user_id   UUID REFERENCES users(id),
    verified_at           TIMESTAMPTZ,
    notes                 TEXT,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_credentials_user_id    ON credentials(user_id);
  CREATE INDEX IF NOT EXISTS idx_credentials_org_id     ON credentials(organisation_id);
  CREATE INDEX IF NOT EXISTS idx_credentials_expiry     ON credentials(expiry_date);

  -- ── Role CHECK constraint migration ───────────────────────────────────────
  -- Add 'read_only' to the user_invites.role constraint idempotently.
  -- The original auto-named constraint is dropped and replaced with a versioned
  -- one so re-running on an already-migrated database is a no-op.
  DO $$
  BEGIN
    -- Drop old constraint (original auto-generated name)
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints
       WHERE table_name = 'user_invites'
         AND constraint_type = 'CHECK'
         AND constraint_name = 'user_invites_role_check'
    ) THEN
      ALTER TABLE user_invites DROP CONSTRAINT user_invites_role_check;
    END IF;
    -- Add updated constraint only if it doesn't already exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
       WHERE table_name = 'user_invites'
         AND constraint_type = 'CHECK'
         AND constraint_name = 'user_invites_role_check_v2'
    ) THEN
      ALTER TABLE user_invites
        ADD CONSTRAINT user_invites_role_check_v2
        CHECK (role IN ('owner', 'admin', 'therapist', 'read_only'));
    END IF;
  END $$;

  -- ── Sessions (consolidated from session-store.js so the schema has one
  --    source of truth; PgSessionStore keeps its own IF NOT EXISTS no-op) ────
  CREATE TABLE IF NOT EXISTS sessions (
    sid    VARCHAR(255) PRIMARY KEY,
    sess   JSONB        NOT NULL,
    expire TIMESTAMPTZ  NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions (expire);

  -- ── App-level tables (consolidated from app-routes.js ensureAppTables so the
  --    schema has ONE source of truth; the app-routes copy is a no-op repeat) ──
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings   JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS org_settings (
    org_id     TEXT PRIMARY KEY DEFAULT 'opal',
    settings   JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS user_notifications (
    id             SERIAL PRIMARY KEY,
    user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
    type           TEXT,
    title          TEXT NOT NULL,
    message        TEXT NOT NULL,
    severity       TEXT DEFAULT 'info' CHECK (severity IN ('info','warning','error','success')),
    status         TEXT DEFAULT 'unread'  CHECK (status IN ('unread','read','dismissed')),
    related_entity TEXT,
    action_payload JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_user_notif_user ON user_notifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_user_notif_status ON user_notifications(status);

  -- ── Sync architecture migrations ───────────────────────────────────────────
  -- Add UNIQUE constraint on (user_id, outlook_id) to prevent duplicate rows
  -- from concurrent sync calls. Named so it can be checked idempotently.
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
       WHERE table_name = 'events'
         AND constraint_type = 'UNIQUE'
         AND constraint_name = 'events_user_outlook_unique'
    ) THEN
      ALTER TABLE events
        ADD CONSTRAINT events_user_outlook_unique UNIQUE (user_id, outlook_id);
    END IF;
  END $$;

  -- Add created_by_source to permanently record which system originated the event
  -- ('app' or 'outlook') — survives subsequent sync updates unlike source column.
  ALTER TABLE events ADD COLUMN IF NOT EXISTS created_by_source VARCHAR(20);

  -- Add sync_correlation_id to correlate related sync operations across systems.
  ALTER TABLE events ADD COLUMN IF NOT EXISTS sync_correlation_id VARCHAR(64);

  -- Backfill created_by_source from source for existing rows.
  UPDATE events SET created_by_source = source WHERE created_by_source IS NULL AND source IS NOT NULL;

  -- Backfill source='app' for rows that have no outlook_id and no source set.
  UPDATE events SET source = 'app' WHERE source IS NULL AND outlook_id IS NULL;
`;

// ===== INITIALIZE DATABASE =====
// Run this when server starts to create tables if they don't exist

async function initializeDatabase() {
  try {
    console.log('Initializing database...');
    await pool.query(INIT_QUERIES);

    // Remove duplicate outlook_id rows, keeping the most recently updated copy.
    // Safe to run on every boot — no-ops when there are no duplicates.
    await pool.query(`
      DELETE FROM events
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (PARTITION BY outlook_id ORDER BY updated_at DESC) AS rn
          FROM events
          WHERE outlook_id IS NOT NULL
        ) ranked
        WHERE rn > 1
      )
    `);

    console.log('✓ Database initialized successfully');
    return true;
  } catch (error) {
    console.error('✗ Database initialization error:', error);
    return false;
  }
}

// ===== DATABASE HELPER FUNCTIONS =====
// These are reusable functions to interact with the database

// Create a user
async function createUser(email, microsoftId) {
  const query = `
    INSERT INTO users (email, microsoft_id)
    VALUES ($1, $2)
    ON CONFLICT (email) DO UPDATE SET microsoft_id = $2
    RETURNING id, email, created_at;
  `;
  const result = await pool.query(query, [email, microsoftId]);
  return result.rows[0];
}

// Get user by ID — includes therapist profile data when available
async function getUser(userId) {
  const result = await pool.query(`
    SELECT
      u.*,
      tp.id                      AS tp_id,
      tp.display_name            AS tp_display_name,
      tp.colour                  AS tp_colour,
      tp.role_title              AS tp_role_title,
      tp.outlook_calendar_id     AS tp_outlook_calendar_id,
      tp.splose_practitioner_id  AS tp_splose_practitioner_id,
      tp.is_active               AS tp_is_active
    FROM users u
    LEFT JOIN therapist_profiles tp ON tp.user_id = u.id
    WHERE u.id = $1
  `, [userId]);
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  // Decrypt tokens before returning to callers
  row.access_token  = decrypt(row.access_token);
  row.refresh_token = decrypt(row.refresh_token);
  // Attach therapist profile as a sub-object when present
  if (row.tp_id) {
    row.therapistProfile = {
      id:                   row.tp_id,
      displayName:          row.tp_display_name,
      colour:               row.tp_colour,
      roleTitle:            row.tp_role_title,
      outlookCalendarId:    row.tp_outlook_calendar_id,
      splosePractitionerId: row.tp_splose_practitioner_id,
      isActive:             row.tp_is_active,
    };
    // Keep therapist_profile_id in sync with the real UUID from the join
    row.therapist_profile_id = row.tp_id;
  }
  return row;
}

// Get user by email (used for local password login)
async function getUserByEmail(email) {
  const query = 'SELECT * FROM users WHERE LOWER(email) = LOWER($1)';
  const result = await pool.query(query, [email]);
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  // Decrypt tokens before returning to callers
  row.access_token  = decrypt(row.access_token);
  row.refresh_token = decrypt(row.refresh_token);
  return row;
}

// Create a local-only user account (email + bcrypt password_hash + role)
// Used by the seed script and future user-management endpoints.
async function createLocalUser({ name, email, passwordHash, role, organisationId, isTreatingTherapist, therapistProfileId }) {
  const query = `
    INSERT INTO users (name, email, password_hash, role, organisation_id, is_active, is_treating_therapist, therapist_profile_id)
    VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7)
    ON CONFLICT (email) DO UPDATE
      SET name                   = EXCLUDED.name,
          password_hash          = EXCLUDED.password_hash,
          role                   = EXCLUDED.role,
          organisation_id        = EXCLUDED.organisation_id,
          is_treating_therapist  = EXCLUDED.is_treating_therapist,
          therapist_profile_id   = EXCLUDED.therapist_profile_id,
          updated_at             = CURRENT_TIMESTAMP
    RETURNING id, email, name, role, is_active, is_treating_therapist, therapist_profile_id, created_at;
  `;
  const result = await pool.query(query, [
    name, email, passwordHash,
    role || 'therapist',
    organisationId || null,
    isTreatingTherapist || false,
    therapistProfileId || null,
  ]);
  return result.rows[0];
}

// Update a user's role (owner only action)
async function updateUserRole(userId, newRole) {
  const result = await pool.query(`
    UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, email, role
  `, [newRole, userId]);
  return result.rows[0] || null;
}

// Record last login timestamp
async function recordLogin(userId) {
  await pool.query(
    'UPDATE users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [userId]
  );
}

// Write an audit log entry
async function logAuditEvent({ actorUserId, action, targetType, targetId, metadata, ipAddress, organisationId }) {
  await pool.query(`
    INSERT INTO audit_logs (organisation_id, actor_user_id, action, target_type, target_id, metadata, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [
    organisationId || null,
    actorUserId    || null,
    action,
    targetType     || null,
    targetId       || null,
    metadata ? JSON.stringify(metadata) : null,
    ipAddress      || null,
  ]);
}

// Update user tokens (after OAuth) — tokens are encrypted at rest
async function updateUserTokens(userId, accessToken, refreshToken, expiresIn) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const query = `
    UPDATE users
    SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = CURRENT_TIMESTAMP
    WHERE id = $4
    RETURNING *;
  `;
  const result = await pool.query(query, [
    encrypt(accessToken),
    encrypt(refreshToken),
    expiresAt,
    userId,
  ]);
  // Decrypt the returned row so callers always work with plaintext
  const row = result.rows[0];
  if (row) {
    row.access_token  = decrypt(row.access_token);
    row.refresh_token = decrypt(row.refresh_token);
  }
  return row;
}

// Create an event
async function createEvent(userId, eventData) {
  const {
    title, description, startTime, endTime, location, eventType,
    sploseId, outlookId, clientName, regionalTag, travelDistance,
    categories
  } = eventData;

  const query = `
    INSERT INTO events (
      user_id, title, description, start_time, end_time, location,
      event_type, splose_id, outlook_id, client_name, regional_tag, travel_distance,
      categories, sync_status, last_modified_by, source, created_by_source
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', 'app', 'app', 'app')
    RETURNING *;
  `;

  const result = await pool.query(query, [
    userId, title, description, startTime, endTime, location,
    eventType, sploseId, outlookId, clientName, regionalTag, travelDistance,
    Array.isArray(categories) ? categories : null
  ]);
  return result.rows[0];
}

// Get all events for a user — excludes soft-deleted records.
async function getEvents(userId, filters = {}) {
  let query = 'SELECT * FROM events WHERE user_id = $1 AND (is_deleted IS NULL OR is_deleted = FALSE)';
  let params = [userId];

  // Optional filters
  if (filters.startDate && filters.endDate) {
    query += ' AND start_time >= $' + (params.length + 1) + ' AND end_time <= $' + (params.length + 2);
    params.push(filters.startDate, filters.endDate);
  }

  if (filters.eventType) {
    query += ' AND event_type = $' + (params.length + 1);
    params.push(filters.eventType);
  }

  query += ' ORDER BY start_time ASC';

  const result = await pool.query(query, params);
  return result.rows;
}

// Update an event
async function updateEvent(eventId, eventData) {
  const {
    title, description, startTime, endTime, location,
    sploseId, outlookId, syncStatus, lastModifiedBy
  } = eventData;

  const query = `
    UPDATE events
    SET
      title = COALESCE($1, title),
      description = COALESCE($2, description),
      start_time = COALESCE($3, start_time),
      end_time = COALESCE($4, end_time),
      location = COALESCE($5, location),
      splose_id = COALESCE($6, splose_id),
      outlook_id = COALESCE($7, outlook_id),
      sync_status = COALESCE($8, sync_status),
      last_modified_by = COALESCE($9, last_modified_by),
      last_modified_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $10
    RETURNING *;
  `;

  const result = await pool.query(query, [
    title, description, startTime, endTime, location,
    sploseId, outlookId, syncStatus, lastModifiedBy, eventId
  ]);
  return result.rows[0];
}

// Delete an event
async function deleteEvent(eventId) {
  const query = 'DELETE FROM events WHERE id = $1 RETURNING id';
  const result = await pool.query(query, [eventId]);
  return result.rows[0];
}

// ===== DELTA SYNC STATE =====

async function getDeltaState(userId) {
  const result = await pool.query(
    'SELECT * FROM outlook_delta_state WHERE user_id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

async function saveDeltaState(userId, deltaToken) {
  await pool.query(`
    INSERT INTO outlook_delta_state (user_id, delta_token, last_synced_at, updated_at)
    VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id) DO UPDATE
      SET delta_token = $2, last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
  `, [userId, deltaToken]);
}

// Upsert an Outlook event — update if outlook_id already exists, insert if new.
// If the event is cancelled in Outlook (isCancelled = true), soft-deletes the
// local record instead of upserting. Returns the updated row or null for cancels.
//
// Also stamps therapist_profile_id and organisation_id from the user's profile
// so that multi-therapist calendar queries can filter by therapist without
// joining through the users table on every request.
async function upsertOutlookEvent(userId, eventData) {
  const {
    outlookId, startTime, endTime, location, categories,
    iCalUId, changeKey, lastModifiedAt, isCancelled,
    sploseId,
  } = eventData;
  // Outlook can return events with no subject (private/declined/restricted items).
  // Fall back to '(No title)' so the NOT NULL constraint is always satisfied.
  const title = eventData.title || '(No title)';
  const cats = Array.isArray(categories) ? categories : null;
  // Accept eventType from caller (classifyEventType in routes/server) or default to 'meeting'
  const eventType = eventData.eventType || 'meeting';
  // created_by_source records the origin system permanently ('app' or 'outlook')
  const createdBySource = eventData.createdBySource || 'outlook';

  // Cancelled events: mark the local Outlook-sourced record as deleted.
  if (isCancelled) {
    await pool.query(`
      UPDATE events
      SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND outlook_id = $2 AND source = 'outlook'
    `, [userId, outlookId]);
    return null;
  }

  // Resolve therapist_profile_id and organisation_id for this user (cached lazily
  // on the eventData object so we only query once per delta-sync batch).
  if (!eventData._therapistProfileId) {
    const profileRow = await pool.query(
      'SELECT id, organisation_id FROM therapist_profiles WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    if (profileRow.rows[0]) {
      eventData._therapistProfileId = profileRow.rows[0].id;
      eventData._organisationId     = profileRow.rows[0].organisation_id;
    } else {
      // User has no therapist profile yet — still sync events, just without the tag
      const userRow = await pool.query('SELECT organisation_id FROM users WHERE id = $1', [userId]);
      eventData._therapistProfileId = null;
      eventData._organisationId     = userRow.rows[0]?.organisation_id || null;
    }
  }
  const therapistProfileId = eventData._therapistProfileId || null;
  const organisationId     = eventData._organisationId     || null;

  // Check for existing row by outlook_id (take the most-recently-updated one
  // if duplicates somehow exist — the boot-time dedup query handles this too).
  const existing = await pool.query(
    'SELECT id FROM events WHERE user_id = $1 AND outlook_id = $2 ORDER BY updated_at DESC LIMIT 1',
    [userId, outlookId]
  );

  if (existing.rows.length > 0) {
    const result = await pool.query(`
      UPDATE events
      SET title                    = $1,
          start_time               = $2,
          end_time                 = $3,
          -- Preserve manual location override: if the user has manually set the
          -- routing address in the app, don't overwrite it with whatever Outlook
          -- has stored (Outlook typically only has suburb-level location).
          location                 = CASE WHEN is_manual_location_override = TRUE THEN location ELSE $4 END,
          categories               = $5,
          -- Preserve source: if this event was created by the app, keep it as 'app'.
          -- Only revert to 'outlook' if it was originally from Outlook.
          -- (Integration-test finding: the previous NULLIF/COALESCE form was
          --  inverted and stamped app-created rows back to 'outlook'.)
          source                   = CASE WHEN created_by_source = 'app' THEN 'app' ELSE 'outlook' END,
          sync_status              = 'synced',
          last_modified_by         = 'outlook',
          is_deleted               = FALSE,
          deleted_at               = NULL,
          outlook_ical_uid         = COALESCE($6, outlook_ical_uid),
          outlook_change_key       = COALESCE($7, outlook_change_key),
          outlook_last_modified_at = COALESCE($8, outlook_last_modified_at),
          synced_at                = CURRENT_TIMESTAMP,
          updated_at               = CURRENT_TIMESTAMP,
          -- Never overwrite created_by_source — it records the original origin permanently
          created_by_source        = COALESCE(created_by_source, $12),
          -- Stamp ownership (only update if not already set — backfill is separate)
          therapist_profile_id     = COALESCE(therapist_profile_id, $10),
          organisation_id          = COALESCE(organisation_id,      $11)
      WHERE id = $9
      RETURNING *
    `, [title, startTime, endTime, location, cats, iCalUId, changeKey, lastModifiedAt,
        existing.rows[0].id, therapistProfileId, organisationId, createdBySource]);
    return result.rows[0];
  } else {
    const result = await pool.query(`
      INSERT INTO events (
        user_id, title, start_time, end_time, location,
        outlook_id, splose_id, categories, source, sync_status, last_modified_by, event_type,
        outlook_ical_uid, outlook_change_key, outlook_last_modified_at,
        synced_at, is_deleted,
        therapist_profile_id, organisation_id,
        created_by_source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
              $14, 'synced', 'outlook', $15,
              $9, $10, $11, CURRENT_TIMESTAMP, FALSE,
              $12, $13,
              $14)
      RETURNING *
    `, [userId, title, startTime, endTime, location, outlookId, sploseId || null, cats,
        iCalUId, changeKey, lastModifiedAt, therapistProfileId, organisationId,
        createdBySource, eventType]);
    return result.rows[0];
  }
}

// Soft-delete a local Outlook-sourced event when Graph signals @removed or isCancelled.
// Only targets source = 'outlook' rows so app-created events are never touched.
async function softDeleteEventByOutlookId(userId, outlookId) {
  // is_deleted predicate makes the return value mean "newly tombstoned" —
  // delta-sync echoes of an already-deleted event are a true no-op, so the
  // callers' removed/cancelled counters stay accurate.
  const result = await pool.query(`
    UPDATE events
    SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $1 AND outlook_id = $2 AND source = 'outlook'
      AND (is_deleted IS NULL OR is_deleted = FALSE)
    RETURNING id
  `, [userId, outlookId]);
  return result.rows[0] || null;
}

// Hard-delete kept for legacy callers; prefer softDeleteEventByOutlookId.
async function deleteEventByOutlookId(userId, outlookId) {
  return softDeleteEventByOutlookId(userId, outlookId);
}

// Reconcile a calendar window: soft-delete any Outlook-sourced local events
// in [windowStart, windowEnd] whose outlook_id is NOT in the provided set.
// This catches events deleted in Outlook that never triggered a Graph @removed.
// Returns the list of rows that were soft-deleted (for logging).
async function reconcileOutlookWindow(userId, windowStart, windowEnd, knownOutlookIds) {
  // knownOutlookIds is an array of string IDs returned by Outlook for this window.
  // Any local outlook-sourced event in the window that isn't in this array is stale.
  //
  // DATA-LOSS GUARD: an empty knownOutlookIds list previously wiped the entire
  // window. An empty successful response is far more likely an upstream fault
  // (auth-scope change, truncated fetch, API hiccup) than a genuinely emptied
  // calendar, so it is now a warned no-op. Genuine bulk clears go through
  // /api/sync/cleanup with dryRun + explicit thresholds.
  if (!Array.isArray(knownOutlookIds) || knownOutlookIds.length === 0) {
    console.warn(
      `🛑 reconcileOutlookWindow: empty live-ID set for user ${userId} ` +
      `(${windowStart} → ${windowEnd}) — refusing window wipe, no events deleted`
    );
    return [];
  }

  const result = await pool.query(`
    UPDATE events
    SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $1
      AND source = 'outlook'
      AND outlook_id IS NOT NULL
      AND (is_deleted IS NULL OR is_deleted = FALSE)
      AND start_time >= $2
      AND start_time <= $3
      AND outlook_id != ALL($4::text[])
    RETURNING id, title, outlook_id, start_time
  `, [userId, windowStart, windowEnd, knownOutlookIds]);
  return result.rows;
}

/**
 * Threshold-guarded window reconciliation. Counts deletion candidates FIRST,
 * runs them through sync-safety assessment, and only tombstones when the batch
 * is within limits and the upstream fetch was complete.
 *
 * @returns {{blocked: boolean, reason: string, candidateCount: number,
 *            localLinkedCount: number, pruned: Array}}
 */
async function reconcileOutlookWindowSafe(userId, windowStart, windowEnd, knownOutlookIds, {
  fetchComplete = true,
  source = 'outlook_reconcile',
  dryRun = false,
} = {}) {
  const { assessDeletionSafety } = require('./sync-safety');
  const liveIds = Array.isArray(knownOutlookIds) ? knownOutlookIds : [];

  // Denominator + candidates counted before any write.
  const denom = await pool.query(`
    SELECT COUNT(*) AS n FROM events
    WHERE user_id = $1 AND source = 'outlook' AND outlook_id IS NOT NULL
      AND (is_deleted IS NULL OR is_deleted = FALSE)
      AND start_time >= $2 AND start_time <= $3
  `, [userId, windowStart, windowEnd]);
  const localLinkedCount = Number(denom.rows[0].n);

  const cand = liveIds.length === 0
    ? { rows: [{ n: localLinkedCount }] } // empty live set ⇒ every local row is a candidate
    : await pool.query(`
        SELECT COUNT(*) AS n FROM events
        WHERE user_id = $1 AND source = 'outlook' AND outlook_id IS NOT NULL
          AND (is_deleted IS NULL OR is_deleted = FALSE)
          AND start_time >= $2 AND start_time <= $3
          AND outlook_id != ALL($4::text[])
      `, [userId, windowStart, windowEnd, liveIds]);
  const candidateCount = Number(cand.rows[0].n);

  const verdict = assessDeletionSafety({
    source,
    fetchComplete,
    liveCount: liveIds.length,
    deletionCandidates: candidateCount,
    localLinkedCount,
  });

  if (!verdict.safe) {
    return { blocked: true, reason: verdict.reason, candidateCount, localLinkedCount, pruned: [], stats: verdict.stats };
  }
  if (dryRun || candidateCount === 0) {
    return { blocked: false, reason: dryRun ? 'dry_run' : 'no_deletions', candidateCount, localLinkedCount, pruned: [], stats: verdict.stats };
  }

  const pruned = await reconcileOutlookWindow(userId, windowStart, windowEnd, liveIds);
  return { blocked: false, reason: 'within_thresholds', candidateCount, localLinkedCount, pruned, stats: verdict.stats };
}

// One-time cleanup: soft-delete all Outlook-sourced events that were not seen
// in a fresh full Outlook fetch. Returns counts for logging.
async function cleanupStaleOutlookEvents(userId, knownOutlookIds) {
  // DATA-LOSS GUARD: previously an empty knownOutlookIds fell back to the
  // '__none__' sentinel, which matched nothing and therefore tombstoned EVERY
  // outlook-sourced event for the user. Empty live sets are now a warned no-op;
  // the cleanup route enforces thresholds and dry-run above this call.
  if (!Array.isArray(knownOutlookIds) || knownOutlookIds.length === 0) {
    console.warn(`🛑 cleanupStaleOutlookEvents: empty live-ID set for user ${userId} — refusing full wipe`);
    return [];
  }
  const result = await pool.query(`
    UPDATE events
    SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $1
      AND source = 'outlook'
      AND outlook_id IS NOT NULL
      AND (is_deleted IS NULL OR is_deleted = FALSE)
      AND outlook_id != ALL($2::text[])
    RETURNING id, title, outlook_id, start_time
  `, [userId, knownOutlookIds]);
  return result.rows;
}

// Merge duplicate Outlook rows: for each outlook_id with multiple local rows,
// keep the most-recently-updated one and soft-delete the rest.
async function deduplicateOutlookEvents(userId) {
  const result = await pool.query(`
    UPDATE events
    SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY outlook_id ORDER BY updated_at DESC) AS rn
        FROM events
        WHERE user_id = $1
          AND outlook_id IS NOT NULL
          AND source = 'outlook'
          AND (is_deleted IS NULL OR is_deleted = FALSE)
      ) ranked
      WHERE rn > 1
    )
    RETURNING id, outlook_id
  `, [userId]);
  return result.rows;
}

// Persist a manually-entered routing address and mark the event so Outlook
// syncs never overwrite it. Called by the PATCH .../location route.
async function updateEventManualLocation(eventId, locationData) {
  // locationData: { address, lat, lng }
  const result = await pool.query(`
    UPDATE events
    SET manual_location              = $1,
        is_manual_location_override  = TRUE,
        location                     = COALESCE($2, location),
        updated_at                   = CURRENT_TIMESTAMP
    WHERE id = $3
    RETURNING *
  `, [JSON.stringify(locationData), locationData.address || null, eventId]);
  return result.rows[0] || null;
}

// Store the Outlook event ID returned after a successful write-back.
// Subsequent Outlook syncs will match on this ID and update rather than duplicate.
async function updateEventOutlookId(eventId, outlookId) {
  const result = await pool.query(`
    UPDATE events
    SET outlook_id     = $1,
        sync_status    = 'synced',
        write_error    = NULL,
        last_write_attempt_at = CURRENT_TIMESTAMP,
        updated_at     = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING *
  `, [outlookId, eventId]);
  return result.rows[0] || null;
}

// Record a failed write-back attempt so the UI can surface an error state.
async function updateEventWriteError(eventId, errorMessage) {
  await pool.query(`
    UPDATE events
    SET write_error           = $1,
        sync_status           = 'error',
        last_write_attempt_at = CURRENT_TIMESTAMP,
        updated_at            = CURRENT_TIMESTAMP
    WHERE id = $2
  `, [errorMessage, eventId]);
}

// ===== THERAPIST PROFILE FUNCTIONS =====

// Get the therapist profile for a given user_id (returns null if user is not a therapist)
async function getTherapistProfile(userId) {
  const result = await pool.query(
    'SELECT * FROM therapist_profiles WHERE user_id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

// Get a therapist profile by its own primary key
async function getTherapistProfileById(profileId) {
  const result = await pool.query(
    'SELECT * FROM therapist_profiles WHERE id = $1',
    [profileId]
  );
  return result.rows[0] || null;
}

// List all active therapist profiles for an organisation, joined with user info
async function getAllTherapistProfiles(organisationId) {
  const result = await pool.query(`
    SELECT
      tp.*,
      u.name        AS user_name,
      u.email       AS user_email,
      u.role        AS user_role,
      u.is_active   AS user_is_active,
      u.microsoft_id,
      u.access_token IS NOT NULL AS has_outlook_connected
    FROM therapist_profiles tp
    JOIN users u ON u.id = tp.user_id
    WHERE tp.organisation_id = $1
      AND tp.is_active = TRUE
    ORDER BY tp.display_name ASC
  `, [organisationId]);
  return result.rows;
}

// Create or update a therapist profile.
// If a profile already exists for this user_id, update it; otherwise insert.
async function upsertTherapistProfile({ userId, organisationId, displayName, roleTitle, colour, outlookCalendarId, splosePractitionerId, defaultWorkLocationId }) {
  const result = await pool.query(`
    INSERT INTO therapist_profiles
      (user_id, organisation_id, display_name, role_title, colour, outlook_calendar_id, splose_practitioner_id, default_work_location_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (user_id) DO UPDATE
      SET organisation_id         = EXCLUDED.organisation_id,
          display_name            = EXCLUDED.display_name,
          role_title              = COALESCE(EXCLUDED.role_title,             therapist_profiles.role_title),
          colour                  = COALESCE(EXCLUDED.colour,                 therapist_profiles.colour),
          outlook_calendar_id     = COALESCE(EXCLUDED.outlook_calendar_id,    therapist_profiles.outlook_calendar_id),
          splose_practitioner_id  = COALESCE(EXCLUDED.splose_practitioner_id, therapist_profiles.splose_practitioner_id),
          default_work_location_id = COALESCE(EXCLUDED.default_work_location_id, therapist_profiles.default_work_location_id),
          updated_at              = CURRENT_TIMESTAMP
    RETURNING *
  `, [
    userId, organisationId || null, displayName,
    roleTitle || null, colour || '#5b6af0',
    outlookCalendarId || null, splosePractitionerId || null, defaultWorkLocationId || null,
  ]);
  return result.rows[0];
}

// Get or create a therapist profile for a user who is marked as a treating therapist.
// Used by the Outlook OAuth callback to ensure every treating user has a profile.
async function getOrCreateTherapistProfile(userId, { organisationId, displayName, colour } = {}) {
  const existing = await getTherapistProfile(userId);
  if (existing) return existing;
  const user = await getUser(userId);
  if (!user || !user.is_treating_therapist) return null;
  return upsertTherapistProfile({
    userId,
    organisationId: organisationId || user.organisation_id,
    displayName:    displayName    || user.name || user.email,
    colour:         colour         || '#5b6af0',
  });
}

// Stamp therapist_profile_id and organisation_id on all existing events for a user.
// Called after a therapist profile is created/updated to backfill their event rows.
async function backfillEventTherapistProfile(userId, therapistProfileId, organisationId) {
  const result = await pool.query(`
    UPDATE events
    SET therapist_profile_id = $1,
        organisation_id      = COALESCE(organisation_id, $2),
        updated_at           = CURRENT_TIMESTAMP
    WHERE user_id = $3
      AND therapist_profile_id IS NULL
    RETURNING id
  `, [therapistProfileId, organisationId || null, userId]);
  return result.rowCount;
}

// ===== MULTI-THERAPIST CALENDAR QUERIES =====

// Fetch events for one or more therapist profiles, with optional date filtering.
// Returns events ordered by start_time, tagged with therapist colour/name for the UI.
async function getEventsForTherapists(therapistProfileIds, { startDate, endDate, includeDeleted = false } = {}) {
  if (!therapistProfileIds || therapistProfileIds.length === 0) return [];

  let params = [therapistProfileIds];
  let conditions = ['e.therapist_profile_id = ANY($1::uuid[])'];

  if (!includeDeleted) {
    conditions.push('(e.is_deleted IS NULL OR e.is_deleted = FALSE)');
  }
  if (startDate) {
    params.push(startDate);
    conditions.push(`e.start_time >= $${params.length}`);
  }
  if (endDate) {
    params.push(endDate);
    conditions.push(`e.end_time <= $${params.length}`);
  }

  const result = await pool.query(`
    SELECT
      e.*,
      tp.display_name   AS therapist_name,
      tp.colour         AS therapist_colour,
      tp.role_title     AS therapist_role_title,
      u.email           AS therapist_email
    FROM events e
    JOIN therapist_profiles tp ON tp.id = e.therapist_profile_id
    JOIN users u               ON u.id  = tp.user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.start_time ASC
  `, params);
  return result.rows;
}

// Return free/busy blocks for a set of therapist profiles over a date range.
// Returns one entry per therapist with their busy time ranges.
async function getTherapistAvailability(therapistProfileIds, startDate, endDate) {
  if (!therapistProfileIds || therapistProfileIds.length === 0) return [];

  const result = await pool.query(`
    SELECT
      tp.id             AS therapist_profile_id,
      tp.display_name   AS therapist_name,
      tp.colour         AS therapist_colour,
      e.id              AS event_id,
      e.title,
      e.start_time,
      e.end_time,
      e.event_type,
      e.source
    FROM therapist_profiles tp
    LEFT JOIN events e
      ON  e.therapist_profile_id = tp.id
      AND e.start_time >= $2
      AND e.end_time   <= $3
      AND (e.is_deleted IS NULL OR e.is_deleted = FALSE)
    WHERE tp.id = ANY($1::uuid[])
      AND tp.is_active = TRUE
    ORDER BY tp.display_name ASC, e.start_time ASC
  `, [therapistProfileIds, startDate, endDate]);

  // Group by therapist
  const byTherapist = {};
  result.rows.forEach(row => {
    const key = row.therapist_profile_id;
    if (!byTherapist[key]) {
      byTherapist[key] = {
        therapistProfileId: key,
        therapistName:      row.therapist_name,
        therapistColour:    row.therapist_colour,
        busyBlocks: [],
      };
    }
    if (row.event_id) {
      byTherapist[key].busyBlocks.push({
        eventId:   row.event_id,
        title:     row.title,
        start:     row.start_time,
        end:       row.end_time,
        eventType: row.event_type,
        source:    row.source,
      });
    }
  });
  return Object.values(byTherapist);
}

// Log a sync action
async function logSync(eventId, action, source, target, status, errorMessage = null) {
  const query = `
    INSERT INTO sync_log (event_id, action, source, target, status, error_message)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;
  `;
  const result = await pool.query(query, [eventId, action, source, target, status, errorMessage]);
  return result.rows[0];
}

// ── INVITE FUNCTIONS ─────────────────────────────────────────────────────────

const crypto = require('crypto');

/**
 * Create a new user invite.
 * Returns the saved invite row including the generated token.
 */
async function createInvite({ organisationId, email, role, invitedByUserId, isTreatingTherapist, displayNameHint, expiresAt }) {
  const token = crypto.randomBytes(32).toString('hex');
  const result = await pool.query(`
    INSERT INTO user_invites
      (organisation_id, email, role, invited_by_user_id, is_treating_therapist,
       display_name_hint, invite_token, expires_at)
    VALUES ($1, LOWER($2), $3, $4, $5, $6, $7, $8)
    RETURNING *
  `, [
    organisationId,
    email.trim(),
    role,
    invitedByUserId || null,
    isTreatingTherapist || false,
    displayNameHint || null,
    token,
    expiresAt || null,
  ]);
  return result.rows[0];
}

/**
 * Find a pending (usable) invite by email.
 * Returns null if no valid invite exists.
 */
async function findPendingInviteByEmail(email) {
  const result = await pool.query(`
    SELECT * FROM user_invites
    WHERE LOWER(email) = LOWER($1)
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    ORDER BY invited_at DESC
    LIMIT 1
  `, [email.trim()]);
  return result.rows[0] || null;
}

/**
 * Find a pending invite by token (from the email link).
 * Returns null if not found, expired, or already used.
 */
async function findPendingInviteByToken(token) {
  const result = await pool.query(`
    SELECT * FROM user_invites
    WHERE invite_token = $1
      AND status = 'pending'
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    LIMIT 1
  `, [token]);
  return result.rows[0] || null;
}

/**
 * Get any invite by token regardless of status (for informative error messages).
 */
async function findInviteByToken(token) {
  const result = await pool.query(
    'SELECT * FROM user_invites WHERE invite_token = $1 LIMIT 1',
    [token]
  );
  return result.rows[0] || null;
}

/**
 * List all invites for an organisation (Owner/Admin view).
 */
async function getInvitesByOrganisation(organisationId) {
  const result = await pool.query(`
    SELECT
      i.*,
      u.name AS invited_by_name,
      u.email AS invited_by_email
    FROM user_invites i
    LEFT JOIN users u ON u.id = i.invited_by_user_id
    WHERE i.organisation_id = $1
    ORDER BY i.invited_at DESC
  `, [organisationId]);
  return result.rows;
}

/**
 * Mark an invite as accepted and record the accepting user.
 */
async function acceptInvite(inviteId) {
  const result = await pool.query(`
    UPDATE user_invites
    SET status       = 'accepted',
        accepted_at  = CURRENT_TIMESTAMP,
        updated_at   = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `, [inviteId]);
  return result.rows[0] || null;
}

/**
 * Revoke an invite (Owner/Admin action).
 */
async function revokeInvite(inviteId, revokedByUserId) {
  const result = await pool.query(`
    UPDATE user_invites
    SET status              = 'revoked',
        revoked_at          = CURRENT_TIMESTAMP,
        revoked_by_user_id  = $2,
        updated_at          = CURRENT_TIMESTAMP
    WHERE id = $1 AND status = 'pending'
    RETURNING *
  `, [inviteId, revokedByUserId]);
  return result.rows[0] || null;
}

/**
 * Register a new user account from a validated invite.
 * Creates the user row and (if treating therapist) a therapist_profile row.
 * Marks the invite as accepted.
 * Returns { user, therapistProfile }.
 */
async function registerUserFromInvite({ invite, passwordHash, name, phone, displayName, roleTitle }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create the user
    const userResult = await client.query(`
      INSERT INTO users
        (email, name, password_hash, role, organisation_id, is_active,
         is_treating_therapist, phone, display_name, role_title,
         profile_completed, onboarding_step)
      VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8, $9, FALSE, 'profile')
      RETURNING *
    `, [
      invite.email,
      name,
      passwordHash,
      invite.role,
      invite.organisation_id,
      invite.is_treating_therapist,
      phone || null,
      displayName || name,
      roleTitle || null,
    ]);
    const user = userResult.rows[0];

    // 2. Create therapist profile for treating therapists
    let therapistProfile = null;
    if (invite.is_treating_therapist) {
      const profResult = await client.query(`
        INSERT INTO therapist_profiles
          (user_id, organisation_id, display_name, role_title, colour)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id) DO UPDATE
          SET display_name    = EXCLUDED.display_name,
              role_title      = COALESCE(EXCLUDED.role_title, therapist_profiles.role_title),
              updated_at      = CURRENT_TIMESTAMP
        RETURNING *
      `, [
        user.id,
        invite.organisation_id,
        displayName || name,
        roleTitle || null,
        '#5b6af0',
      ]);
      therapistProfile = profResult.rows[0];

      // Link profile back onto user row
      await client.query(`
        UPDATE users
        SET therapist_profile_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [therapistProfile.id, user.id]);
      user.therapist_profile_id = String(therapistProfile.id);
    }

    // 3. Mark invite accepted
    await client.query(`
      UPDATE user_invites
      SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [invite.id]);

    await client.query('COMMIT');
    return { user, therapistProfile };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Complete a user's onboarding profile (step 2 after account creation).
 */
async function completeOnboardingProfile(userId, {
  displayName, roleTitle, phone, defaultWorkLocation, workLocationSchedule,
}) {
  const result = await pool.query(`
    UPDATE users
    SET display_name           = COALESCE($2, display_name),
        role_title             = COALESCE($3, role_title),
        phone                  = COALESCE($4, phone),
        default_work_location  = COALESCE($5, default_work_location),
        work_location_schedule = COALESCE($6, work_location_schedule),
        profile_completed      = TRUE,
        profile_completed_at   = CURRENT_TIMESTAMP,
        onboarding_step        = 'complete',
        updated_at             = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `, [userId, displayName || null, roleTitle || null, phone || null,
      defaultWorkLocation ? JSON.stringify(defaultWorkLocation) : null,
      workLocationSchedule ? JSON.stringify(workLocationSchedule) : null]);
  return result.rows[0] || null;
}

// ===== LEAVE REQUESTS =====

async function getLeaveRequests({ userId, organisationId, allOrg = false }) {
  if (allOrg && organisationId) {
    const r = await pool.query(
      `SELECT lr.*, u.email AS user_email, u.display_name AS user_display_name,
              a.email AS approver_email, a.display_name AS approver_display_name
       FROM leave_requests lr
       JOIN users u ON u.id = lr.user_id
       LEFT JOIN users a ON a.id = lr.approved_by_user_id
       WHERE lr.organisation_id = $1
       ORDER BY lr.created_at DESC`,
      [organisationId]
    );
    return r.rows;
  }
  const r = await pool.query(
    `SELECT lr.*, u.email AS user_email, u.display_name AS user_display_name,
            a.email AS approver_email, a.display_name AS approver_display_name
     FROM leave_requests lr
     JOIN users u ON u.id = lr.user_id
     LEFT JOIN users a ON a.id = lr.approved_by_user_id
     WHERE lr.user_id = $1
     ORDER BY lr.created_at DESC`,
    [userId]
  );
  return r.rows;
}

async function createLeaveRequest({ userId, organisationId, leaveType, startDate, endDate, reason, status = 'submitted' }) {
  const r = await pool.query(
    `INSERT INTO leave_requests (user_id, organisation_id, leave_type, start_date, end_date, reason, status, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [userId, organisationId, leaveType, startDate, endDate, reason || null,
     status, status === 'submitted' ? new Date() : null]
  );
  return r.rows[0];
}

async function updateLeaveStatus({ id, status, approvedByUserId, rejectionReason }) {
  const r = await pool.query(
    `UPDATE leave_requests
     SET status = $1,
         approved_by_user_id = $2,
         approved_at = CASE WHEN $1 IN ('approved','rejected') THEN NOW() ELSE NULL END,
         rejection_reason = $3,
         updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [status, approvedByUserId || null, rejectionReason || null, id]
  );
  return r.rows[0];
}

async function deleteLeaveRequest(id, userId) {
  // Only allow deletion of own draft requests
  const r = await pool.query(
    `DELETE FROM leave_requests WHERE id = $1 AND user_id = $2 AND status = 'draft' RETURNING id`,
    [id, userId]
  );
  return r.rows[0];
}

// ===== CPD ACTIVITIES =====

async function getCPDActivities({ userId, organisationId, allOrg = false }) {
  if (allOrg && organisationId) {
    const r = await pool.query(
      `SELECT ca.*, u.email AS user_email, u.display_name AS user_display_name,
              rv.email AS reviewer_email, rv.display_name AS reviewer_display_name
       FROM cpd_activities ca
       JOIN users u ON u.id = ca.user_id
       LEFT JOIN users rv ON rv.id = ca.reviewed_by_user_id
       WHERE ca.organisation_id = $1
       ORDER BY ca.created_at DESC`,
      [organisationId]
    );
    return r.rows;
  }
  const r = await pool.query(
    `SELECT ca.*, u.email AS user_email, u.display_name AS user_display_name,
            rv.email AS reviewer_email, rv.display_name AS reviewer_display_name
     FROM cpd_activities ca
     JOIN users u ON u.id = ca.user_id
     LEFT JOIN users rv ON rv.id = ca.reviewed_by_user_id
     WHERE ca.user_id = $1
     ORDER BY ca.created_at DESC`,
    [userId]
  );
  return r.rows;
}

async function createCPDActivity({ userId, organisationId, title, provider, completedDate, hours, costAud, mode, category, link, notes, status = 'draft' }) {
  const r = await pool.query(
    `INSERT INTO cpd_activities
       (user_id, organisation_id, title, provider, completed_date, hours, cost_aud, mode, category, link, notes, status, submitted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [userId, organisationId, title, provider || null, completedDate || null,
     hours || null, costAud || null, mode || null, category || null,
     link || null, notes || null, status,
     status === 'submitted' ? new Date() : null]
  );
  return r.rows[0];
}

async function updateCPDStatus({ id, status, reviewedByUserId, reviewComments }) {
  const r = await pool.query(
    `UPDATE cpd_activities
     SET status = $1,
         reviewed_by_user_id = $2,
         reviewed_at = CASE WHEN $1 IN ('approved','rejected') THEN NOW() ELSE NULL END,
         review_comments = $3,
         updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [status, reviewedByUserId || null, reviewComments || null, id]
  );
  return r.rows[0];
}

async function deleteCPDActivity(id, userId) {
  const r = await pool.query(
    `DELETE FROM cpd_activities WHERE id = $1 AND user_id = $2 AND status = 'draft' RETURNING id`,
    [id, userId]
  );
  return r.rows[0];
}

// ===== PD DOCUMENTS =====

async function getPDDocuments({ userId }) {
  const r = await pool.query(
    `SELECT id, user_id, organisation_id, title, document_type, file_name, file_mime,
            file_size_bytes, uploaded_at, uploaded_by_user_id, related_cpd_activity_id, status, created_at
     FROM pd_documents
     WHERE user_id = $1 AND status != 'archived'
     ORDER BY created_at DESC`,
    [userId]
  );
  return r.rows;
}

async function createPDDocument({ userId, organisationId, title, documentType, fileName, fileMime, fileSizeBytes, fileData, relatedCpdActivityId, storageBackend = 'db', storageKey = null }) {
  const r = await pool.query(
    `INSERT INTO pd_documents
       (user_id, organisation_id, title, document_type, file_name, file_mime, file_size_bytes,
        file_data, storage_backend, storage_key, uploaded_by_user_id, related_cpd_activity_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$1,$11)
     RETURNING id, user_id, organisation_id, title, document_type, file_name, file_mime, file_size_bytes,
               storage_backend, uploaded_at, status, created_at`,
    [userId, organisationId, title, documentType || null, fileName || null,
     fileMime || null, fileSizeBytes || null, fileData || null,
     storageBackend, storageKey, relatedCpdActivityId || null]
  );
  return r.rows[0];
}

// Fetch a single document row INCLUDING storage fields + bytes, ownership-checked.
// Used by the authenticated download route — never returns a public URL.
async function getPDDocumentForDownload(id, userId) {
  const r = await pool.query(
    `SELECT id, user_id, title, file_name, file_mime, file_data, storage_backend, storage_key
       FROM pd_documents WHERE id = $1`,
    [id]
  );
  const doc = r.rows[0];
  if (!doc) return null;
  return doc; // caller enforces owner/role
}

// Update the id-less storage record after an external put (blob/local) so the
// INSERT's id can become part of the storage key.
async function setPDDocumentStorage(id, { storageBackend, storageKey, clearInline = false }) {
  await pool.query(
    `UPDATE pd_documents
        SET storage_backend = $2, storage_key = $3
            ${clearInline ? ', file_data = NULL' : ''}
      WHERE id = $1`,
    [id, storageBackend, storageKey]
  );
}

async function deletePDDocument(id, userId) {
  const r = await pool.query(
    `DELETE FROM pd_documents WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId]
  );
  return r.rows[0];
}

// ===== CREDENTIALS =====

async function getCredentials({ userId, organisationId, allOrg = false }) {
  if (allOrg && organisationId) {
    const r = await pool.query(
      `SELECT c.*, u.email AS user_email, u.display_name AS user_display_name
       FROM credentials c
       JOIN users u ON u.id = c.user_id
       WHERE c.organisation_id = $1
       ORDER BY c.created_at DESC`,
      [organisationId]
    );
    return r.rows;
  }
  const r = await pool.query(
    `SELECT * FROM credentials WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return r.rows;
}

async function createCredential({ userId, organisationId, credentialType, credentialName, issuingBody, registrationNumber, issueDate, expiryDate, documentId, notes }) {
  const r = await pool.query(
    `INSERT INTO credentials
       (user_id, organisation_id, credential_type, credential_name, issuing_body, registration_number, issue_date, expiry_date, document_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [userId, organisationId, credentialType, credentialName, issuingBody || null,
     registrationNumber || null, issueDate || null, expiryDate || null,
     documentId || null, notes || null]
  );
  return r.rows[0];
}

async function updateCredential(id, userId, fields) {
  const allowed = ['credential_name','issuing_body','registration_number','issue_date','expiry_date','document_id','notes','status'];
  const sets = [];
  const vals = [];
  let idx = 1;
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) { sets.push(`${k} = $${idx++}`); vals.push(v); }
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  vals.push(id, userId);
  const r = await pool.query(
    `UPDATE credentials SET ${sets.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`,
    vals
  );
  return r.rows[0];
}

async function verifyCredential({ id, verifiedByUserId }) {
  const r = await pool.query(
    `UPDATE credentials SET status = 'verified', verified_by_user_id = $1, verified_at = NOW(), updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [verifiedByUserId, id]
  );
  return r.rows[0];
}

async function deleteCredential(id, userId) {
  const r = await pool.query(
    `DELETE FROM credentials WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId]
  );
  return r.rows[0];
}

// ===== EXPORTS =====
// Make these functions available to other files

module.exports = {
  pool,
  initializeDatabase,
  // User management
  createUser,
  getUser,
  getUserByEmail,
  createLocalUser,
  updateUserRole,
  recordLogin,
  updateUserTokens,
  // Audit logging
  logAuditEvent,
  // Events
  createEvent,
  getEvents,
  updateEvent,
  deleteEvent,
  logSync,
  // Outlook sync
  getDeltaState,
  saveDeltaState,
  upsertOutlookEvent,
  softDeleteEventByOutlookId,
  deleteEventByOutlookId,
  reconcileOutlookWindow,
  reconcileOutlookWindowSafe,
  cleanupStaleOutlookEvents,
  deduplicateOutlookEvents,
  // Write-back
  updateEventManualLocation,
  updateEventOutlookId,
  updateEventWriteError,
  // Therapist profiles
  getTherapistProfile,
  getTherapistProfileById,
  getAllTherapistProfiles,
  upsertTherapistProfile,
  getOrCreateTherapistProfile,
  backfillEventTherapistProfile,
  // Multi-therapist calendar
  getEventsForTherapists,
  getTherapistAvailability,
  // Invite / registration
  createInvite,
  findPendingInviteByEmail,
  findPendingInviteByToken,
  findInviteByToken,
  getInvitesByOrganisation,
  acceptInvite,
  revokeInvite,
  registerUserFromInvite,
  completeOnboardingProfile,
  // Leave requests
  getLeaveRequests,
  createLeaveRequest,
  updateLeaveStatus,
  deleteLeaveRequest,
  // CPD activities
  getCPDActivities,
  createCPDActivity,
  updateCPDStatus,
  deleteCPDActivity,
  // PD documents
  getPDDocuments,
  createPDDocument,
  getPDDocumentForDownload,
  setPDDocumentStorage,
  deletePDDocument,
  // Credentials
  getCredentials,
  createCredential,
  updateCredential,
  verifyCredential,
  deleteCredential,
};
