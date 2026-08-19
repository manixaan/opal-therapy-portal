'use strict';

/**
 * ai-audit finalise/markOrphaned — the SQL these write, not the sink.
 *
 * The gateway tests drive the audit layer through its test sink, which is
 * exactly why the defect these pin survived to staging: the sink receives the
 * full sanitised event, but the real UPDATE dropped deny_reason and left
 * review_status untouched. Every guardrail denial in staging read
 * deny_reason NULL and sat in the review queue ('review_required') forever,
 * pointing at output that never existed. These tests run the real query
 * against a scripted pool so the SQL itself is what is asserted.
 */

jest.mock('../database', () => ({
  pool: { query: jest.fn() },
  logAuditEvent: jest.fn().mockResolvedValue(null),
}));

const db = require('../database');
const audit = require('../ai/ai-audit');

/** One simulated ai_interactions row the scripted pool mutates in place. */
let row;

beforeEach(() => {
  row = {
    id: 'aaaaaaaa-1111-4111-8111-000000000001',
    status: 'pending',
    deny_reason: null,
    provider_request_id: null,
    latency_ms: null,
    review_status: 'review_required',
  };
  db.pool.query.mockReset();
  db.pool.query.mockImplementation(async (sql, params) => {
    const q = String(sql).replace(/\s+/g, ' ');
    if (q.includes('UPDATE ai_interactions') && q.includes('deny_reason = COALESCE')) { // finalise
      const [status, denyReason, requestId, latency, producedOutput, id] = params;
      if (id !== row.id) return { rowCount: 0 };
      row.status = status;
      row.deny_reason = denyReason ?? row.deny_reason;
      row.provider_request_id = requestId ?? row.provider_request_id;
      row.latency_ms = latency ?? row.latency_ms;
      if (producedOutput === false && row.review_status === 'review_required') {
        row.review_status = 'ai_generated';
      }
      return { rowCount: 1 };
    }
    if (q.includes("status = 'provider_error'") && q.includes('UPDATE ai_interactions')) { // markOrphaned
      const [id, denyReason] = params;
      if (id !== row.id || row.review_status !== 'review_required') return { rowCount: 0 };
      row.status = 'provider_error';
      row.deny_reason = denyReason;
      row.review_status = 'ai_generated';
      return { rowCount: 1 };
    }
    return { rowCount: 0 };
  });
});

test('a guardrail denial keeps its reason and leaves the review queue', async () => {
  // The staging finding: status became 'denied' but deny_reason stayed NULL
  // and review_status stayed 'review_required' — an entry in "awaiting
  // review" for output that was never produced, with the WHY discarded.
  await audit.finalise(row.id, { status: 'denied', denyReason: 'guardrail_intervened', latencyMs: 812 });
  expect(row.status).toBe('denied');
  expect(row.deny_reason).toBe('guardrail_intervened');
  expect(row.review_status).toBe('ai_generated');
  expect(row.latency_ms).toBe(812);
});

test('a provider error also leaves the review queue', async () => {
  await audit.finalise(row.id, { status: 'provider_error' });
  expect(row.status).toBe('provider_error');
  expect(row.review_status).toBe('ai_generated');
});

test('a successful generation STAYS in the review queue', async () => {
  await audit.finalise(row.id, { status: 'generated', providerRequestId: 'req-1', latencyMs: 950 });
  expect(row.status).toBe('generated');
  expect(row.review_status).toBe('review_required');
  expect(row.provider_request_id).toBe('req-1');
});

test('the guard is on review_required — a reviewed row is never reclassified', async () => {
  // Cannot arise in the normal lifecycle (review happens after finalise), but
  // the UPDATE must not be able to undo a recorded human decision even if a
  // late or duplicate finalise lands.
  row.review_status = 'approved';
  await audit.finalise(row.id, { status: 'denied', denyReason: 'late_duplicate' });
  expect(row.review_status).toBe('approved');
});

test('finalise without a denyReason preserves an existing one', async () => {
  row.deny_reason = 'guardrail_intervened';
  await audit.finalise(row.id, { status: 'denied' });
  expect(row.deny_reason).toBe('guardrail_intervened');
});

test('markOrphaned records the persist failure and exits the queue', async () => {
  row.status = 'generated'; // the model DID generate; the draft write failed
  const changed = await audit.markOrphaned({ interactionId: row.id, reason: 'draft_persist_failed' });
  expect(changed).toBe(true);
  expect(row.status).toBe('provider_error');
  expect(row.deny_reason).toBe('draft_persist_failed');
  expect(row.review_status).toBe('ai_generated');
});

test('markOrphaned refuses to touch a reviewed row', async () => {
  row.review_status = 'rejected';
  const changed = await audit.markOrphaned({ interactionId: row.id, reason: 'draft_persist_failed' });
  expect(changed).toBe(false);
  expect(row.review_status).toBe('rejected');
  expect(row.status).toBe('pending');
});
