'use strict';

/**
 * splose-api request queue — one failure must never poison the process.
 *
 * Regression (7 Sep 2026): `_queue = _queue.then(fn)` chained each call on the
 * previous call's OWN promise, so after any rejection `_queue` stayed rejected
 * and every later Splose read in the process failed with the stale error until
 * a restart. The caseload picker showed a permanent HTTP 500 for that reason.
 */

const mockGet = jest.fn();
jest.mock('axios', () => ({ create: jest.fn(() => ({ get: mockGet, post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() })) }));

describe('splose-api throttled queue', () => {
  let api;
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    process.env.SPLOSE_API_KEY = 'test-key';
    api = require('../splose-api');
    api.invalidateCache();
  });

  const page = (items) => ({ data: { data: items, links: { nextPage: null } } });

  test('a rejected request does not fail the requests queued after it', async () => {
    const boom = new Error('socket hang up');
    mockGet
      .mockRejectedValueOnce(boom)                                    // first call: fails
      .mockResolvedValueOnce(page([{ id: 1, firstname: 'A', lastname: 'B' }])); // second call: fine
    await expect(api.getPatients()).rejects.toThrow('socket hang up');
    // Before the fix this rejected with the SAME 'socket hang up' error.
    const patients = await api.getPatients();
    expect(patients.map(p => p.id)).toEqual([1]);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  test('requests still run one after another in order', async () => {
    const order = [];
    mockGet.mockImplementation(async (path) => { order.push(path); return page([{ id: path }]); });
    await Promise.all([api.getServices(), api.getLocations()]);
    expect(order).toEqual(['/services', '/locations']);
  });

  test('fresh:true bypasses the list cache and refreshes it', async () => {
    mockGet.mockResolvedValueOnce(page([{ id: 10, patientId: 1, practitionerId: 1 }]));
    expect((await api.fetchAllCases()).map(c => c.id)).toEqual([10]);
    // Cached: no network call.
    expect((await api.fetchAllCases()).map(c => c.id)).toEqual([10]);
    expect(mockGet).toHaveBeenCalledTimes(1);
    // Fresh: hits Splose again and the new answer becomes the cached copy.
    mockGet.mockResolvedValueOnce(page([{ id: 10 }, { id: 11 }]));
    expect((await api.fetchAllCases({ fresh: true })).map(c => c.id)).toEqual([10, 11]);
    expect((await api.fetchAllCases()).map(c => c.id)).toEqual([10, 11]);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
