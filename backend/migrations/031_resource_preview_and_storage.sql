-- ═══════════════════════════════════════════════════════════════════════════
--  031 — File preview facts, document control, and the storage-provider seam
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Three related additions to `resource_files`, all additive, all nullable, no
--  data moved and nothing dropped.
--
--  1. PREVIEW FACTS — so a file list is not a hundred file reads
--
--     Whether a document can be shown in the browser, how many pages it has and
--     whether it carries fillable form fields are properties OF THE FILE, not
--     of the request. Deriving them on demand means opening every document
--     every time somebody expands a resource: twenty files in a list becomes
--     twenty reads and twenty PDF parses, for information that has not changed
--     since the file was stored.
--
--     So they are recorded here, and NULL means "not inspected yet" — never
--     "no". That distinction is the whole reason these columns are nullable
--     rather than defaulted: a page count of 0 or a fillable flag of FALSE
--     would be an assertion, and until something has actually opened the file
--     we have no business asserting anything. The preview route degrades
--     gracefully on NULL by inspecting the bytes for that one file.
--
--     `preview_status` records what the scanning tooling concluded, including
--     the honest outcomes: 'unsupported' for the legacy binary Office files
--     that cannot be rendered in this environment (there is no LibreOffice, no
--     pandoc and no ghostscript on these machines), and 'failed' for a file
--     that was tried and would not parse. Neither is a bug to be hidden behind
--     a spinner.
--
--     `preview_storage_key` reserves room for a DERIVED artefact — a rendered
--     thumbnail or a first-page image — should one ever be generated. It is a
--     key inside the same governed root, constrained to be relative exactly as
--     `storage_key` is, so a derivative can never be pointed at the historical
--     source vault. Nothing writes it today, and no derivative may ever replace
--     the original: a fillable PDF is served as stored, never flattened.
--
--  2. DOCUMENT CONTROL — versions supersede, they do not overwrite
--
--     `version`, `canonical_filename` and `replaced_by_file_id` let a newer
--     file be published while the one it replaced stays in place, still
--     downloadable and still the file a past letter or report actually cited.
--     Deleting the old row would break that citation and quietly rewrite
--     history; pointing at the successor keeps both facts.
--
--     `detected_mime` is what an inspection of the BYTES found, kept strictly
--     apart from `file_mime`, which is what the uploader claimed. Both are
--     recorded and NEITHER is ever used to choose a response Content-Type —
--     that comes from the `format` allow-list in resource-file-storage.js, and
--     it must stay that way, or whatever wrote the row gets to decide how a
--     browser interprets the bytes.
--
--  3. THE EXTERNAL-PROVIDER SEAM (readiness only)
--
--     Opal may later hold its resource files in SharePoint rather than on local
--     disk. The FIELDS to describe such a file exist after this migration; NO
--     authentication, NO sync, NO Graph client and NO code path to a Microsoft
--     endpoint is built here, and none may be added without its own decision.
--     What this buys is that the day the decision is made, the schema does not
--     have to change underneath live data — an item id, a drive id, an etag and
--     a sync status can be recorded from the first sync rather than bolted on
--     after it. `source_url` is https-only by CHECK for the same reason every
--     other URL column in this schema is: an http link in a clinical library is
--     a downgrade waiting to be intercepted.
--
--  4. THE storage_backend CONSTRAINT — MADE TO FIT WHAT IS ACTUALLY WRITTEN
--
--     The column has had no CHECK since 005 and three separate writers:
--       * backend/storage/index.js (via resources-routes.js) writes
--         'db' | 'local' | 'blob' — whichever DOCUMENT_STORAGE_BACKEND names;
--       * backend/scripts/ingest-resource-files.js writes 'local' literally;
--       * backend/setup/seed-opal-originals.js and seed-cleanroom-originals.js
--         write 'rhub', the governed Resource Hub root.
--
--     'local' is NOT repaired to 'rhub' here, and that is deliberate. Those
--     rows are truthful: their bytes really do sit under DOCUMENT_STORAGE_PATH,
--     a different root from the Resource Hub's RESOURCE_HUB_STORAGE_PATH.
--     Relabelling them would make the row claim a location the file is not in,
--     turning an honest reader gap (resource-hub-r2-routes.js serves bytes for
--     'rhub' and inline data, and does not yet read the 'local' root) into a
--     lie in the data. The gap belongs to the reader and must be fixed there,
--     by a change that decides whether the hub SHOULD read the employee
--     document root at all — a governance question, not a migration.
--
--     The constraint is therefore added NOT VALID and then validated in a
--     separate block that survives failure. Future writes are constrained
--     immediately; an unexpected legacy value in some environment leaves the
--     constraint unvalidated with a NOTICE instead of aborting the deployment.
--     A migration that refuses to apply because of data it did not write is
--     worse than no migration: it blocks every later migration behind it.
--
--  Idempotent. See backend/migrations/README.md.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Preview facts ────────────────────────────────────────────────────────

ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS preview_status       VARCHAR(30);
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS preview_storage_key  VARCHAR(400);
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS preview_page_count   INTEGER;
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS has_fillable_fields  BOOLEAN;
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS detected_mime        VARCHAR(120);

COMMENT ON COLUMN resource_files.preview_status IS
  'What the scanner concluded. NULL means not inspected yet — never "not previewable".';
COMMENT ON COLUMN resource_files.preview_storage_key IS
  'Relative key of a DERIVED preview artefact inside the governed root. Never replaces the original file.';
COMMENT ON COLUMN resource_files.preview_page_count IS
  'Pages as counted by inspection. NULL means unknown; the client shows nothing rather than zero.';
COMMENT ON COLUMN resource_files.has_fillable_fields IS
  'TRUE when the PDF carries AcroForm fields. Such a file is served unmodified — never flattened.';
COMMENT ON COLUMN resource_files.detected_mime IS
  'What inspection of the bytes found, as distinct from the uploader-supplied file_mime. Never used to choose a response Content-Type.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_resource_file_preview_status') THEN
    ALTER TABLE resource_files ADD CONSTRAINT valid_resource_file_preview_status CHECK (
      preview_status IS NULL
      OR preview_status IN ('none','pending','ready','unsupported','failed'));
  END IF;
END $$;

-- A page count is a count of pages that exist, so it is at least 1: a document
-- with no pages is not a document, and "we do not know" is what NULL is for.
-- Zero would be a parser failure recorded as a fact. The ceiling is a sanity
-- guard against a parser returning something wild, not a document-size policy.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_file_preview_page_count_is_sane') THEN
    ALTER TABLE resource_files ADD CONSTRAINT resource_file_preview_page_count_is_sane CHECK (
      preview_page_count IS NULL
      OR (preview_page_count >= 1 AND preview_page_count <= 100000));
  END IF;
END $$;

-- Exactly the rule migration 026 applies to storage_key. A derived artefact is
-- no less capable of pointing outside the governed root than an original.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_file_preview_key_is_relative') THEN
    ALTER TABLE resource_files ADD CONSTRAINT resource_file_preview_key_is_relative CHECK (
      preview_storage_key IS NULL
      OR (preview_storage_key <> ''
          AND preview_storage_key NOT LIKE '/%'
          AND preview_storage_key NOT LIKE '\\%'
          AND preview_storage_key !~ '^[A-Za-z]:'
          AND preview_storage_key NOT LIKE '%..%'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_resource_files_preview_status
  ON resource_files (preview_status) WHERE preview_status IS NOT NULL;

-- ── 2. Document control ─────────────────────────────────────────────────────

ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS canonical_filename   VARCHAR(200);
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS version              VARCHAR(20);
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS replaced_by_file_id  UUID;

COMMENT ON COLUMN resource_files.canonical_filename IS
  'The name this file should be offered under, independent of whatever it was uploaded as.';
COMMENT ON COLUMN resource_files.version IS
  'Document version as printed on the document itself, not a database revision counter.';
COMMENT ON COLUMN resource_files.replaced_by_file_id IS
  'Successor file. The superseded row stays downloadable so an earlier citation still resolves.';

-- Named explicitly rather than inline, so it is greppable and so a re-run finds
-- it. ON DELETE SET NULL: deleting a successor must not cascade away the
-- history it replaced.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_files_replaced_by_fkey') THEN
    ALTER TABLE resource_files ADD CONSTRAINT resource_files_replaced_by_fkey
      FOREIGN KEY (replaced_by_file_id) REFERENCES resource_files(id) ON DELETE SET NULL;
  END IF;
END $$;

-- A file cannot supersede itself. Left unchecked this reads as "superseded" in
-- every listing and hides the file behind its own replacement.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_file_not_self_superseding') THEN
    ALTER TABLE resource_files ADD CONSTRAINT resource_file_not_self_superseding CHECK (
      replaced_by_file_id IS NULL OR replaced_by_file_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_resource_files_replaced_by
  ON resource_files (replaced_by_file_id) WHERE replaced_by_file_id IS NOT NULL;

-- ── 3. External provider seam — fields only, no sync ────────────────────────

ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS external_provider   VARCHAR(40);
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS external_drive_id   VARCHAR(200);
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS external_item_id    VARCHAR(200);
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS source_url          TEXT;
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS etag                VARCHAR(200);
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS last_modified_at    TIMESTAMPTZ;
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS last_synced_at      TIMESTAMPTZ;
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS sync_status         VARCHAR(30);
ALTER TABLE resource_files ADD COLUMN IF NOT EXISTS sync_error          TEXT;

COMMENT ON COLUMN resource_files.external_provider IS
  'Where the authoritative copy lives. Readiness only: no SharePoint authentication or sync exists in this codebase.';
COMMENT ON COLUMN resource_files.etag IS
  'Provider change token, so a future sync can tell "unchanged" from "not checked". Never trusted for access decisions.';
COMMENT ON COLUMN resource_files.sync_error IS
  'Why the last sync attempt failed, for an administrator. Never surfaced to a clinician and never returned by a file route.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_resource_file_external_provider') THEN
    ALTER TABLE resource_files ADD CONSTRAINT valid_resource_file_external_provider CHECK (
      external_provider IS NULL OR external_provider IN ('local','rhub','sharepoint'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_resource_file_sync_status') THEN
    ALTER TABLE resource_files ADD CONSTRAINT valid_resource_file_sync_status CHECK (
      sync_status IS NULL
      OR sync_status IN ('never','pending','synced','failed','disabled'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_file_source_url_is_https') THEN
    ALTER TABLE resource_files ADD CONSTRAINT resource_file_source_url_is_https CHECK (
      source_url IS NULL OR source_url ~ '^https://');
  END IF;
END $$;

-- One row per external item. A future sync that runs twice must update a file,
-- not create a second one beside it.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_resource_files_external_item
  ON resource_files (external_provider, external_drive_id, external_item_id)
  WHERE external_item_id IS NOT NULL;

-- ── 4. storage_backend: widen, then constrain to observed reality ───────────

-- 'sharepoint' is exactly ten characters and the column is VARCHAR(10), so the
-- seam above would fit only by luck. Widening a varchar takes no table rewrite
-- and is guarded so a re-run does no work at all.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'resource_files' AND column_name = 'storage_backend'
       AND character_maximum_length IS NOT NULL AND character_maximum_length < 20
  ) THEN
    ALTER TABLE resource_files ALTER COLUMN storage_backend TYPE VARCHAR(20);
  END IF;
END $$;

-- Blank is not a backend. This is the one repair worth making: the column is
-- already NOT NULL DEFAULT 'db', so an empty string is the only way a row can
-- carry no backend at all, it is unambiguously wrong, and 'db' is both the
-- default and the reader's fallback — such a row already behaves as 'db'
-- everywhere. Legitimate values are left exactly as written; see the header for
-- why 'local' is not relabelled.
UPDATE resource_files SET storage_backend = 'db' WHERE btrim(storage_backend) = '';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_resource_file_storage_backend') THEN
    ALTER TABLE resource_files ADD CONSTRAINT valid_resource_file_storage_backend CHECK (
      storage_backend IN ('db','local','blob','rhub','sharepoint')) NOT VALID;
  END IF;
END $$;

-- Validate separately and survive failure. NOT VALID already governs every
-- future write; validation only asks whether the rows already present comply.
-- If some environment holds a value nobody here has seen, the right outcome is
-- a NOTICE and an unvalidated constraint, not a failed deployment.
DO $$ BEGIN
  ALTER TABLE resource_files VALIDATE CONSTRAINT valid_resource_file_storage_backend;
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'valid_resource_file_storage_backend left NOT VALID: existing resource_files rows hold a storage_backend outside (db, local, blob, rhub, sharepoint). New writes are still constrained. Investigate with: SELECT DISTINCT storage_backend FROM resource_files;';
END $$;

COMMENT ON COLUMN resource_files.storage_backend IS
  'Which store holds the bytes: db (inline base64), local (DOCUMENT_STORAGE_PATH), blob (Azure), rhub (governed Resource Hub root), sharepoint (reserved, not implemented).';
