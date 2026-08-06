-- ═══════════════════════════════════════════════════════════════════════════
--  007 — Resource Hub V1: purchase requests, AI Resource Studio drafts,
--        kit progress, resource link health
-- ═══════════════════════════════════════════════════════════════════════════
-- Purchase requests: governed request → approval → order → receipt workflow.
-- Clinical fields (clinical_rationale, client_reference) are NEVER exposed to
-- the admin role — enforced in purchases-routes.js and kept out of event
-- metadata. resource_ai_drafts is a LOCAL draft store only: no external AI
-- calls exist anywhere (ENABLE_RESOURCE_AI_SUGGESTIONS stays false).

CREATE TABLE IF NOT EXISTS purchase_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID REFERENCES organisations(id),
  requester_user_id     UUID NOT NULL REFERENCES users(id),
  product_name          VARCHAR(300) NOT NULL,
  product_url           TEXT,
  supplier              VARCHAR(200),
  quantity              INTEGER NOT NULL DEFAULT 1,
  approx_cost_cents     INTEGER,
  cost_checked_on       DATE,
  intended_use          TEXT,
  clinical_rationale    TEXT,          -- clinical content: never shown to admin
  client_reference      VARCHAR(100),  -- clinical content: never shown to admin
  alternative_option    TEXT,
  safety_considerations TEXT,
  note                  TEXT,
  status                VARCHAR(30) NOT NULL DEFAULT 'draft',
    CONSTRAINT valid_purchase_status CHECK (status IN
      ('draft','submitted','changes_requested','approved','declined',
       'ordered','received','cancelled')),
  owner_comment         TEXT,
  spend_limit_cents     INTEGER,
  po_reference          VARCHAR(100),
  invoice_reference     VARCHAR(200),
  final_cost_cents      INTEGER,
  decided_by_user_id    UUID,
  decided_at            TIMESTAMPTZ,
  ordered_at            TIMESTAMPTZ,
  received_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_org_status
  ON purchase_requests (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_requester
  ON purchase_requests (requester_user_id);

CREATE TABLE IF NOT EXISTS purchase_request_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  actor_user_id UUID,
  action        VARCHAR(50) NOT NULL,
  comment       TEXT,
  metadata      JSONB,                 -- status only — never clinical fields
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchase_request_events_request
  ON purchase_request_events (request_id);

-- Local drafting workspace for the AI Resource Studio (manually authored;
-- the provider flag is off and no route calls any external service).
CREATE TABLE IF NOT EXISTS resource_ai_drafts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID REFERENCES organisations(id),
  user_id               UUID NOT NULL REFERENCES users(id),
  title                 VARCHAR(300) NOT NULL,
  resource_type         VARCHAR(50),
  topic                 VARCHAR(200),
  audience              VARCHAR(100),
  tone                  VARCHAR(50),
  format                VARCHAR(50),
  instructions          TEXT,
  content               TEXT,
  status                VARCHAR(30) NOT NULL DEFAULT 'private_draft',
    CONSTRAINT valid_ai_draft_status CHECK (status IN
      ('private_draft','submitted_for_review','changes_requested',
       'published','declined')),
  review_comment        TEXT,
  published_resource_id UUID,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_resource_ai_drafts_user
  ON resource_ai_drafts (user_id);
CREATE INDEX IF NOT EXISTS idx_resource_ai_drafts_status
  ON resource_ai_drafts (status);

-- Per-user starter-kit / learning-path progress (kit definitions live in the
-- frontend; the backend stores only opaque step keys).
CREATE TABLE IF NOT EXISTS user_resource_progress (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kit_key         VARCHAR(100) NOT NULL,
  completed_steps JSONB NOT NULL DEFAULT '[]',
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, kit_key)
);

-- Link health on resources (values used: NULL | 'ok' | 'reported' | 'broken';
-- no CHECK constraint to stay flexible — no outbound HTTP checks exist).
ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS link_status VARCHAR(20);
ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS link_checked_at TIMESTAMPTZ;
