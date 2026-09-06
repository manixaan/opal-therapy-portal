'use strict';

/**
 * DELTA PARTIAL-PAYLOAD PRESERVATION — regression guard (2026-08-10)
 *
 * Microsoft Graph delta responses are PARTIAL: a changed event returns its id
 * plus only the properties that actually changed. The original code collapsed
 * every absent property into a value —
 *
 *     title:      item.subject || null            → null
 *     location:   item.location?.displayName || ''→ ''
 *     categories: item.categories || []           → []
 *
 * — and upsertOutlookEvent then wrote those over the stored row
 * (`title = $1` with `const title = eventData.title || '(No title)'`). A delta
 * touch that merely omitted `subject` therefore REPLACED the real title with
 * the literal '(No title)' and emptied the categories. 517 rows in the dev
 * database were damaged this way.
 *
 * These tests pin the contract that makes the wipe impossible:
 *   absent  → key is `undefined`      → NULL parameter → COALESCE keeps stored
 *   present → key holds Graph's value → parameter written, even when '' / []
 */

// The SQL is the thing under test, so pg is faked at the driver boundary and
// database.js runs for real.
const mockQuery = jest.fn();
jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query: mockQuery, on: jest.fn(), connect: jest.fn(), end: jest.fn() })),
  types: { setTypeParser: jest.fn() },
}));

const db         = require('../database');
const outlookApi = require('../outlook-oauth');

const USER_ID = 'user-delta-001';
const ROW_ID  = 'row-delta-001';
const OL_ID   = 'AAMkDelta123==';

/** Route database.js's queries: profile lookup → existing-row lookup → write. */
function primeExistingRow({ exists = true } = {}) {
  mockQuery.mockReset();
  mockQuery.mockImplementation(async (sql) => {
    if (/FROM therapist_profiles/.test(sql)) {
      return { rows: [{ id: 'tp-1', organisation_id: 'org-1' }] };
    }
    if (/SELECT id FROM events/.test(sql)) {
      return { rows: exists ? [{ id: ROW_ID }] : [] };
    }
    return { rows: [{ id: ROW_ID }] }; // the UPDATE/INSERT itself
  });
}

/** The UPDATE or INSERT call — the last query issued by the upsert. */
function writeCall() {
  const calls = mockQuery.mock.calls.filter(([sql]) =>
    /^\s*UPDATE events/m.test(sql) || /INSERT INTO events/.test(sql));
  return calls[calls.length - 1];
}

// Parameter positions in the UPDATE: $1 title, $2 start, $3 end, $4 location, $5 categories
const UPD = { title: 0, start: 1, end: 2, location: 3, categories: 4 };
// Parameter positions in the INSERT: $1 user, $2 title, $3 start, $4 end, $5 location, ... $8 categories
const INS = { title: 1, start: 2, end: 3, location: 4, categories: 7 };

describe('mapDeltaItem — absence must survive as undefined', () => {
  const toUtcIso = (slot) => (slot && slot.dateTime ? `${slot.dateTime}Z` : null);
  const START = { dateTime: '2026-07-01T09:00:00.0000000', timeZone: 'UTC' };
  const END   = { dateTime: '2026-07-01T10:00:00.0000000', timeZone: 'UTC' };

  test('a partial delta item omits title/location/categories entirely', () => {
    const mapped = outlookApi.mapDeltaItem(
      { id: OL_ID, start: START, end: END, type: 'occurrence' }, toUtcIso);

    // The keys must be ABSENT, not null/''/[] — that distinction is the fix.
    expect(mapped).not.toHaveProperty('title');
    expect(mapped).not.toHaveProperty('location');
    expect(mapped).not.toHaveProperty('categories');
    expect(mapped.title).toBeUndefined();
    expect(mapped.location).toBeUndefined();
    expect(mapped.categories).toBeUndefined();
    // Identity/scheduling fields still map as before.
    expect(mapped.outlookId).toBe(OL_ID);
    expect(mapped.startTime).toBe('2026-07-01T09:00:00.0000000Z');
  });

  test('absence survives an object spread (how routes/server pass it on)', () => {
    const mapped = outlookApi.mapDeltaItem({ id: OL_ID, start: START, end: END }, toUtcIso);
    const forwarded = { ...mapped, eventType: 'therapy' };
    expect('title' in forwarded).toBe(false);
    expect('categories' in forwarded).toBe(false);
  });

  test('a present subject is carried through verbatim', () => {
    const mapped = outlookApi.mapDeltaItem(
      { id: OL_ID, subject: 'Jonathan Jose', start: START, end: END }, toUtcIso);
    expect(mapped.title).toBe('Jonathan Jose');
  });

  test('an explicitly empty subject is a real value, distinct from absent', () => {
    const mapped = outlookApi.mapDeltaItem({ id: OL_ID, subject: '', start: START }, toUtcIso);
    expect('title' in mapped).toBe(true);
    expect(mapped.title).toBe('');
  });

  test('an explicit null subject/location normalises to empty string, still present', () => {
    const mapped = outlookApi.mapDeltaItem(
      { id: OL_ID, subject: null, location: null, start: START }, toUtcIso);
    expect('title' in mapped).toBe(true);
    expect(mapped.title).toBe('');
    expect('location' in mapped).toBe(true);
    expect(mapped.location).toBe('');
  });

  test('present categories map through, including a deliberate clear to []', () => {
    const withCats = outlookApi.mapDeltaItem(
      { id: OL_ID, categories: ['Therapy', 'NDIS'], start: START }, toUtcIso);
    expect(withCats.categories).toEqual(['Therapy', 'NDIS']);

    const cleared = outlookApi.mapDeltaItem({ id: OL_ID, categories: [], start: START }, toUtcIso);
    expect('categories' in cleared).toBe(true);
    expect(cleared.categories).toEqual([]);
  });

  test('a present location maps its displayName', () => {
    const mapped = outlookApi.mapDeltaItem(
      { id: OL_ID, location: { displayName: 'Joondalup' }, start: START }, toUtcIso);
    expect(mapped.location).toBe('Joondalup');
  });
});

describe('upsertOutlookEvent — an existing row is never wiped by a partial payload', () => {
  test('THE REGRESSION: no subject/location/categories ⇒ all three preserved', async () => {
    primeExistingRow();
    await db.upsertOutlookEvent(USER_ID, {
      outlookId: OL_ID,
      startTime: '2026-07-01T09:50:00Z',
      endTime:   '2026-07-01T10:53:00Z',
      // title / location / categories deliberately absent — a real delta touch
    });

    const [sql, params] = writeCall();
    expect(sql).toMatch(/^\s*UPDATE events/m);

    // NULL parameters + COALESCE = the stored values survive.
    expect(params[UPD.title]).toBeNull();
    expect(params[UPD.location]).toBeNull();
    expect(params[UPD.categories]).toBeNull();
    expect(sql).toMatch(/title\s*=\s*COALESCE\(\$1,\s*title\)/);
    expect(sql).toMatch(/categories\s*=\s*COALESCE\(\$5,\s*categories\)/);

    // The exact literal that destroyed 517 rows must never be sent again.
    expect(params).not.toContain('(No title)');
  });

  test('a real subject in the payload does update the title', async () => {
    primeExistingRow();
    await db.upsertOutlookEvent(USER_ID, {
      outlookId: OL_ID, title: 'Jonathan Jose',
      startTime: '2026-07-01T09:50:00Z', endTime: '2026-07-01T10:53:00Z',
    });
    expect(writeCall()[1][UPD.title]).toBe('Jonathan Jose');
  });

  test('an explicitly empty subject is written (authoritative "no subject")', async () => {
    primeExistingRow();
    await db.upsertOutlookEvent(USER_ID, {
      outlookId: OL_ID, title: '',
      startTime: '2026-07-01T09:00:00Z', endTime: '2026-07-01T10:00:00Z',
    });
    // '' is not NULL, so COALESCE writes it — absent and empty stay distinct.
    expect(writeCall()[1][UPD.title]).toBe('');
  });

  test('categories preserved when absent, replaced when present', async () => {
    primeExistingRow();
    await db.upsertOutlookEvent(USER_ID, {
      outlookId: OL_ID, title: 'Session',
      startTime: '2026-07-01T09:00:00Z', endTime: '2026-07-01T10:00:00Z',
    });
    expect(writeCall()[1][UPD.categories]).toBeNull(); // absent → preserved

    primeExistingRow();
    await db.upsertOutlookEvent(USER_ID, {
      outlookId: OL_ID, title: 'Session', categories: ['NDIS'],
      startTime: '2026-07-01T09:00:00Z', endTime: '2026-07-01T10:00:00Z',
    });
    expect(writeCall()[1][UPD.categories]).toEqual(['NDIS']); // present → written

    primeExistingRow();
    await db.upsertOutlookEvent(USER_ID, {
      outlookId: OL_ID, title: 'Session', categories: [],
      startTime: '2026-07-01T09:00:00Z', endTime: '2026-07-01T10:00:00Z',
    });
    expect(writeCall()[1][UPD.categories]).toEqual([]); // deliberate clear honoured
  });

  test('manual location override still wins over an incoming Outlook location', async () => {
    primeExistingRow();
    await db.upsertOutlookEvent(USER_ID, {
      outlookId: OL_ID, title: 'Session', location: 'Perth CBD',
      startTime: '2026-07-01T09:00:00Z', endTime: '2026-07-01T10:00:00Z',
    });
    const [sql, params] = writeCall();
    expect(sql).toMatch(
      /location\s*=\s*CASE WHEN is_manual_location_override = TRUE THEN location ELSE COALESCE\(\$4, location\) END/);
    expect(params[UPD.location]).toBe('Perth CBD');
  });

  test('absent start/end cannot null out a NOT NULL column', async () => {
    primeExistingRow();
    await db.upsertOutlookEvent(USER_ID, { outlookId: OL_ID, title: 'Session' });
    const [sql, params] = writeCall();
    // The timing columns keep their COALESCE (absent = preserve), now inside a
    // CASE that also shields an unpushed app-side move from an older echo.
    expect(sql).toMatch(/start_time\s*=\s*CASE WHEN last_modified_by = 'app' AND sync_status = 'pending' THEN start_time ELSE COALESCE\(\$2,\s*start_time\) END/);
    expect(sql).toMatch(/end_time\s*=\s*CASE WHEN last_modified_by = 'app' AND sync_status = 'pending' THEN end_time\s+ELSE COALESCE\(\$3,\s*end_time\)\s+END/);
    expect(params[UPD.start]).toBeUndefined();
    expect(params[UPD.end]).toBeUndefined();
  });

  test('behaviour preserved: seriesMaster is still skipped entirely', async () => {
    primeExistingRow();
    const result = await db.upsertOutlookEvent(USER_ID, {
      outlookId: OL_ID, type: 'seriesMaster', title: 'Weekly review',
    });
    expect(result).toEqual({ skipped: 'seriesMaster', outlookId: OL_ID });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('behaviour preserved: isCancelled still soft-deletes and writes nothing else', async () => {
    primeExistingRow();
    const result = await db.upsertOutlookEvent(USER_ID, { outlookId: OL_ID, isCancelled: true });
    expect(result).toBeNull();
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/is_deleted = TRUE/);
  });

  test('behaviour preserved: created_by_source and ownership stamping are untouched', async () => {
    primeExistingRow();
    await db.upsertOutlookEvent(USER_ID, {
      outlookId: OL_ID, title: 'Session',
      startTime: '2026-07-01T09:00:00Z', endTime: '2026-07-01T10:00:00Z',
    });
    const [sql] = writeCall();
    expect(sql).toMatch(/created_by_source\s*=\s*COALESCE\(created_by_source,\s*\$12\)/);
    expect(sql).toMatch(/therapist_profile_id\s*=\s*COALESCE\(therapist_profile_id,\s*\$10\)/);
    expect(sql).toMatch(/source\s*=\s*CASE WHEN created_by_source = 'app' THEN 'app' ELSE 'outlook' END/);
  });
});

describe('upsertOutlookEvent — NEW row insert semantics', () => {
  test('an explicitly empty subject inserts as empty, not the placeholder', async () => {
    primeExistingRow({ exists: false });
    await db.upsertOutlookEvent(USER_ID, {
      outlookId: OL_ID, title: '',
      startTime: '2026-07-01T09:00:00Z', endTime: '2026-07-01T10:00:00Z',
    });
    const [sql, params] = writeCall();
    expect(sql).toMatch(/INSERT INTO events/);
    expect(params[INS.title]).toBe(''); // NOT NULL is satisfied by ''
  });

  test('a genuinely absent subject falls back to the placeholder (NOT NULL)', async () => {
    primeExistingRow({ exists: false });
    await db.upsertOutlookEvent(USER_ID, {
      outlookId: OL_ID,
      startTime: '2026-07-01T09:00:00Z', endTime: '2026-07-01T10:00:00Z',
    });
    expect(writeCall()[1][INS.title]).toBe('(No title)');
  });

  test('a real subject inserts verbatim', async () => {
    primeExistingRow({ exists: false });
    await db.upsertOutlookEvent(USER_ID, {
      outlookId: OL_ID, title: 'Jonathan Jose', categories: ['NDIS'],
      startTime: '2026-07-01T09:00:00Z', endTime: '2026-07-01T10:00:00Z',
    });
    const params = writeCall()[1];
    expect(params[INS.title]).toBe('Jonathan Jose');
    expect(params[INS.categories]).toEqual(['NDIS']);
  });
});
