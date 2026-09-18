-- 069: Practice-level integration connections — the Splose API key moves out
-- of the environment and into a row the Owner can replace or disconnect from
-- Settings → Integrations (backend/splose-credentials.js, splose-link-routes.js).
--
-- One row per provider. Three states:
--   • no row                         → fall back to the environment variable;
--   • secret_encrypted present       → connected from the database (wins);
--   • secret_encrypted NULL, with    → explicitly disconnected: the
--     disconnected_at set              environment key is IGNORED too.
--
-- The secret is AES-GCM encrypted by crypto-utils when TOKEN_ENCRYPTION_KEY is
-- set (same scheme as the Outlook tokens on users). Nothing here is ever
-- returned to a client — only who connected it, when, and a label.

CREATE TABLE IF NOT EXISTS integration_connections (
  provider          VARCHAR(32) PRIMARY KEY,
  secret_encrypted  TEXT,
  label             VARCHAR(120),
  connected_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  connected_at      TIMESTAMPTZ,
  disconnected_at   TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT integration_connections_provider_chk CHECK (provider IN ('splose'))
);
