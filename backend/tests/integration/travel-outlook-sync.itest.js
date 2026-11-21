'use strict';

/**
 * Travel → Outlook mirror against a real database (migration 073). Outlook is
 * a recording stub. Proves: one Outlook event per leg, re-sync is a no-op,
 * moves update in place, dropped legs are deleted, two syncs racing never make
 * a second event, and a stale or foreign view is refused without deleting.
 */

const { db, truncateAll, seedUser, closePool } = require('./helpers');
const sync = require('../../travel-outlook-sync');

const DATE = '2030-03-04';
const NOW = new Date('2030-03-03T00:00:00Z');
let user, other, appts;

function stubOutlook() {
  let n = 0;
  const calls = { create: [], update: [], remove: [] };
  return {
    calls,
    createOutlookEvent: async (tok, e) => { calls.create.push(e); return { outlookId: 'out-' + (++n) }; },
    updateOutlookEvent: async (tok, id, e) => { calls.update.push([id, e]); return {}; },
    deleteOutlookEvent: async (tok, id) => { calls.remove.push(id); return { deleted: true }; },
  };
}
const deps = (outlook) => ({ pool: db.pool, outlook, getAccessToken: async () => 'tok' });
async function appt(u, startIso, endIso, title = 'Client Appointment') {
  const { rows } = await db.pool.query(
    `INSERT INTO events (user_id, title, start_time, end_time, event_type, location) VALUES ($1,$2,$3,$4,'therapy','1 Example St, Osborne Park') RETURNING id`,
    [u.id, title, startIso, endIso]);
  return rows[0].id;
}
const leg = (owner, side, s, e, title = 'Travel · 20 min · Osborne Park → Joondalup') =>
  ({ key: owner + '|' + side, start: `${DATE}T${s}:00+08:00`, end: `${DATE}T${e}:00+08:00`, title, location: 'Joondalup' });
const mirrors = async () => (await db.pool.query(
  `SELECT custom_metadata->>'travelLegKey' AS key, outlook_id, event_type, related_event_id, is_deleted FROM events WHERE custom_metadata ? 'travelLegKey' ORDER BY created_at`)).rows;

beforeEach(async () => {
  await truncateAll();
  user = await seedUser({ role: 'therapist' });
  other = await seedUser({ role: 'therapist' });
  appts = [await appt(user, `${DATE}T02:00:00Z`, `${DATE}T03:00:00Z`), await appt(user, `${DATE}T05:00:00Z`, `${DATE}T06:00:00Z`)];
});
afterAll(closePool);

test('creates one Outlook "Travel" event per leg, linked to its appointment; a resend writes nothing', async () => {
  const o = stubOutlook();
  const body = { date: DATE, seenEventIds: appts, legs: [leg(appts[0], 'after', '11:00', '11:20'), leg(appts[1], 'before', '12:40', '13:00')] };
  const r = await sync.syncDay(deps(o), user.id, body, NOW);
  expect(r.body).toMatchObject({ created: 2, updated: 0, removed: 0 });
  expect(o.calls.create.map((e) => e.categories)).toEqual([['Travel'], ['Travel']]);
  expect(o.calls.create[0]).toMatchObject({ startTime: `${DATE}T11:00:00+08:00`, endTime: `${DATE}T11:20:00+08:00` });
  const rows = await mirrors();
  expect(rows.map((x) => [x.key, x.event_type, x.related_event_id, !!x.outlook_id])).toEqual([
    [appts[0] + '|after', 'travel', appts[0], true], [appts[1] + '|before', 'travel', appts[1], true]]);
  // The mirror rows themselves are not "events the calendar must have seen".
  const again = await sync.syncDay(deps(o), user.id, body, NOW);
  expect(again.body).toMatchObject({ created: 0, updated: 0, removed: 0 });
  expect(o.calls.create).toHaveLength(2);
});

test('a moved leg is updated in place; a leg that is no longer needed is deleted from Outlook', async () => {
  const o = stubOutlook();
  await sync.syncDay(deps(o), user.id, { date: DATE, seenEventIds: appts, legs: [leg(appts[0], 'after', '11:00', '11:20'), leg(appts[1], 'before', '12:40', '13:00')] }, NOW);
  const r = await sync.syncDay(deps(o), user.id, { date: DATE, seenEventIds: appts, legs: [leg(appts[0], 'after', '11:30', '11:50')] }, NOW);
  expect(r.body).toMatchObject({ created: 0, updated: 1, removed: 1 });
  expect(o.calls.update[0][1]).toMatchObject({ startTime: `${DATE}T11:30:00+08:00` });
  expect(o.calls.remove).toEqual(['out-2']);
  const live = (await mirrors()).filter((x) => !x.is_deleted);
  expect(live.map((x) => x.key)).toEqual([appts[0] + '|after']);
});

test('two syncs racing for the same day still make exactly one Outlook event per leg', async () => {
  const o = stubOutlook();
  const body = { date: DATE, seenEventIds: appts, legs: [leg(appts[0], 'after', '11:00', '11:20')] };
  await Promise.all([sync.syncDay(deps(o), user.id, body, NOW), sync.syncDay(deps(o), user.id, body, NOW)]);
  expect(o.calls.create).toHaveLength(1);
  expect((await mirrors()).filter((x) => !x.is_deleted)).toHaveLength(1);
});

test('the unique index refuses a second live row for the same leg key (migration 073)', async () => {
  const ins = () => db.pool.query(
    `INSERT INTO events (user_id, title, start_time, end_time, event_type, custom_metadata)
     VALUES ($1, 'Travel', $2, $3, 'travel', jsonb_build_object('travelLegKey', $4::text))`,
    [user.id, `${DATE}T03:00:00Z`, `${DATE}T03:20:00Z`, appts[0] + '|after']);
  await ins();
  await expect(ins()).rejects.toMatchObject({ code: '23505' });
});

test('a view missing one of the day\'s events, or holding someone else\'s, is refused — nothing deleted', async () => {
  const o = stubOutlook();
  await sync.syncDay(deps(o), user.id, { date: DATE, seenEventIds: appts, legs: [leg(appts[0], 'after', '11:00', '11:20')] }, NOW);
  const stale = await sync.syncDay(deps(o), user.id, { date: DATE, seenEventIds: [appts[0]], legs: [] }, NOW);
  expect([stale.status, stale.body.code]).toEqual([409, 'stale_view']);
  const theirs = await appt(other, `${DATE}T07:00:00Z`, `${DATE}T08:00:00Z`);
  const foreign = await sync.syncDay(deps(o), user.id, { date: DATE, seenEventIds: [...appts, theirs], legs: [] }, NOW);
  expect([foreign.status, foreign.body.code]).toEqual([409, 'not_own_day']);
  expect(o.calls.remove).toHaveLength(0);
  expect((await mirrors()).filter((x) => !x.is_deleted)).toHaveLength(1);
});

// 10 Oct 2026: a day with an all-day event (drawn as a chip, sent in the view)
// was refused as not_own_day, so none of its legs reached Outlook.
test("the day's own all-day and cancelled rows may be in the view; neither owns a leg", async () => {
  const o = stubOutlook();
  const { rows: [allDay] } = await db.pool.query(
    `INSERT INTO events (user_id, title, start_time, end_time, event_type) VALUES ($1, 'Annual leave', $2, $3, 'leave') RETURNING id`,
    [user.id, '2030-03-03T16:00:00Z', '2030-03-04T16:00:00Z']);   // 4 Mar, midnight to midnight Perth
  const { rows: [cancelled] } = await db.pool.query(
    `INSERT INTO events (user_id, title, start_time, end_time, event_type, status) VALUES ($1, 'Cancelled visit', $2, $3, 'therapy', 'cancelled') RETURNING id`,
    [user.id, `${DATE}T07:00:00Z`, `${DATE}T08:00:00Z`]);
  const seenEventIds = [...appts, allDay.id, cancelled.id];
  const r = await sync.syncDay(deps(o), user.id, { date: DATE, seenEventIds, legs: [leg(appts[0], 'after', '11:00', '11:20')] }, NOW);
  expect([r.status, r.body.created]).toEqual([200, 1]);
  const owned = await sync.syncDay(deps(o), user.id, { date: DATE, seenEventIds, legs: [leg(allDay.id, 'before', '07:00', '07:20')] }, NOW);
  expect([owned.status, owned.body.code]).toEqual([409, 'not_own_leg']);
  expect(o.calls.create).toHaveLength(1);
});

// 10 Oct 2026: the delta sync can import the new Outlook event before its
// mirror row is linked. That twin is released, not left as a second tile.
test('a delta import that lands between the Outlook create and the link is absorbed', async () => {
  const o = stubOutlook();
  const create = o.createOutlookEvent;
  o.createOutlookEvent = async (tok, e) => {
    const r = await create(tok, e);
    await db.upsertOutlookEvent(user.id, { outlookId: r.outlookId, title: e.title, startTime: e.startTime, endTime: e.endTime, categories: ['Travel'] });
    return r;
  };
  const r = await sync.syncDay(deps(o), user.id, { date: DATE, seenEventIds: appts, legs: [leg(appts[0], 'after', '11:00', '11:20')] }, NOW);
  expect(r.body).toMatchObject({ created: 1, failed: 0 });
  expect((await mirrors()).map((x) => [x.key, x.outlook_id, x.is_deleted])).toEqual([[appts[0] + '|after', 'out-1', false]]);
  const { rows: twins } = await db.pool.query(
    `SELECT outlook_id, is_deleted FROM events WHERE user_id = $1 AND created_by_source = 'outlook'`, [user.id]);
  expect(twins).toEqual([{ outlook_id: null, is_deleted: true }]);
  expect(o.calls.remove).toHaveLength(0);
});

test('past days are left alone; a failed Outlook write leaves no claimed key behind', async () => {
  const o = stubOutlook();
  const past = await sync.syncDay(deps(o), user.id, { date: DATE, seenEventIds: appts, legs: [leg(appts[0], 'after', '11:00', '11:20')] }, new Date('2030-03-05T00:00:00Z'));
  expect(past.body.skipped).toBe('past');
  o.createOutlookEvent = async () => { throw new Error('graph down'); };
  const r = await sync.syncDay(deps(o), user.id, { date: DATE, seenEventIds: appts, legs: [leg(appts[0], 'after', '11:00', '11:20')] }, NOW);
  expect(r.body).toMatchObject({ created: 0, failed: 1 });
  expect(await mirrors()).toHaveLength(0);
});

// 21 Nov 2026 audit (T-08): a week's ready days in one request. Each day keeps
// its own guards against the real database: a stale day is refused and keeps
// its travel, an unconfirmed empty day deletes nothing, the others are synced.
test('a batch syncs each day on its own: one stale or unconfirmed day never costs another day its travel', async () => {
  const o = stubOutlook();
  const DATE2 = '2030-03-05', DATE3 = '2030-03-06';
  const next = await appt(user, `${DATE2}T02:00:00Z`, `${DATE2}T03:00:00Z`);
  const third = await appt(user, `${DATE3}T02:00:00Z`, `${DATE3}T03:00:00Z`);
  const leg2 = { key: next + '|after', start: `${DATE2}T11:00:00+08:00`, end: `${DATE2}T11:20:00+08:00`, title: 'Travel · 20 min · Osborne Park → Joondalup', location: 'Joondalup' };
  const leg3 = { key: third + '|after', start: `${DATE3}T11:00:00+08:00`, end: `${DATE3}T11:20:00+08:00`, title: 'Travel · 20 min · Osborne Park → Joondalup', location: 'Joondalup' };
  // First batch: all three days, every one with a leg.
  const first = await sync.syncDays(deps(o), user.id, { days: [
    { date: DATE, seenEventIds: appts, legs: [leg(appts[0], 'after', '11:00', '11:20')] },
    { date: DATE2, seenEventIds: [next], legs: [leg2] },
    { date: DATE3, seenEventIds: [third], legs: [leg3] },
  ] }, NOW);
  expect(first.results.map((x) => [x.date, x.status, x.body.created])).toEqual([[DATE, 200, 1], [DATE2, 200, 1], [DATE3, 200, 1]]);
  expect(o.calls.create).toHaveLength(3);
  // Second batch: day 1 stale (missing an event), day 2 emptied without
  // confirmEmpty, day 3 confirmed empty. Only day 3's travel goes.
  const second = await sync.syncDays(deps(o), user.id, { days: [
    { date: DATE, seenEventIds: [appts[0]], legs: [], confirmEmpty: true },
    { date: DATE2, seenEventIds: [next], legs: [] },
    { date: DATE3, seenEventIds: [third], legs: [], confirmEmpty: true },
  ] }, NOW);
  expect(second.results.map((x) => [x.date, x.status, x.body.code || x.body.removed])).toEqual([
    [DATE, 409, 'stale_view'], [DATE2, 409, 'empty_day_unconfirmed'], [DATE3, 200, 1]]);
  expect(o.calls.remove).toEqual(['out-3']);
  const live = (await mirrors()).filter((x) => !x.is_deleted).map((x) => x.key).sort();
  expect(live).toEqual([appts[0] + '|after', next + '|after'].sort());
  // A day beyond the 14-day horizon in a batch writes nothing.
  const far = await sync.syncDays(deps(o), user.id, { days: [{ date: '2030-03-30', seenEventIds: [], legs: [] }] }, NOW);
  expect(far.results[0].body.skipped).toBe('beyond_horizon');
});
