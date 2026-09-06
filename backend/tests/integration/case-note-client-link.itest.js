'use strict';

/**
 * Migration 059 — case_note_drafts may link to a Splose client instead of an
 * appointment. Real Postgres: proves the column exists, the NOT NULL was
 * lifted, and the "at least one link" constraint holds, so an unlinked
 * clinical note can never be stored.
 */

const { db, truncateAll, seedUser, closePool } = require('./helpers');

const BASE = {
  transcript: 'Practised jumper removal three times.',
  identify: 'Therapist attended to complete a therapy session.',
  session_details: 'The participant needed hands-on help with the left sleeve.',
  note_body: 'Therapy Session\n\nIdentify: …',
  style_version: 'OPAL_CASE_NOTE_STYLE_V1',
  provider_id: 'aws-bedrock',
  model_id: 'test-profile',
};

async function insertDraft(userId, { linkedEventId = null, splosePatientId = null } = {}) {
  const { rows } = await db.pool.query(
    `INSERT INTO case_note_drafts
       (user_id, linked_event_id, splose_patient_id, transcript, header, identify, session_details,
        note_body, style_version, provider_id, model_id, review_status)
     VALUES ($1,$2,$3,$4,'{}'::jsonb,$5,$6,$7,$8,$9,$10,'review_required') RETURNING *`,
    [userId, linkedEventId, splosePatientId, BASE.transcript, BASE.identify, BASE.session_details,
     BASE.note_body, BASE.style_version, BASE.provider_id, BASE.model_id]);
  return rows[0];
}

let user;

beforeEach(async () => {
  await truncateAll();
  user = await seedUser();
});

afterAll(async () => {
  await closePool();
});

describe('migration 059 — client-linked case-note drafts', () => {
  test('a draft can carry a Splose client id with no appointment', async () => {
    const row = await insertDraft(user.id, { splosePatientId: 'pt-abc123' });
    expect(row.linked_event_id).toBeNull();
    expect(row.splose_patient_id).toBe('pt-abc123');
    expect(row.review_status).toBe('review_required');
  });

  test('an appointment-linked draft still works exactly as before', async () => {
    const eventId = '11111111-2222-4333-8444-555555555555';
    const row = await insertDraft(user.id, { linkedEventId: eventId });
    expect(row.linked_event_id).toBe(eventId);
    expect(row.splose_patient_id).toBeNull();
  });

  test('a draft with NEITHER link is refused by the database', async () => {
    await expect(insertDraft(user.id)).rejects.toThrow(/case_note_drafts_link_chk/);
  });

  test('the Case Notes tab query lists both kinds under the same user, and nobody else’s', async () => {
    const other = await seedUser();
    await insertDraft(user.id, { splosePatientId: 'pt-mine' });
    await insertDraft(user.id, { linkedEventId: '11111111-2222-4333-8444-555555555555' });
    await insertDraft(other.id, { splosePatientId: 'pt-theirs' });
    const { rows } = await db.pool.query(
      `SELECT splose_patient_id, linked_event_id FROM case_note_drafts
        WHERE user_id = $1 AND status = 'draft' ORDER BY created_at DESC`, [user.id]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.splose_patient_id)).not.toContain('pt-theirs');
  });
});
