-- ═══════════════════════════════════════════════════════════════════════════
--  016 — Travel-block linkage: related_event_id
-- ═══════════════════════════════════════════════════════════════════════════
-- Travel blocks (event_type='travel') are created by the app around client
-- appointments, but until now carried no reference to the appointment they
-- serve. Deleting an appointment therefore stranded its travel blocks.
--
-- related_event_id records that ownership going forward: the travel-block
-- creation path (POST /api/outlook/travel-blocks) stamps the appointment's
-- events.id here. ON DELETE SET NULL keeps hard deletes safe — the app only
-- ever soft-deletes, so the FK action is a belt-and-braces guard, not a
-- cascade mechanism. Existing unlinked travel blocks are handled by a
-- conservative adjacency fallback in travel-cascade.js at delete time.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS related_event_id UUID REFERENCES events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_related_event
  ON events(related_event_id) WHERE related_event_id IS NOT NULL;
