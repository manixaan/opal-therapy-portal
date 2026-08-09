'use strict';

/**
 * Support tickets — unit tests over the exported pure helpers.
 * Ticket-number formatting, the status-transition map, the technical-context
 * sanitiser and the attachment validator. No DB, no network.
 */

const {
  VALID_TRANSITIONS,
  canTransition,
  formatTicketNumber,
  sanitizeTechnicalContext,
  validateTicketAttachment,
} = require('../support-routes');

describe('ticket number format', () => {
  test('pads to four digits with the OPA prefix', () => {
    expect(formatTicketNumber(1)).toBe('OPA-0001');
    expect(formatTicketNumber(42)).toBe('OPA-0042');
    expect(formatTicketNumber(9999)).toBe('OPA-9999');
  });

  test('grows naturally past 9999 and stays within VARCHAR(12)', () => {
    expect(formatTicketNumber(10000)).toBe('OPA-10000');
    expect(formatTicketNumber(99999999).length).toBeLessThanOrEqual(12);
  });
});

describe('status transition map', () => {
  test('the happy path is fully connected', () => {
    for (const [from, to] of [
      ['new', 'triaged'], ['triaged', 'in_progress'], ['in_progress', 'ready_to_test'],
      ['ready_to_test', 'resolved'], ['resolved', 'closed'],
    ]) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  test('wont_fix and duplicate are reachable only before a fix ships', () => {
    for (const from of ['new', 'triaged', 'in_progress']) {
      expect(canTransition(from, 'wont_fix')).toBe(true);
      expect(canTransition(from, 'duplicate')).toBe(true);
    }
    for (const from of ['ready_to_test', 'resolved', 'closed']) {
      expect(canTransition(from, 'wont_fix')).toBe(false);
      expect(canTransition(from, 'duplicate')).toBe(false);
    }
  });

  test('reopening goes through in_progress; terminal states stay terminal', () => {
    expect(canTransition('resolved', 'in_progress')).toBe(true);
    expect(canTransition('closed', 'in_progress')).toBe(true);
    expect(VALID_TRANSITIONS.wont_fix).toEqual([]);
    expect(VALID_TRANSITIONS.duplicate).toEqual([]);
  });

  test('no backwards jumps or skips', () => {
    expect(canTransition('resolved', 'new')).toBe(false);
    expect(canTransition('new', 'resolved')).toBe(false);
    expect(canTransition('closed', 'resolved')).toBe(false);
    expect(canTransition('triaged', 'ready_to_test')).toBe(false);
    expect(canTransition('nonsense', 'triaged')).toBe(false);
  });
});

describe('technical-context sanitiser', () => {
  test('strips credential-shaped keys at any depth', () => {
    const out = sanitizeTechnicalContext({
      route: 'calendar',
      token: 'abc', accessToken: 'x', Cookie: 'sid=1', SECRET_THING: 'x',
      authorization: 'Bearer x', apiKey: 'k', api_key: 'k', key: 'k',
      nested: { sessionToken: 'y', keep: 'me', deeper: { cookieJar: 'z', ok: 1 } },
    });
    expect(out.route).toBe('calendar');
    expect(out.nested.keep).toBe('me');
    expect(out.nested.deeper.ok).toBe(1);
    const json = JSON.stringify(out).toLowerCase();
    for (const bad of ['token', 'cookie', 'secret', 'authorization', 'apikey', 'api_key', '"key"']) {
      expect(json).not.toContain(bad);
    }
  });

  test('caps string lengths, entry counts and depth', () => {
    const big = {};
    for (let i = 0; i < 60; i++) big['k' + i] = 'v';
    big.long = 'x'.repeat(5000);
    const out = sanitizeTechnicalContext(big);
    expect(Object.keys(out).length).toBeLessThanOrEqual(30);
    if (out.long) expect(out.long.length).toBeLessThanOrEqual(300);

    let deep = { v: 1 };
    for (let i = 0; i < 10; i++) deep = { child: deep };
    expect(JSON.stringify(sanitizeTechnicalContext(deep)).length).toBeLessThan(200);
  });

  test('non-object inputs become an empty object or safe scalar', () => {
    expect(sanitizeTechnicalContext(null)).toEqual({});
    expect(sanitizeTechnicalContext(undefined)).toEqual({});
    expect(sanitizeTechnicalContext('just a string')).toBe('just a string');
    expect(sanitizeTechnicalContext(() => {})).toBeNull();
  });
});

describe('attachment validator (screenshots only)', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUg=='; // valid base64 prefix

  test('accepts PNG, JPEG and WEBP with matching extensions', () => {
    expect(validateTicketAttachment({ fileName: 'shot.png', fileMime: 'image/png', fileData: PNG })).toBeNull();
    expect(validateTicketAttachment({ fileName: 'shot.jpeg', fileMime: 'image/jpeg', fileData: PNG })).toBeNull();
    expect(validateTicketAttachment({ fileName: 'shot.webp', fileMime: 'image/webp', fileData: PNG })).toBeNull();
  });

  test('refuses other types, mismatched extensions and path tricks', () => {
    expect(validateTicketAttachment({ fileName: 'x.pdf', fileMime: 'application/pdf', fileData: PNG })).toMatch(/not allowed/);
    expect(validateTicketAttachment({ fileName: 'x.svg', fileMime: 'image/svg+xml', fileData: PNG })).toMatch(/not allowed/);
    expect(validateTicketAttachment({ fileName: 'x.png', fileMime: 'image/jpeg', fileData: PNG })).toMatch(/does not match/);
    expect(validateTicketAttachment({ fileName: '../x.png', fileMime: 'image/png', fileData: PNG })).toMatch(/Invalid file name/);
    expect(validateTicketAttachment({ fileName: 'x.png', fileMime: 'image/png', fileData: '<script>' })).toMatch(/base64/);
    expect(validateTicketAttachment({ fileName: 'x.png', fileMime: 'image/png', fileData: '' })).toMatch(/required/);
  });
});
