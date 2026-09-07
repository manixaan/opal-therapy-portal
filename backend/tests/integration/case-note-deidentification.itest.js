'use strict';

/**
 * Migration 060 — case_note_drafts.deidentification (real Postgres).
 *
 * Pins that the column exists, is nullable for drafts written before 060,
 * and round-trips the names-check record (decisions + token counts) exactly.
 */

const { db, truncateAll, seedUser, closePool } = require('./helpers');

beforeEach(truncateAll);
afterAll(closePool);

async function insertDraft(userId, deidentification) {
  const { rows } = await db.pool.query(
    `INSERT INTO case_note_drafts
       (user_id, linked_event_id, transcript, header, identify, session_details, plan, warnings, note_body,
        style_version, provider_id, model_id, deidentification)
     VALUES ($1, gen_random_uuid(), 'synthetic dictation', '{}'::jsonb, 'a', 'b', '[]'::jsonb, '[]'::jsonb, 'body',
             'OPAL_CASE_NOTE_STYLE_V1', 'mock', 'mock', $2)
     RETURNING *`,
    [userId, deidentification === undefined ? null : JSON.stringify(deidentification)]
  );
  return rows[0];
}

test('060: the column exists and is nullable', async () => {
  const { rows } = await db.pool.query(
    `SELECT is_nullable, data_type FROM information_schema.columns
      WHERE table_name = 'case_note_drafts' AND column_name = 'deidentification'`
  );
  expect(rows).toEqual([{ is_nullable: 'YES', data_type: 'jsonb' }]);
  const u = await seedUser();
  const legacy = await insertDraft(u.id, undefined);
  expect(legacy.deidentification).toBeNull();
});

test('060: the names-check record round-trips, counts only, and survives an update', async () => {
  const u = await seedUser();
  const record = {
    version: 1,
    confirmedNames: ['Tobias'], ignoredWords: ['Recess'],
    tokens: [{ token: 'CLIENT', role: 'client', count: 3 }, { token: 'PERSON', role: 'person', count: 1 }],
    candidateCount: 2,
  };
  const row = await insertDraft(u.id, record);
  expect(row.deidentification).toEqual(record);

  const { rows } = await db.pool.query(
    `UPDATE case_note_drafts SET deidentification = $2 WHERE id = $1 RETURNING deidentification`,
    [row.id, JSON.stringify({ ...record, tokens: [] })]
  );
  expect(rows[0].deidentification.tokens).toEqual([]);
  expect(rows[0].deidentification.confirmedNames).toEqual(['Tobias']);
});
