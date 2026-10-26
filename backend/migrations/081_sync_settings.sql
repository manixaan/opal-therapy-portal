-- ═══════════════════════════════════════════════════════════════════════════
-- 081 — Sync settings: which way each calendar sync runs, from when, and how
--
-- Five directions, each switchable on its own:
--
--   portal_to_outlook   portal bookings are written to the person's Outlook
--   outlook_to_portal   Outlook changes come into the portal
--   portal_to_splose    portal client bookings are queued for Splose
--   splose_to_portal    Splose appointments come into the portal
--   splose_to_outlook   appointments that came from Splose are mirrored to Outlook
--
-- Two kinds of row in one table:
--
--   scope 'practice'  the Owner's defaults and limits (user_id NULL, one per
--                     direction). `allowed` = may this direction run at all;
--                     `allow_auto` = may it run on its own; `earliest_from` =
--                     nobody may set a sync-from date earlier than this.
--   scope 'user'      one person's choices for their own calendar. A NULL
--                     column means "use the practice default".
--
-- `sync_from` is the cutoff: an event that starts before it is left alone in
-- that direction. NULL = no cutoff. Environment flags (ENABLE_OUTLOOK_WRITE,
-- ENABLE_SPLOSE_WRITE, ...) stay the master switches above all of this.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sync_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope          VARCHAR(10) NOT NULL,
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  direction      VARCHAR(24) NOT NULL,
  enabled        BOOLEAN,
  sync_from      DATE,
  auto           BOOLEAN,
  allowed        BOOLEAN,
  allow_auto     BOOLEAN,
  earliest_from  DATE,
  updated_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sync_settings_scope_chk CHECK (
    (scope = 'practice' AND user_id IS NULL) OR (scope = 'user' AND user_id IS NOT NULL)
  ),
  CONSTRAINT sync_settings_direction_chk CHECK (direction IN (
    'portal_to_outlook', 'outlook_to_portal', 'portal_to_splose', 'splose_to_portal', 'splose_to_outlook'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_settings_practice
  ON sync_settings (direction) WHERE scope = 'practice';
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_settings_user
  ON sync_settings (user_id, direction) WHERE scope = 'user';

COMMENT ON TABLE sync_settings IS
  'Per-direction calendar sync choices: Owner defaults/limits (scope practice) and each person''s own (scope user) (081).';
COMMENT ON COLUMN sync_settings.sync_from IS
  'Events starting before this date are left alone in this direction. NULL = no cutoff (081).';
