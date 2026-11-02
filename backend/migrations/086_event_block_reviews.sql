-- 086 — event_block_reviews: blocks made outside the portal (Outlook, Splose)
-- and what the portal worked out about them.
--
-- A block created directly in Outlook or Splose arrives with no booking type,
-- usually no client and often no place, so billing and travel cannot use it.
-- block-review.js reads its title, location and Splose ids, guesses the
-- booking, and keeps one row here per block:
--
--   guessed      every field the booking type needs was found with
--                confidence; the guess is already applied to the event, but
--                the event is held out of invoicing until someone confirms it
--   needs_input  something is missing; nothing was applied, the review panel
--                asks for it
--   confirmed    a person (or an authoritative Splose record) settled it
--   dismissed    a person chose to leave the block as it came in
--
-- `before` is the event's own values ahead of an applied guess, so dismissing
-- a guess puts the block back exactly as it arrived. `fingerprint` is the
-- title/location/time the guess was made from: a needs_input block that
-- changes in Outlook is looked at again.
--
-- Nothing here is written back to Outlook or Splose.

CREATE TABLE IF NOT EXISTS event_block_reviews (
  event_id      UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('guessed', 'needs_input', 'confirmed', 'dismissed')),
  guess         JSONB NOT NULL DEFAULT '{}'::jsonb,
  before        JSONB,
  fingerprint   TEXT,
  classifier_version INTEGER NOT NULL DEFAULT 1,
  classified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS event_block_reviews_user_status
  ON event_block_reviews (user_id, status);
