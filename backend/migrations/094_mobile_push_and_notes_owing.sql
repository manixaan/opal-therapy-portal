-- 094 — Opa mobile: push devices, push de-duplication, notes owing (25 Nov 2026).
--
-- mobile_push_devices   one row per iPhone that allowed notifications. The
--                       token is Apple's device token (APNs, sent directly —
--                       no third-party push service). A token Apple reports as
--                       gone is disabled, never reused. Sign-out deletes it.
-- mobile_push_sent      one row per notification sent, keyed so a job that
--                       runs every few minutes (or on two instances) sends a
--                       given reminder once. Holds ids and a kind only —
--                       never the notification text.
-- case_note_owed_dismissals
--                       a session the therapist says is noted elsewhere
--                       (written straight into Splose), so "Notes owing"
--                       stops listing it. Ids only.

CREATE TABLE IF NOT EXISTS mobile_push_devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token           VARCHAR(200) NOT NULL UNIQUE,
  environment     VARCHAR(12) NOT NULL DEFAULT 'production'
                    CHECK (environment IN ('sandbox', 'production')),
  app_version     VARCHAR(40),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_at     TIMESTAMPTZ,
  disabled_reason VARCHAR(40)
);
CREATE INDEX IF NOT EXISTS idx_mobile_push_devices_user
  ON mobile_push_devices (user_id) WHERE disabled_at IS NULL;

CREATE TABLE IF NOT EXISTS mobile_push_sent (
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     VARCHAR(40) NOT NULL,
  ref      VARCHAR(120) NOT NULL,
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_mobile_push_sent_at ON mobile_push_sent (sent_at);

CREATE TABLE IF NOT EXISTS case_note_owed_dismissals (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id    UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, event_id)
);
