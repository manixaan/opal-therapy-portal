-- ═══════════════════════════════════════════════════════════════════════════
-- 036 — Interview Preparation: structured recruitment interview records
--
-- Additive only. One table. No existing table is touched, and the Owner's
-- delegation of the capability rides on the users.permissions column that
-- 034's onboarding delegation already established — no schema change is
-- needed to grant or revoke Interview Preparation access.
--
-- ── What this is, and what it is deliberately NOT ─────────────────────────
-- An interview record is EMPLOYMENT/RECRUITMENT information about a
-- prospective employee. It is not clinical data and it is not a participant
-- record. Nothing here references contacts, participants or any clinical
-- table, and the candidate's identity lives on this row alone: a job
-- applicant must never acquire a row in the practice's clinical database
-- because somebody interviewed them.
--
-- ── Why the template is snapshotted rather than referenced ────────────────
-- `template_schema` freezes the ENTIRE interview template — every section,
-- question, option, rating row and piece of guidance — at the moment the
-- record is created. Interview templates are authored content held in code
-- (backend/interview-templates.js), so a later edit to the file must never
-- re-label a stored answer, silently re-word a question a candidate was
-- actually asked, or change what a PDF regenerated from an old record says.
-- This is the same pinning guarantee learning_assignments gets from
-- workflow_version_id, expressed as a snapshot because the source of truth
-- is a reviewed file rather than a row. `template_key` and
-- `template_version` are kept alongside it for listing and reporting only —
-- rendering always uses the snapshot.
--
-- ── Why responses are JSONB and ratings are separate ──────────────────────
-- The answers are a sparse map of questionKey → answer whose shape is
-- defined by the snapshot sitting in the same row, so a column per question
-- would be ~40 columns that a second template would immediately invalidate.
-- Ratings are lifted out of that blob because they are the one part of an
-- interview that is scored, compared and reported on across candidates, and
-- a reviewer should not have to reach into a free-text document to find
-- them. `recommendation` is a first-class column for the same reason: it is
-- the operational outcome of the record.
--
-- responses shape (see backend/interview-templates.js for the grammar):
--   { "<questionKey>": "free text"                       -- text|date|longtext
--   , "<questionKey>": ["optionKey", …]                  -- checkboxes
--   , "<questionKey>": { "option": "key", "detail": "" } -- choice
--   }
-- ratings shape:
--   { "clinical_reasoning": 4, "communication": 3, … }   -- values 1..5
--
-- ── Status lifecycle ──────────────────────────────────────────────────────
--   draft        created, nothing saved into it yet
--   in_progress  at least one answer has been saved
--   completed    the interviewer marked it finished (completed_at set)
--   archived     retired from the working list; still fully readable
-- Completion does not lock the record. If it is edited afterwards,
-- `reopened_at` records when and `post_completion_edits` counts how often,
-- so a reader can always tell that the document changed after it was
-- declared final (audit_logs carries the who/when detail).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS interview_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID REFERENCES organisations(id),

  -- Template identity + the frozen copy everything is rendered from.
  template_key          VARCHAR(80)  NOT NULL,
  template_version      INTEGER      NOT NULL DEFAULT 1 CHECK (template_version >= 1),
  template_schema       JSONB        NOT NULL,

  -- The applicant. Their own identity — never a contacts/participants row.
  candidate_name        VARCHAR(200) NOT NULL,
  position              VARCHAR(200),
  interview_date        DATE,
  interviewers          VARCHAR(300),

  status                VARCHAR(20)  NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'in_progress', 'completed', 'archived')),

  responses             JSONB        NOT NULL DEFAULT '{}'::jsonb,
  ratings               JSONB        NOT NULL DEFAULT '{}'::jsonb,
  -- One of the snapshot's recommendation option keys, or NULL while undecided.
  recommendation        VARCHAR(60),

  created_by            UUID REFERENCES users(id),
  updated_by            UUID REFERENCES users(id),
  completed_by          UUID REFERENCES users(id),

  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  reopened_at           TIMESTAMPTZ,
  archived_at           TIMESTAMPTZ,
  post_completion_edits INTEGER      NOT NULL DEFAULT 0 CHECK (post_completion_edits >= 0)
);

-- The working list: an organisation's records, newest first, filtered by
-- status. Matches the landing page's default query exactly.
CREATE INDEX IF NOT EXISTS idx_interview_records_org
  ON interview_records (organisation_id, status, updated_at DESC);

-- "Interviews I conducted" — the authorised-admin view, and the join the
-- Owner's per-interviewer filter uses.
CREATE INDEX IF NOT EXISTS idx_interview_records_created_by
  ON interview_records (created_by, updated_at DESC);

-- Candidate search. Case-insensitive prefix/substring matching over a small
-- table; a trigram index would need an extension this deployment does not
-- install, and recruitment volumes here are in the hundreds, not millions.
CREATE INDEX IF NOT EXISTS idx_interview_records_candidate
  ON interview_records (organisation_id, LOWER(candidate_name));
