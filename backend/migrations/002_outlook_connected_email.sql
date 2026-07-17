-- ═══════════════════════════════════════════════════════════════════════════
--  002 — record which mailbox address an Outlook connection belongs to
-- ═══════════════════════════════════════════════════════════════════════════
-- The portal account email and the connected Microsoft mailbox may
-- legitimately differ (shared/admin mailboxes). This column stores the
-- connected mailbox ADDRESS ONLY — token material stays encrypted in the
-- existing token columns — so Settings → Integrations can show which
-- calendar is linked, and support can verify a connection without touching
-- tokens.
ALTER TABLE users ADD COLUMN IF NOT EXISTS outlook_connected_email VARCHAR(255);
