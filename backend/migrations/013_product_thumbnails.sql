-- ═══ 013 — Product thumbnails for the Therapy Store ═══
-- Additive: an optional https image URL rendered on catalogue cards.
-- Populated manually by the owner or backfilled from supplier-search
-- thumbnails (Google PSE) via an explicit owner action — never fetched
-- during normal page requests.
ALTER TABLE resources ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
