'use strict';

/**
 * event-move.js — the shared save-and-pass-on road for a calendar edit
 * (portal drag and phone move). Dependencies are injected; nothing real runs.
 */

const { moveEvent } = require('../event-move');

function makeDeps(over = {}) {
  const calls = [];
  const deps = {
    calls,
    db: {
      updateEvent: jest.fn(async (id, f) => { calls.push(['updateEvent', id, f]); return {}; }),
      getUser: jest.fn(async () => ({ id: 'u1', access_token: 't' })),
      pool: { query: jest.fn(async (sql) => {
        calls.push(['sql', String(sql).replace(/\s+/g, ' ').slice(0, 40)]);
        if (/FROM events e WHERE e.id/.test(sql)) return { rows: [{ splose_id: 'sp1', start_time: '2027-03-02T01:00:00.000Z', end_time: '2027-03-02T02:00:00.000Z', user_id: 'u1', live: '0' }] };
        return { rows: [] };
      }) },
    },
    outlookApi: { updateOutlookEvent: jest.fn(async () => { calls.push(['graph']); }) },
    draftSync: { enqueueChange: jest.fn(async () => ({ id: 'q1' })) },
    flags: { isOutlookWriteEnabled: () => true, isSploseDraftSyncEnabled: () => true },
    syncPrefs: { effectiveOrNull: async () => null, allowsLinked: () => true },
    getValidAccessToken: async () => 'token',
    notifyQueued: jest.fn(),
    storeNotification: jest.fn(async () => {}),
    ...over,
  };
  return deps;
}

const FIELDS = { startTime: '2027-03-02T10:00:00+08:00', endTime: '2027-03-02T11:00:00+08:00' };

test('local write first, then Splose queue, then Outlook — the portal’s order', async () => {
  const deps = makeDeps();
  const r = await moveEvent({ userId: 'u1', dbId: 'e1', outlookId: 'ol1', fields: FIELDS }, deps);
  expect(r).toEqual({ ok: true, outlookId: 'ol1', savedToDb: true, savedToOutlook: true, outlookStatus: 'saved', splose: 'queued' });
  const order = deps.calls.map((c) => c[0]);
  expect(order.indexOf('updateEvent')).toBeLessThan(order.indexOf('graph'));
  expect(deps.db.updateEvent.mock.calls[0][1]).toMatchObject({ lastModifiedBy: 'app', syncStatus: undefined, ...FIELDS });
  expect(deps.draftSync.enqueueChange).toHaveBeenCalledWith(deps.db, expect.objectContaining({
    eventId: 'e1', action: 'update', payload: expect.objectContaining({ start: '2027-03-02T01:00:00.000Z' }) }));
  expect(deps.notifyQueued).toHaveBeenCalledWith('u1');
});

test('write-back off: the Outlook-linked row is held pending in the same write, Graph never called', async () => {
  const deps = makeDeps({ flags: { isOutlookWriteEnabled: () => false, isSploseDraftSyncEnabled: () => false } });
  const r = await moveEvent({ userId: 'u1', dbId: 'e1', outlookId: 'ol1', fields: FIELDS }, deps);
  expect(r).toMatchObject({ savedToOutlook: false, outlookStatus: 'disabled', splose: 'off' });
  expect(deps.db.updateEvent.mock.calls[0][1].syncStatus).toBe('pending');
  expect(deps.outlookApi.updateOutlookEvent).not.toHaveBeenCalled();
});

test('portal-only event: not_linked, no pending flag', async () => {
  const deps = makeDeps();
  const r = await moveEvent({ userId: 'u1', dbId: 'e1', outlookId: null, fields: FIELDS }, deps);
  expect(r).toMatchObject({ outlookId: null, outlookStatus: 'not_linked' });
  expect(deps.db.updateEvent.mock.calls[0][1].syncStatus).toBeUndefined();
});

test('a Graph failure keeps the local change, marks it pending, logs and notifies — never throws', async () => {
  const deps = makeDeps({ outlookApi: { updateOutlookEvent: jest.fn(async () => { throw new Error('Graph 503'); }) } });
  const r = await moveEvent({ userId: 'u1', dbId: 'e1', outlookId: 'ol1', fields: FIELDS }, deps);
  expect(r).toMatchObject({ ok: true, savedToDb: true, savedToOutlook: false, outlookStatus: 'failed', syncError: 'Graph 503' });
  expect(deps.db.updateEvent).toHaveBeenCalledWith('e1', { syncStatus: 'pending' });
  expect(deps.storeNotification).toHaveBeenCalledWith('u1', expect.objectContaining({ type: 'outlook_writeback_failed' }));
});

test('writeLocal:false (the phone wrote its rows in a transaction) skips only the local write', async () => {
  const deps = makeDeps();
  await moveEvent({ userId: 'u1', dbId: 'e1', outlookId: 'ol1', fields: FIELDS, writeLocal: false }, deps);
  expect(deps.db.updateEvent).not.toHaveBeenCalledWith('e1', expect.objectContaining({ lastModifiedBy: 'app' }));
  expect(deps.outlookApi.updateOutlookEvent).toHaveBeenCalled();
  expect(deps.draftSync.enqueueChange).toHaveBeenCalled();
});

test('the user’s sync settings can hold Splose and Outlook back', async () => {
  const deps = makeDeps({ syncPrefs: { effectiveOrNull: async () => ({}), allowsLinked: () => false } });
  const r = await moveEvent({ userId: 'u1', dbId: 'e1', outlookId: 'ol1', fields: FIELDS }, deps);
  expect(r).toMatchObject({ outlookStatus: 'disabled', splose: 'off' });
  expect(deps.draftSync.enqueueChange).not.toHaveBeenCalled();
});

test('a title-only edit never touches the Splose queue', async () => {
  const deps = makeDeps();
  const r = await moveEvent({ userId: 'u1', dbId: 'e1', outlookId: null, fields: { title: 'New' } }, deps);
  expect(r.splose).toBe('off');
  expect(deps.draftSync.enqueueChange).not.toHaveBeenCalled();
});
