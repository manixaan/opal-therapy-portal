'use strict';

// Background invoicing runs (billing/run-jobs.js): no database — the run is faked.
const RJ = require('../billing/run-jobs');

const tick = () => new Promise(r => setImmediate(r));

describe('background runs', () => {
  test('returns at once, reports its stage, then the result', async () => {
    let release;
    const run = (o) => new Promise(res => { o.progress('Checking Splose for what is already invoiced'); release = () => res({ runId: 'r1', summary: { invoicesCreated: 2 } }); });
    const j = RJ.startRun({ pool: {}, orgId: 'org-a', userId: 'u', from: '2026-11-16', to: '2026-11-20', run });
    expect(j.state).toBe('RUNNING');
    await tick();
    expect(RJ.getJob('org-a', j.jobId).stage).toBe('Checking Splose for what is already invoiced');
    release(); await tick(); await tick();
    expect(RJ.getJob('org-a', j.jobId)).toMatchObject({ state: 'DONE', result: { summary: { invoicesCreated: 2 } } });
  });

  test('a second press for the same period joins the running job; another organisation cannot see it', async () => {
    let release;
    const run = () => new Promise(res => { release = () => res({ summary: {} }); });
    const a = RJ.startRun({ pool: {}, orgId: 'org-b', userId: 'u', from: '2026-11-16', to: '2026-11-20', run });
    const b = RJ.startRun({ pool: {}, orgId: 'org-b', userId: 'u', from: '2026-11-16', to: '2026-11-20', run });
    expect(b.jobId).toBe(a.jobId);
    expect(RJ.getJob('org-other', a.jobId)).toBeNull();
    expect(RJ.latestJob('org-b').jobId).toBe(a.jobId);
    await tick(); release(); await tick();
  });

  test('an internal failure is reported without its details; a 4xx keeps its message', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const boom = RJ.startRun({ pool: {}, orgId: 'org-c', userId: 'u', from: '2026-11-01', to: '2026-11-02', run: async () => { throw new Error('relation "x" does not exist'); } });
    const bad = RJ.startRun({ pool: {}, orgId: 'org-c', userId: 'u', from: '2026-11-03', to: '2026-11-04', run: async () => { throw Object.assign(new Error('Choose a valid date range'), { status: 400 }); } });
    await tick(); await tick();
    expect(RJ.getJob('org-c', boom.jobId).error).not.toMatch(/relation/);
    expect(RJ.getJob('org-c', bad.jobId).error).toBe('Choose a valid date range');
    spy.mockRestore();
  });

  test('weeks start on Monday', () => {
    expect(RJ.mondayOf('2026-11-28')).toBe('2026-11-23'); // Saturday
    expect(RJ.mondayOf('2026-11-23')).toBe('2026-11-23');
    expect(RJ.mondayOf('2026-11-29')).toBe('2026-11-23'); // Sunday belongs to the week before
  });
});
