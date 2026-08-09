-- ═══════════════════════════════════════════════════════════════════════════
-- 014 — Opal Portal internal ticketing & feedback system
--
-- Additive only. Four tables:
--   support_tickets            — one row per reported issue / request
--   support_ticket_comments    — append-only discussion thread
--   support_ticket_attachments — screenshot files (mirrors resource_files)
--   support_ticket_events      — append-only timeline (create/triage/status…)
-- plus support_ticket_counters — transactional ticket-number allocation
-- (OPA-0001, OPA-0002, …). Soft states only: tickets are never hard-deleted.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS support_ticket_counters (
  counter_key  VARCHAR(40) PRIMARY KEY,
  last_number  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    UUID REFERENCES organisations(id),
  ticket_number      VARCHAR(12) NOT NULL UNIQUE,
  reporter_user_id   UUID NOT NULL REFERENCES users(id),
  type               VARCHAR(20) NOT NULL,
  title              VARCHAR(200) NOT NULL,
  description        TEXT NOT NULL,
  expected_behaviour TEXT,
  reported_priority  VARCHAR(10) NOT NULL DEFAULT 'medium',
  triaged_priority   VARCHAR(4),          -- NULL until an admin/owner triages
  status             VARCHAR(20) NOT NULL DEFAULT 'new',
  assignee_user_id   UUID REFERENCES users(id),
  source_module      VARCHAR(60),
  source_route       VARCHAR(200),
  environment        VARCHAR(20),
  app_version        VARCHAR(40),
  browser_context    VARCHAR(300),
  technical_context  JSONB NOT NULL DEFAULT '{}',
  duplicate_of_id    UUID REFERENCES support_tickets(id),
  resolution         TEXT,
  wont_fix_reason    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at        TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,
  CONSTRAINT chk_support_ticket_type CHECK (type IN
    ('bug','feature_request','resource_issue','data_issue','usability','other')),
  CONSTRAINT chk_support_reported_priority CHECK (reported_priority IN
    ('low','medium','high','critical')),
  CONSTRAINT chk_support_triaged_priority CHECK (triaged_priority IS NULL OR
    triaged_priority IN ('p1','p2','p3','p4')),
  CONSTRAINT chk_support_status CHECK (status IN
    ('new','triaged','in_progress','ready_to_test','resolved','closed','wont_fix','duplicate'))
);

CREATE TABLE IF NOT EXISTS support_ticket_comments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id),
  body           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_ticket_attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  file_name       VARCHAR(300),
  file_mime       VARCHAR(100),
  file_size_bytes BIGINT,
  file_data       TEXT,             -- base64 when storage_backend='db'
  storage_backend VARCHAR(10) NOT NULL DEFAULT 'db',
  storage_key     TEXT,
  uploaded_by     UUID REFERENCES users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_ticket_events (
  id            BIGSERIAL PRIMARY KEY,
  ticket_id     UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id),
  event         VARCHAR(40) NOT NULL,
  detail        JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_org_status
  ON support_tickets (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_reporter
  ON support_tickets (reporter_user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assignee
  ON support_tickets (assignee_user_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_events_ticket
  ON support_ticket_events (ticket_id, id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_comments_ticket
  ON support_ticket_comments (ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_ticket
  ON support_ticket_attachments (ticket_id);
