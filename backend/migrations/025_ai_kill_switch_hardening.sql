-- ═══════════════════════════════════════════════════════════════════════════
--  025 — AI kill switch: fail-safe hardening
-- ═══════════════════════════════════════════════════════════════════════════
-- Milestone 2.6. The kill switch stopped being an application feature the
-- moment it became part of incident response, and an incident is exactly when
-- nobody types carefully.
--
-- The previous parser accepted anything that was not the literal string
-- 'false' as ENABLED. So an operator halting AI during a privacy incident by
-- writing 'off', '0', 'no' — or pasting 'false' with a trailing newline out of
-- a runbook heredoc — would have been told nothing was wrong while clinical
-- transcripts kept flowing to the model.
--
-- The application now accepts only 'true' and 'false' exactly, treats anything
-- else as DISABLED, and records an ai_security_event. This migration adds the
-- other half: the database refuses to store a value the application cannot
-- understand, so `UPDATE ... SET value = 'OFF'` fails immediately and visibly
-- instead of appearing to work.
--
-- Two controls, deliberately. The constraint stops the mistake being made; the
-- application's fail-closed parse covers rows that predate the constraint, or
-- a future where somebody drops it.

-- ── 1. A new security event type for an unparseable value ──────────────────
-- Distinct from 'ai_disabled' so an incident review can tell "somebody turned
-- it off" apart from "somebody tried to turn it off and typed something the
-- system could not read". Both may be emitted for the same read: AI genuinely
-- did become disabled, and the reason was a bad value.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_security_events_type_chk'
  ) THEN
    ALTER TABLE ai_security_events DROP CONSTRAINT ai_security_events_type_chk;
  END IF;

  ALTER TABLE ai_security_events
    ADD CONSTRAINT ai_security_events_type_chk
    CHECK (event_type IN (
      'ai_disabled',
      'ai_enabled',
      'invalid_kill_switch_value',
      'policy_changed',
      'model_registry_changed',
      'self_check_failed'
    ));
END $$;

-- ── 2. Normalise any value already stored that the app cannot parse ────────
-- Runs BEFORE the constraint is added, or the migration would fail on exactly
-- the bad data it exists to prevent. Fail-safe direction: an unparseable value
-- becomes 'false'. If that disables AI unexpectedly, that is the correct
-- surprise — it means the switch was never in the state somebody believed.
UPDATE system_settings
   SET value = 'false',
       reason = COALESCE(reason, '') ||
                ' [025: value was not "true"/"false"; set to false, fail-safe]',
       updated_at = NOW()
 WHERE key = 'ai_global_enabled'
   AND value NOT IN ('true', 'false');

-- ── 3. Refuse to store anything else, from now on ──────────────────────────
-- Scoped to the AI switch by key so other settings remain free-form.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'system_settings_ai_global_bool_chk'
  ) THEN
    ALTER TABLE system_settings
      ADD CONSTRAINT system_settings_ai_global_bool_chk
      CHECK (key <> 'ai_global_enabled' OR value IN ('true', 'false'));
  END IF;
END $$;
