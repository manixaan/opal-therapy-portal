-- ═══════════════════════════════════════════════════════════════════════════
-- 057 — More than one file per pack document
--
-- A pack document carried exactly one file: the library copy, or the copy
-- uploaded for this person. Real documents come in pieces — a passport and
-- the visa page, a certificate and its renewal letter — so a document can
-- now carry any number of attachments alongside its file. Each goes into
-- the pack ZIP after the document's own file, and each can be removed on
-- its own.
--
-- Bytes are stored the same way as the item's file: base64 in the row when
-- the storage backend is the database, else a storage key.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS onboarding_pack_item_attachments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID REFERENCES organisations(id) ON DELETE CASCADE,
  assignment_id    UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  item_id          UUID NOT NULL REFERENCES onboarding_pack_items(id) ON DELETE CASCADE,
  file_name        VARCHAR(255) NOT NULL,
  file_mime        VARCHAR(100) NOT NULL,
  file_size_bytes  INTEGER NOT NULL,
  file_sha256      VARCHAR(64) NOT NULL,
  storage_backend  VARCHAR(20) NOT NULL DEFAULT 'db',
  storage_key      TEXT,
  file_data        TEXT,
  uploaded_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sort_order       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_onboarding_pack_item_attachments_item
  ON onboarding_pack_item_attachments (item_id, sort_order, uploaded_at);
