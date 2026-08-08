-- ═══════════════════════════════════════════════════════════════════════════
-- 012 — Opa AI Assistant: application knowledge registry + chat persistence
--
-- Additive only. Three new tables, no changes to existing objects.
--
-- Concept map:
--   opa_feature_knowledge — curated registry of REAL application features.
--                           This is the assistant's only source of claims
--                           about the Portal; anything absent here is
--                           "cannot confirm". Status tracks honesty
--                           (live/partial/experimental/planned/deprecated);
--                           minimum_role hides admin/owner features from
--                           lower roles. Content is operator-authored, never
--                           model-authored.
--   opa_conversations     — one row per user chat thread (title = first
--                           message excerpt). Org-scoped, user-owned.
--   opa_messages          — ordered turns within a conversation. sources and
--                           actions record what the assistant grounded on
--                           and offered, for audit and reload continuity.
--
-- Retention (conservative by design): message content is retained solely so
-- users can resume their own conversations. A future config may trim or
-- expire it. No analytics, no hidden staff profiling, and no client or
-- clinical data is ever meant to enter these tables — the assistant is
-- instructed not to repeat such details and audit metadata never includes
-- message content.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── application knowledge registry ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS opa_feature_knowledge (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module           VARCHAR(60)  NOT NULL,
  feature          VARCHAR(150) NOT NULL,
  route            VARCHAR(120),
  summary          TEXT NOT NULL,
  status           VARCHAR(15) NOT NULL DEFAULT 'live'
                   CONSTRAINT valid_opa_knowledge_status CHECK
                   (status IN ('live','partial','experimental','planned','deprecated')),
  -- NULL = visible to every authenticated role; otherwise the LOWEST role
  -- that may see the record (therapist < admin < owner).
  minimum_role     VARCHAR(20) DEFAULT NULL
                   CONSTRAINT valid_opa_minimum_role CHECK
                   (minimum_role IS NULL OR minimum_role IN ('therapist','admin','owner')),
  aliases          JSONB NOT NULL DEFAULT '[]',
  instructions     JSONB NOT NULL DEFAULT '[]',
  troubleshooting  JSONB NOT NULL DEFAULT '[]',
  related_features JSONB NOT NULL DEFAULT '[]',
  version          INTEGER NOT NULL DEFAULT 1,
  reviewed_at      DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_opa_knowledge_module_feature UNIQUE (module, feature)
);
CREATE INDEX IF NOT EXISTS idx_opa_knowledge_module ON opa_feature_knowledge (module);

-- ── conversations (user-owned threads) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS opa_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id UUID REFERENCES organisations(id),
  title           VARCHAR(120),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_opa_conversations_user_recent
  ON opa_conversations (user_id, updated_at DESC);

-- ── messages (ordered turns) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS opa_messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES opa_conversations(id) ON DELETE CASCADE,
  role            VARCHAR(10) NOT NULL
                  CONSTRAINT valid_opa_message_role CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  sources         JSONB NOT NULL DEFAULT '[]',
  actions         JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_opa_messages_conversation
  ON opa_messages (conversation_id, id);
