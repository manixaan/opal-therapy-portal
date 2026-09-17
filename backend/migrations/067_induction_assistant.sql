-- 067: Induction assistant — the Owner's conversational co-author on the
-- Assign Learning page (backend/induction-assistant-routes.js).
--
-- Mirrors the Opa chat tables (012): one row per user-owned thread, ordered
-- turns beneath it. `actions` records what the assistant DID on a turn —
-- ids-only summaries of the tools it called ("created induction <id>") — so
-- the page can render the activity and the audit trail can be read back.
-- Message content is the Owner's own words and the model's answers about
-- training material; no participant data belongs here.

CREATE TABLE IF NOT EXISTS induction_assistant_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id UUID REFERENCES organisations(id),
  title           VARCHAR(120),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_induction_assistant_conversations_user_recent
  ON induction_assistant_conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS induction_assistant_messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES induction_assistant_conversations(id) ON DELETE CASCADE,
  role            VARCHAR(10) NOT NULL
                  CONSTRAINT valid_induction_assistant_message_role CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  actions         JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_induction_assistant_messages_conversation
  ON induction_assistant_messages (conversation_id, id);
