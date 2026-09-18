-- 070: Opal Assist — the practice-wide assistant (backend/assist/*,
-- backend/assist-routes.js). Conversations and turns, DE-IDENTIFIED ONLY.
--
-- What is stored is exactly what the model was shown: text in which every
-- person and contact detail is a bracketed token. The mapping from token to
-- person is never written here — the browser holds it for the person who
-- typed the names, and a token resolves through the practice directory by
-- reference (splose:patient:<id>, user:<id>) if it ever needs to. A row
-- therefore cannot identify a participant on its own.
--
-- Retention is 30 days (Owner decision, 18 Sep 2026): `expires_at` is set
-- at creation and pushed forward on every turn; the server deletes expired
-- conversations daily and at boot. There is no analytics use of this data.

CREATE TABLE IF NOT EXISTS assist_conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id  UUID REFERENCES organisations(id) ON DELETE SET NULL,
  title            VARCHAR(120),
  surface          VARCHAR(16) NOT NULL DEFAULT 'web'
                   CHECK (surface IN ('web', 'word', 'excel', 'outlook', 'mobile')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);
CREATE INDEX IF NOT EXISTS assist_conversations_user_idx ON assist_conversations (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS assist_conversations_expiry_idx ON assist_conversations (expires_at);

CREATE TABLE IF NOT EXISTS assist_messages (
  id               BIGSERIAL PRIMARY KEY,
  conversation_id  UUID NOT NULL REFERENCES assist_conversations(id) ON DELETE CASCADE,
  role             VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
  content          TEXT NOT NULL,
  hidden_count     INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS assist_messages_conversation_idx ON assist_messages (conversation_id, id);
