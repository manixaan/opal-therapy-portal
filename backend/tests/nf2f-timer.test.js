'use strict';

/** Non-face-to-face timer + allocation (billing/nf2f-timer.js, 11 Oct 2026). */
const T = require('../billing/nf2f-timer');

const t0 = new Date('2026-10-12T01:00:00Z');
const at = (sec) => new Date(t0.getTime() + sec * 1000);
const running = (acc = 0, limit = 3600) => ({ event_id: 'e', status: 'RUNNING', run_started_at: t0, accumulated_seconds: acc, limit_seconds: limit });
const five = ['1', '2', '3', '4', '5'].map((id) => ({ clientId: id, clientName: 'C' + id }));

describe('the timer', () => {
  test('counts while running, adds to what was timed before, never past the block length', () => {
    expect(T.elapsedSeconds(running(), at(600))).toBe(600);
    expect(T.elapsedSeconds(running(900), at(600))).toBe(1500);
    expect(T.elapsedSeconds(running(3000), at(1200))).toBe(3600);
    expect(T.elapsedSeconds({ status: 'STOPPED', accumulated_seconds: 1234, limit_seconds: 3600 })).toBe(1234);
  });
  test('a forgotten timer stops itself at the block length, at the moment it got there', () => {
    expect(T.settled(running(), at(3599)).status).toBe('RUNNING');
    const s = T.settled(running(600), at(7200));
    expect(s).toMatchObject({ status: 'STOPPED', accumulated_seconds: 3600, auto_stopped: true, run_started_at: null });
    expect(s.stopped_at.toISOString()).toBe(at(3000).toISOString());
  });
});

describe('allocation', () => {
  test('equal by default: 5 clients → 20% each', () => {
    expect(T.allocationFor(null, five).clients.map((c) => c.percent)).toEqual([20, 20, 20, 20, 20]);
    expect(T.allocationFor(null, five.slice(0, 3)).clients.map((c) => c.percent)).toEqual([33.34, 33.33, 33.33]);
  });
  test('a saved allocation is used only while it covers exactly the block\'s clients', () => {
    const row = { allocation: [{ clientId: '1', percent: 40 }, { clientId: '2', percent: 60 }], non_billable_percent: 0 };
    expect(T.allocationFor(row, five.slice(0, 2)).clients.map((c) => c.percent)).toEqual([40, 60]);
    expect(T.allocationFor(row, five.slice(0, 3)).clients.map((c) => c.percent)).toEqual([33.34, 33.33, 33.33]);
  });
  test('validation: exactly the block\'s clients, adding up to 100 with the non-billable share', () => {
    const ok = T.validateAllocation({ allocation: [{ clientId: '1', percent: 40 }, { clientId: '2', percent: 50 }], nonBillablePercent: 10 }, five.slice(0, 2));
    expect(ok).toMatchObject({ ok: true, nonBillablePercent: 10 });
    expect(T.validateAllocation({ allocation: [{ clientId: '1', percent: 40 }, { clientId: '2', percent: 50 }] }, five.slice(0, 2)).error).toMatch(/90%, not 100%/);
    expect(T.validateAllocation({ allocation: [{ clientId: '1', percent: 100 }] }, five.slice(0, 2)).error).toMatch(/exactly this block/);
    expect(T.validateAllocation({ allocation: [{ clientId: '1', percent: 120 }, { clientId: '2', percent: -20 }] }, five.slice(0, 2)).error).toMatch(/0–100/);
  });
  test('seconds split to the second, adding up to the billable part', () => {
    const parts = T.splitSeconds(3600, { nonBillablePercent: 0, clients: T.equalSplit(five.slice(0, 3), 100) });
    expect(parts.reduce((s, p) => s + p.seconds, 0)).toBe(3600);
    const nb = T.splitSeconds(3000, { nonBillablePercent: 20, clients: [{ clientId: '1', percent: 40 }, { clientId: '2', percent: 40 }] });
    expect(nb.map((p) => p.seconds)).toEqual([1200, 1200]);
  });
});

test('a block\'s clients come from its booking; other groups have none', () => {
  expect(T.blockClients({ custom_metadata: { booking: { group: 'nf2f', clients: [{ clientId: 7, clientName: 'Al' }] } } })).toEqual([{ clientId: '7', clientName: 'Al' }]);
  expect(T.blockClients({ custom_metadata: { booking: { group: 'nf2f', clientId: '9', clientName: 'Bo' } } })).toEqual([{ clientId: '9', clientName: 'Bo' }]);
  expect(T.blockClients({ custom_metadata: { booking: { group: 'nf2f', clientId: null } } })).toEqual([]);
  expect(T.blockClients({ custom_metadata: { booking: { group: 'report', clientId: '1' } } })).toEqual([]);
});

describe('a block that ended with no time entered (migration 089)', () => {
  const two = [{ clientId: '1', clientName: 'Al' }, { clientId: '2', clientName: 'Bo' }];
  const past = new Date('2026-11-17T03:00:00Z'), now = new Date('2026-11-21T00:00:00Z');
  test('needs an answer only once ended, billable, untimed and unresolved', () => {
    expect(T.needsResolution(null, two, past, now)).toBe(true);
    expect(T.needsResolution({ status: 'IDLE', accumulated_seconds: 0 }, two, past, now)).toBe(true);
    expect(T.needsResolution(null, [], past, now)).toBe(false);                        // no clients = not billable
    expect(T.needsResolution(null, two, new Date('2026-11-22T00:00:00Z'), now)).toBe(false); // not over
    expect(T.needsResolution({ status: 'STOPPED', accumulated_seconds: 600 }, two, past, now)).toBe(false);
    expect(T.needsResolution({ status: 'RUNNING', accumulated_seconds: 0 }, two, past, now)).toBe(false);
    expect(T.needsResolution({ status: 'STOPPED', accumulated_seconds: 0, resolution: 'DID_NOT_HAPPEN' }, two, past, now)).toBe(false);
  });
  test('full block: the whole block, split evenly, to the second', () => {
    const v = T.validateResolution({ mode: 'FULL_BLOCK' }, two, 1800);
    expect(v).toMatchObject({ ok: true, resolution: 'FULL_BLOCK', seconds: 1800 });
    const parts = T.clientParts({ resolution: 'FULL_BLOCK', allocation: v.allocation, non_billable_percent: 0 }, two, 1800);
    expect(parts.map((p) => p.seconds)).toEqual([900, 900]);
  });
  test('per client: exactly the minutes entered, never longer than the block', () => {
    const v = T.validateResolution({ mode: 'PER_CLIENT', minutes: [{ clientId: '1', minutes: 10 }, { clientId: '2', minutes: 7 }] }, two, 1800);
    expect(v).toMatchObject({ ok: true, seconds: 1020 });
    const parts = T.clientParts({ resolution: 'PER_CLIENT', client_seconds: v.clientSeconds, allocation: v.allocation }, two, 1020);
    expect(parts.map((p) => p.seconds)).toEqual([600, 420]);
    expect(T.validateResolution({ mode: 'PER_CLIENT', minutes: [{ clientId: '1', minutes: 20 }, { clientId: '2', minutes: 11 }] }, two, 1800).error).toMatch(/longer than the 30-minute block/);
    expect(T.validateResolution({ mode: 'PER_CLIENT', minutes: [{ clientId: '1', minutes: 0 }, { clientId: '2', minutes: 0 }] }, two, 1800).ok).toBe(false);
    expect(T.validateResolution({ mode: 'PER_CLIENT', minutes: [{ clientId: '1', minutes: 2.5 }, { clientId: '2', minutes: 1 }] }, two, 1800).ok).toBe(false);
    expect(T.validateResolution({ mode: 'PER_CLIENT', minutes: [{ clientId: '1', minutes: 5 }] }, two, 1800).ok).toBe(false);
  });
  test('did not happen: needs a reason, bills nothing', () => {
    expect(T.validateResolution({ mode: 'DID_NOT_HAPPEN' }, two, 1800).ok).toBe(false);
    expect(T.validateResolution({ mode: 'DID_NOT_HAPPEN', reason: 'Client cancelled the report' }, two, 1800)).toMatchObject({ ok: true, seconds: 0 });
    expect(T.clientParts({ resolution: 'DID_NOT_HAPPEN' }, two, 0)).toEqual([]);
    expect(T.validateResolution({ mode: 'nope' }, two, 1800).ok).toBe(false);
  });
});
