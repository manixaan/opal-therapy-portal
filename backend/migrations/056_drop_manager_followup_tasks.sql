-- ═══════════════════════════════════════════════════════════════════════════
-- 056 — Internal set-up is internal set-up
--
-- The first-week check-in and the clinical supervision arrangement were
-- listed as internal set-up tasks. They are the manager's follow-ups after
-- the person starts, not steps the practice completes to get them set up,
-- and they no longer appear on the checklist. Copies already generated on
-- existing records go with them — unless someone has already worked on
-- one, in which case the record keeps what was done.
-- ═══════════════════════════════════════════════════════════════════════════

DELETE FROM onboarding_internal_tasks
 WHERE code IN ('first_week_checkin', 'clinical_supervision')
   AND status = 'pending';
