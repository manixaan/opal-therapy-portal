'use strict';

/**
 * Behavioural tests for the extracted Splose cancellation poller — the full
 * failure matrix required before enabling live delete synchronisation:
 * empty response, timeout, 429, auth failure, partial pagination, abnormal
 * drop, legitimate cancellation, and safe retry after an unhealthy cycle.
 */

const { createSplosePoller } = require('../splose-poller');

/** In-memory fake of the pieces of `db` the poller touches. */
function makeFakeDb(localRows) {
  const deleted = [];
  const audits = [];
  return {
    deleted, audits,
    pool: {
      query: async (sql, params) => {
        if (/SELECT id, splose_id/.test(sql)) return { rows: localRows.filter(r => !deleted.includes(r.id)) };
        if (/UPDATE events/.test(sql)) { deleted.push(params[0]); return { rowCount: 1 }; }
        if (/SELECT access_token/.test(sql)) return { rows: [{ access_token: 't', refresh_token: 'r', token_expires_at: new Date(Date.now() + 3600e3) }] };
        if (/SELECT id FROM users WHERE role = 'owner'/.test(sql)) return { rows: [{ id: 'owner-1' }] };
        return { rows: [] };
      },
    },
    logAuditEvent: async (rec) => audits.push(rec),
  };
}

function withMeta(arr, complete = true) {
  Object.defineProperty(arr, '_fetchComplete', { value: complete, enumerable: false });
  return arr;
}

const appt = (id, cancelled = false) => ({
  id, patients: [{ patientId: 1, status: cancelled ? 'Cancelled' : 'Booked' }],
});
const localEvent = (n) => ({ id: `db-${n}`, splose_id: String(n), title: `E${n}`, outlook_id: `OL-${n}`, user_id: 'u1' });

function makePoller({ localRows, appointmentsImpl }) {
  const db = makeFakeDb(localRows);
  const outlookDeletes = [];
  const notifications = [];
  const poller = createSplosePoller({
    db,
    sploseApi: { getAppointments: appointmentsImpl },
    outlookApi: { deleteOutlookEvent: async (t, id) => outlookDeletes.push(id) },
    io: null,
    getValidTokenForUser: async () => 'token',
    storeNotification: async (userId, payload) => notifications.push({ userId, payload }),
  });
  return { poller, db, outlookDeletes, notifications };
}

const TEN_LOCAL = Array.from({ length: 10 }, (_, i) => localEvent(i + 1));

describe('Splose poller data-loss protection', () => {
  test('EMPTY successful response deletes nothing, audits, notifies', async () => {
    const { poller, db, outlookDeletes, notifications } = makePoller({
      localRows: TEN_LOCAL,
      appointmentsImpl: async () => withMeta([]),
    });
    const result = await poller.runSploseSync();
    expect(result).toMatchObject({ blocked: true, reason: 'empty_remote_result', cancelled: 0 });
    expect(db.deleted).toHaveLength(0);
    expect(outlookDeletes).toHaveLength(0);
    expect(db.audits.some(a => a.action === 'sync.safety_block')).toBe(true);
    expect(notifications.length).toBeGreaterThan(0);
  });

  test('API timeout: nothing deleted, cycle reports fetch_failed', async () => {
    const { poller, db } = makePoller({
      localRows: TEN_LOCAL,
      appointmentsImpl: async () => { const e = new Error('timeout of 15000ms exceeded'); e.code = 'ECONNABORTED'; throw e; },
    });
    const result = await poller.runSploseSync();
    expect(result).toMatchObject({ blocked: true, reason: 'fetch_failed' });
    expect(db.deleted).toHaveLength(0);
  });

  test('HTTP 429: nothing deleted', async () => {
    const { poller, db } = makePoller({
      localRows: TEN_LOCAL,
      appointmentsImpl: async () => { const e = new Error('Request failed with status code 429'); e.response = { status: 429 }; throw e; },
    });
    const result = await poller.runSploseSync();
    expect(result.blocked).toBe(true);
    expect(db.deleted).toHaveLength(0);
  });

  test('auth failure (401): nothing deleted', async () => {
    const { poller, db } = makePoller({
      localRows: TEN_LOCAL,
      appointmentsImpl: async () => { const e = new Error('Request failed with status code 401'); e.response = { status: 401 }; throw e; },
    });
    const result = await poller.runSploseSync();
    expect(result.blocked).toBe(true);
    expect(db.deleted).toHaveLength(0);
  });

  test('PARTIAL pagination (truncated list) blocks all deletions', async () => {
    // Upstream "lost" events 6-10 because pagination truncated
    const { poller, db } = makePoller({
      localRows: TEN_LOCAL,
      appointmentsImpl: async () => withMeta([appt('1'), appt('2'), appt('3'), appt('4'), appt('5')], /*complete*/ false),
    });
    const result = await poller.runSploseSync();
    expect(result).toMatchObject({ blocked: true, reason: 'incomplete_fetch' });
    expect(db.deleted).toHaveLength(0);
  });

  test('LARGE unexpected record reduction blocks (percentage threshold)', async () => {
    // Complete fetch but half the linked events vanished — 50% > 30%
    const { poller, db } = makePoller({
      localRows: TEN_LOCAL,
      appointmentsImpl: async () => withMeta([appt('1'), appt('2'), appt('3'), appt('4'), appt('5')]),
    });
    const result = await poller.runSploseSync();
    expect(result).toMatchObject({ blocked: true, reason: 'exceeds_delete_percentage' });
    expect(db.deleted).toHaveLength(0);
  });

  test('NORMAL legitimate cancellation proceeds and cascades to Outlook', async () => {
    // 9 live + #10 fully cancelled = 1 candidate of 10 (10% < 30%, ≤25 absolute)
    const appts = TEN_LOCAL.slice(0, 9).map(r => appt(r.splose_id));
    appts.push(appt('10', /*cancelled*/ true));
    const { poller, db, outlookDeletes } = makePoller({
      localRows: TEN_LOCAL,
      appointmentsImpl: async () => withMeta(appts),
    });
    const result = await poller.runSploseSync();
    expect(result).toMatchObject({ blocked: false, cancelled: 1 });
    expect(db.deleted).toEqual(['db-10']);
    expect(outlookDeletes).toEqual(['OL-10']);
  });

  test('SAFE RETRY: blocked empty cycle, then healthy cycle applies the real change', async () => {
    let call = 0;
    const healthy = TEN_LOCAL.slice(0, 9).map(r => appt(r.splose_id)); // #10 genuinely gone
    const { poller, db } = makePoller({
      localRows: TEN_LOCAL,
      appointmentsImpl: async () => (++call === 1 ? withMeta([]) : withMeta(healthy)),
    });

    const first = await poller.runSploseSync();
    expect(first.blocked).toBe(true);
    expect(db.deleted).toHaveLength(0);

    const second = await poller.runSploseSync();
    expect(second).toMatchObject({ blocked: false, cancelled: 1 });
    expect(db.deleted).toEqual(['db-10']);
  });

  test('overlapping runs are skipped, not doubled', async () => {
    let resolveFetch;
    const { poller } = makePoller({
      localRows: [],
      appointmentsImpl: () => new Promise(r => { resolveFetch = () => r(withMeta([])); }),
    });
    const p1 = poller.runSploseSync();
    const p2 = await poller.runSploseSync();
    expect(p2).toMatchObject({ skipped: true, reason: 'already_running' });
    resolveFetch();
    await p1;
  });
});
