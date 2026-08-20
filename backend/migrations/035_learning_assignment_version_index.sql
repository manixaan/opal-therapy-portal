-- ═══════════════════════════════════════════════════════════════════════════
-- 035 — Index learning_assignments.workflow_version_id
--
-- Additive only. 033 indexed the user/org/workflow access paths but not the
-- version FK, which the owner console reads per version (the assignment_count
-- correlated subquery in GET /api/learning/workflows/:id) and which every
-- FK integrity check on learning_workflow_versions walks. Separate file
-- because 033 is applied (checksummed) — applied migrations are never edited.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_learning_assignments_version
  ON learning_assignments (workflow_version_id);
