'use strict';

/**
 * Unit tests — Opa knowledge retrieval (pure functions + searchOpaKnowledge
 * with a mocked pool). No database, no network.
 */

const {
  searchOpaKnowledge,
  tokenise,
  scoreRecord,
  roleAllows,
} = require('../opa-knowledge');

// ── fixtures ────────────────────────────────────────────────────────────────

const outlookRecord = {
  id: 'k-outlook', module: 'settings', feature: 'Connect Outlook', route: '/settings',
  summary: 'Connect your Microsoft Outlook calendar from Settings, Integrations.',
  status: 'live', minimum_role: null,
  aliases: ['connect outlook', 'microsoft calendar', 'sync my calendar', 'outlook'],
};

const calendarRecord = {
  id: 'k-calendar', module: 'calendar', feature: 'Calendar day, week and month views', route: '/calendar',
  summary: 'The Calendar tab shows appointments in Day, Week or Month view.',
  status: 'live', minimum_role: null,
  aliases: ['calendar views', 'week view'],
};

const schedulerRecord = {
  id: 'k-sched', module: 'calendar', feature: 'Master Scheduler matrix', route: '/calendar',
  summary: 'Therapists down the left, time across the top; compare availability.',
  status: 'live', minimum_role: 'admin',
  aliases: ['master scheduler', 'scheduler'],
};

const plannedRecord = {
  id: 'k-planned', module: 'calendar', feature: 'Flight tracking', route: '/travel',
  summary: 'Planned flight and travel tracking with calendar views.',
  status: 'planned', minimum_role: null,
  aliases: ['flight tracking', 'calendar views'],
};

const deprecatedRecord = {
  id: 'k-dep', module: 'calendar', feature: 'Legacy calendar sync', route: '/calendar',
  summary: 'Old calendar sync mechanism with week view support.',
  status: 'deprecated', minimum_role: null,
  aliases: ['legacy sync', 'calendar views'],
};

function mockPool(rows) {
  return { query: jest.fn().mockResolvedValue({ rows }) };
}

// ── tokenise ────────────────────────────────────────────────────────────────

describe('tokenise', () => {
  test('lowercases and splits on non-alphanumerics', () => {
    expect(tokenise('Connect OUTLOOK, please!')).toEqual(['connect', 'outlook', 'please']);
  });

  test('drops tokens under 3 characters', () => {
    expect(tokenise('go to my calendar')).toEqual(['calendar']);
  });

  test('keeps known short domain aliases (at, pd, ot, fy)', () => {
    expect(tokenise('pd at ot fy')).toEqual(['pd', 'at', 'ot', 'fy']);
    expect(tokenise('ndis fca cpd')).toEqual(['ndis', 'fca', 'cpd']);
  });

  test('handles empty and non-string input', () => {
    expect(tokenise('')).toEqual([]);
    expect(tokenise(null)).toEqual([]);
    expect(tokenise(undefined)).toEqual([]);
  });
});

// ── scoreRecord ─────────────────────────────────────────────────────────────

describe('scoreRecord', () => {
  test('exact alias match scores 100 (plus any token overlap)', () => {
    const q = 'connect outlook';
    const score = scoreRecord(outlookRecord, tokenise(q), q, {});
    expect(score).toBeGreaterThanOrEqual(100);
  });

  test('alias substring scores 60, not 100', () => {
    const q = 'how do i connect outlook to this app';
    const tokens = tokenise(q);
    // Best alias is a substring hit (60), never summed with other aliases.
    const bare = { ...outlookRecord, feature: 'zzz', summary: 'zzz' };
    expect(scoreRecord(bare, tokens, q, {})).toBe(60);
  });

  test('feature token overlap is 10 per token, summary 4 per token', () => {
    const rec = {
      module: 'calendar', feature: 'week view', summary: 'shows the month layout',
      aliases: [], status: 'live',
    };
    const q = 'week month';
    // 'week' hits feature (+10), 'month' hits summary (+4)
    expect(scoreRecord(rec, tokenise(q), q, {})).toBe(14);
  });

  test('module boost +15 and route boost +8', () => {
    const q = 'calendar views';
    const tokens = tokenise(q);
    const base = scoreRecord(calendarRecord, tokens, q, {});
    const withModule = scoreRecord(calendarRecord, tokens, q, { module: 'calendar' });
    const withBoth = scoreRecord(calendarRecord, tokens, q, { module: 'calendar', route: '/calendar' });
    expect(withModule - base).toBe(15);
    expect(withBoth - base).toBe(23);
  });

  test('deterministic — identical inputs give identical scores', () => {
    const q = 'sync my calendar please';
    const tokens = tokenise(q);
    const a = scoreRecord(outlookRecord, tokens, q, { module: 'settings' });
    const b = scoreRecord(outlookRecord, tokens, q, { module: 'settings' });
    expect(a).toBe(b);
    expect(typeof a).toBe('number');
  });
});

// ── roleAllows ──────────────────────────────────────────────────────────────

describe('roleAllows', () => {
  test('null minimum_role is visible to everyone', () => {
    for (const role of ['read_only', 'therapist', 'admin', 'owner']) {
      expect(roleAllows(role, null)).toBe(true);
    }
  });

  test('hierarchy owner > admin > therapist > read_only', () => {
    expect(roleAllows('therapist', 'admin')).toBe(false);
    expect(roleAllows('admin', 'admin')).toBe(true);
    expect(roleAllows('owner', 'admin')).toBe(true);
    expect(roleAllows('read_only', 'therapist')).toBe(false);
    expect(roleAllows('admin', 'owner')).toBe(false);
  });

  test('unknown roles fail closed', () => {
    expect(roleAllows('superuser', 'admin')).toBe(false);
    expect(roleAllows(undefined, 'therapist')).toBe(false);
  });
});

// ── searchOpaKnowledge ──────────────────────────────────────────────────────

describe('searchOpaKnowledge', () => {
  test('alias resolution — outlook phrasings all resolve to the same record', async () => {
    for (const query of ['connect outlook', 'Microsoft calendar', 'sync my calendar']) {
      const pool = mockPool([outlookRecord, calendarRecord]);
      const results = await searchOpaKnowledge(pool, { query, role: 'therapist' });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('k-outlook');
    }
  });

  test('SQL excludes planned and deprecated statuses', async () => {
    const pool = mockPool([]);
    await searchOpaKnowledge(pool, { query: 'anything here', role: 'therapist' });
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain(`status NOT IN ('planned','deprecated')`);
  });

  test('planned and deprecated records are never returned even if the pool leaks them', async () => {
    // Defence in depth: even a row that slips past SQL filtering is dropped in JS.
    const pool = mockPool([plannedRecord, deprecatedRecord, calendarRecord]);
    const results = await searchOpaKnowledge(pool, { query: 'calendar views', role: 'owner' });
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain('k-planned');
    expect(ids).not.toContain('k-dep');
    expect(ids).toContain('k-calendar');
  });

  test('minimum_role filtering — therapist never sees admin records, admin does', async () => {
    const rows = [schedulerRecord, calendarRecord];
    const asTherapist = await searchOpaKnowledge(mockPool(rows), {
      query: 'master scheduler', role: 'therapist',
    });
    expect(asTherapist.map((r) => r.id)).not.toContain('k-sched');

    const asAdmin = await searchOpaKnowledge(mockPool(rows), {
      query: 'master scheduler', role: 'admin',
    });
    expect(asAdmin[0].id).toBe('k-sched');
  });

  test('role filter also appears in the SQL', async () => {
    const pool = mockPool([]);
    await searchOpaKnowledge(pool, { query: 'scheduler', role: 'therapist' });
    expect(pool.query.mock.calls[0][0]).toContain('minimum_role');
  });

  test('module boost affects ranking', async () => {
    // Two records tie on text relevance; the current-page module must win.
    const a = {
      id: 'a', module: 'calendar', feature: 'shared thing', summary: 'does stuff',
      aliases: ['shared thing'], status: 'live', minimum_role: null,
    };
    const b = {
      id: 'b', module: 'resources', feature: 'shared thing', summary: 'does stuff',
      aliases: ['shared thing'], status: 'live', minimum_role: null,
    };
    const onCalendar = await searchOpaKnowledge(mockPool([b, a]), {
      query: 'shared thing', role: 'therapist', module: 'calendar',
    });
    expect(onCalendar[0].id).toBe('a');

    const onResources = await searchOpaKnowledge(mockPool([b, a]), {
      query: 'shared thing', role: 'therapist', module: 'resources',
    });
    expect(onResources[0].id).toBe('b');
  });

  test('empty query with a module returns that module\'s records', async () => {
    const pool = mockPool([calendarRecord]);
    const results = await searchOpaKnowledge(pool, { query: '', module: 'calendar', role: 'therapist' });
    expect(results.map((r) => r.id)).toEqual(['k-calendar']);
    expect(pool.query.mock.calls[0][0]).toContain('module =');
  });

  test('empty query without a module returns nothing (no pool call)', async () => {
    const pool = mockPool([calendarRecord]);
    const results = await searchOpaKnowledge(pool, { query: '', role: 'therapist' });
    expect(results).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('zero-score candidates are dropped and limit is respected', async () => {
    const irrelevant = {
      id: 'z', module: 'settings', feature: 'Nothing relevant', summary: 'unrelated words entirely',
      aliases: [], status: 'live', minimum_role: null,
    };
    const results = await searchOpaKnowledge(mockPool([irrelevant, outlookRecord]), {
      query: 'connect outlook', role: 'therapist', limit: 1,
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('k-outlook');
  });
});
