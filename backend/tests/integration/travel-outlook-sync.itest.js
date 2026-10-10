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
