-- ═══════════════════════════════════════════════════════════════════════════
--  008 — Snapshot Day: personal reminders + daily task list
-- ═══════════════════════════════════════════════════════════════════════════
-- Personal productivity data. Strictly user-scoped in snapshot-routes.js:
-- every read and write filters on user_id, and NO role — owner included —
-- can see another user's rows. linked_event_id is a soft reference (no FK)
-- so a reminder survives its linked calendar event. No external calls.

CREATE TABLE IF NOT EXISTS snapshot_reminders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id UUID REFERENCES organisations(id),
  title           VARCHAR(300) NOT NULL,
  note            TEXT,
  due_at          TIMESTAMPTZ NOT NULL,
  priority        VARCHAR(10) DEFAULT 'normal',
    CONSTRAINT valid_reminder_priority CHECK (priority IN ('low','normal','high')),
  state           VARCHAR(20) NOT NULL DEFAULT 'upcoming',
    CONSTRAINT valid_reminder_state CHECK (state IN ('upcoming','completed','dismissed')),
  linked_event_id UUID,
  linked_kind     VARCHAR(30),
  completed_at    TIMESTAMPTZ,
  dismissed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_snapshot_reminders_user_due
  ON snapshot_reminders (user_id, due_at);

CREATE TABLE IF NOT EXISTS snapshot_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id UUID REFERENCES organisations(id),
  title           VARCHAR(300) NOT NULL,
  note            TEXT,
  due_time        TIMESTAMPTZ,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  completed       BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_snapshot_tasks_user_order
  ON snapshot_tasks (user_id, completed, sort_order);
