-- 084: Opal Assist — chats dedicated to one client.
--
-- A practitioner may pick a client on the Opal Assist side panel; every chat
-- started there belongs to that client, and the panel lists that client's
-- earlier chats. What is stored is a directory REFERENCE
-- (`splose:patient:<id>`), never a name — the same reference the de-identifier
-- already resolves tokens through (migration 070's header). The transcript
-- itself stays tokenised; the client is [CLIENT_1] in every turn.
--
-- NULL = a general chat with no client, exactly as before. Retention is
-- unchanged (30 days from the last turn).

ALTER TABLE assist_conversations ADD COLUMN IF NOT EXISTS client_ref VARCHAR(64);

CREATE INDEX IF NOT EXISTS assist_conversations_client_idx
  ON assist_conversations (user_id, client_ref, updated_at DESC);
