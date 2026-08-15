-- 031: Preview derivatives for Resource Hub files.
--
-- A derivative is a GENERATED representation of one stored original — a
-- first-page thumbnail, a preview PDF converted from a legacy Word file — and
-- is never a resource in its own right. Modelling them as rows under
-- resource_files (rather than as extra resource_files rows) keeps the
-- original/derivative distinction structural: deleting or quarantining the
-- original cascades away every derivative record, and a derivative can never
-- be listed, downloaded or counted as a document.
--
-- Idempotency contract: (resource_file_id, kind) is unique, and
-- source_checksum_sha256 records the original's hash at generation time, so a
-- regeneration pass can tell "already current" from "stale" without reading
-- either blob.

CREATE TABLE IF NOT EXISTS resource_file_derivatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_file_id UUID NOT NULL REFERENCES resource_files(id) ON DELETE CASCADE,

  -- 'thumbnail'     small raster of the first meaningful page, for cards
  -- 'preview-pdf'   full-document PDF rendition of a non-PDF original
  -- 'preview-docx'  DOCX rendition of a legacy .doc, for the in-app viewer
  -- 'preview-image' full-size raster preview (single-image originals)
  kind VARCHAR(30) NOT NULL
    CONSTRAINT valid_derivative_kind
    CHECK (kind IN ('thumbnail', 'preview-pdf', 'preview-docx', 'preview-image')),

  storage_backend VARCHAR(10) NOT NULL DEFAULT 'rhub',
  -- Same relative-only shape as resource_files.storage_key (migration 026):
  -- the governed root is the whole point, so a key may never look like a path.
  storage_key TEXT NOT NULL
    CONSTRAINT derivative_storage_key_is_relative
    CHECK (storage_key <> ''
           AND storage_key NOT LIKE '/%'
           AND storage_key NOT LIKE '\%'
           AND storage_key !~ '^[A-Za-z]:'
           AND storage_key NOT LIKE '%..%'),

  format VARCHAR(20) NOT NULL
    CONSTRAINT valid_derivative_format
    CHECK (format IN ('png', 'webp', 'jpg', 'pdf', 'docx')),

  width_px INTEGER CHECK (width_px IS NULL OR width_px > 0),
  height_px INTEGER CHECK (height_px IS NULL OR height_px > 0),
  page_count INTEGER CHECK (page_count IS NULL OR page_count >= 0),
  size_bytes BIGINT
    CONSTRAINT derivative_size_is_sane
    CHECK (size_bytes IS NULL OR (size_bytes >= 0 AND size_bytes <= 104857600)),

  checksum_sha256 VARCHAR(64)
    CONSTRAINT derivative_checksum_is_sha256
    CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  -- Hash of the ORIGINAL file when this derivative was generated. If it no
  -- longer matches resource_files.checksum_sha256 the derivative is stale.
  source_checksum_sha256 VARCHAR(64)
    CONSTRAINT derivative_source_checksum_is_sha256
    CHECK (source_checksum_sha256 IS NULL OR source_checksum_sha256 ~ '^[0-9a-f]{64}$'),

  -- Which tool produced it (e.g. 'poppler-pdftoppm', 'quicklook', 'sips',
  -- 'textutil'), so a renderer upgrade can invalidate exactly its own output.
  renderer VARCHAR(60) NOT NULL,
  renderer_version VARCHAR(60),

  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uniq_derivative_per_kind UNIQUE (resource_file_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_resource_file_derivatives_file
  ON resource_file_derivatives(resource_file_id);
