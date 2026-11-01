'use strict';

/**
 * Editing an APPROVED case note voids its approval — against real Postgres.
 *
 * The unit suite proves the route logic with a mocked pool; this proves the
 * SQL itself holds under the real constraints: the draft goes back to
 * review_required with the reviewer cleared (case_note_drafts_reviewer_chk),
 * and the linked AI interaction is reopened the same way
 * (ai_interactions_reviewer_chk), scoped to its owner.
 */

const { db, truncateAll, seedUser, closePool } = require('./helpers');
const aiAudit = require('../../ai/ai-audit');

let user;

async function approvedInteraction(userId) {
  const { rows } = await db.pool.query(
    `INSERT INTO ai_interactions (user_id, feature, classification, review_status, reviewed_by, reviewed_at)
     VALUES ($1, 'case_note_generation', 'clinical', 'approved', $1, NOW()) RETURNING id`, [userId]);
  return rows[0].id;
}

async function approvedDraft(userId, interactionId) {
  const { rows } = await db.pool.query(
    `INSERT INTO case_note_drafts
       (user_id, splose_patient_id, transcript, header, identify, session_details, note_body,
        style_version, provider_id, model_id, ai_interaction_id, review_status, reviewed_by, reviewed_at)
     VALUES ($1, 'pt-1', 't', '{}'::jsonb, 'i', 's', 'Original approved wording.',
        'OPAL_CASE_NOTE_STYLE_V1', 'aws-bedrock', 'test-profile', $2, 'approved', $1, NOW())
     RETURNING *`, [userId, interactionId]);
  return rows[0];
}

beforeEach(async () => {
  await truncateAll();
  user = await seedUser();
});

afterAll(async () => {
  await closePool();
});

describe('voiding an approval when an approved note is edited', () => {
  test('the draft returns to review with the reviewer cleared — the database accepts it', async () => {
    const interactionId = await approvedInteraction(user.id);
    const draft = await approvedDraft(user.id, interactionId);
    // The exact statement shape the PATCH route builds when it voids an approval.
    const { rows } = await db.pool.query(
      `UPDATE case_note_drafts SET note_body = $3, review_status = 'review_required', reviewed_by = NULL, reviewed_at = NULL, updated_at = NOW()
        WHERE id = $1 AND user_id = $2 RETURNING *`, [draft.id, user.id, 'Corrected after approval.']);
    expect(rows[0]).toMatchObject({ review_status: 'review_required', reviewed_by: null, reviewed_at: null });
  });

  test('reopenReview puts the AI interaction back to review_required', async () => {
    const interactionId = await approvedInteraction(user.id);
    expect(await aiAudit.reopenReview({ interactionId, userId: user.id })).toBe(true);
    const { rows } = await db.pool.query('SELECT review_status, reviewed_by, reviewed_at FROM ai_interactions WHERE id = $1', [interactionId]);
    expect(rows[0]).toEqual({ review_status: 'review_required', reviewed_by: null, reviewed_at: null });
  });

  test('reopenReview cannot touch another therapist\'s interaction', async () => {
    const other = await seedUser();
    const interactionId = await approvedInteraction(other.id);
    expect(await aiAudit.reopenReview({ interactionId, userId: user.id })).toBe(false);
    const { rows } = await db.pool.query('SELECT review_status FROM ai_interactions WHERE id = $1', [interactionId]);
    expect(rows[0].review_status).toBe('approved');
  });

  test('a fresh approval after the edit is accepted again', async () => {
    const interactionId = await approvedInteraction(user.id);
    await aiAudit.reopenReview({ interactionId, userId: user.id });
    expect(await aiAudit.markReviewed({ interactionId, reviewedBy: user.id, decision: 'approved' })).toBe(true);
    const { rows } = await db.pool.query('SELECT review_status FROM ai_interactions WHERE id = $1', [interactionId]);
    expect(rows[0].review_status).toBe('approved');
  });
});
