'use strict';

/**
 * First-login wizard → the portal's own data shapes.
 *
 *  · the wizard's week-key helpers are an exact copy of the shell's — the
 *    work-location schedule is keyed by them, and a key one week off is a
 *    schedule nobody sees;
 *  · the merge rules for Work location / Travel bases (onboarding-wizard-link.js);
 *  · the credential reminder's decision (credential-reminder.js).
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const SHELL = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');
const WIZARD = fs.readFileSync(path.join(FRONTEND, 'onboarding.html'), 'utf8');

const link = require('../onboarding-wizard-link');
const reminder = require('../credential-reminder');

function fnSource(src, name) {
  const re = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`);
  const m = src.match(re);
  if (!m) throw new Error(`function ${name} not found`);
  return m[0];
}
function weekHelpers(src) {
  const body = ['mondayOf', 'weekKeyFor'].map((n) => fnSource(src, n)).join('\n') +
    '\n' + src.match(/function addDays\(d, n\) \{[^\n]*\}/)[0];
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn { mondayOf, addDays, weekKeyFor };`)();
}

describe('wizard week keys equal the shell\'s', () => {
  const shell = weekHelpers(SHELL);
  const wizard = weekHelpers(WIZARD);

  test('the source is a verbatim copy', () => {
    for (const n of ['mondayOf', 'weekKeyFor']) {
      expect(fnSource(WIZARD, n)).toBe(fnSource(SHELL, n));
    }
  });

  test.each([
    [2026, 9, 19], [2026, 9, 25], [2026, 0, 1], [2026, 0, 4], [2025, 11, 31],
    [2027, 0, 3], [2026, 3, 5], [2026, 9, 4], [2028, 1, 29], [2026, 11, 28],
  ])('same key for %i-%i-%i', (y, m, d) => {
    const day = new Date(y, m, d, 15, 30);
    expect(wizard.weekKeyFor(wizard.mondayOf(day))).toBe(shell.weekKeyFor(shell.mondayOf(day)));
    for (let i = 1; i <= 3; i += 1) {
      expect(wizard.weekKeyFor(wizard.addDays(wizard.mondayOf(day), i * 7)))
        .toBe(shell.weekKeyFor(shell.addDays(shell.mondayOf(day), i * 7)));
    }
  });

  test('a known date', () => {
    // Mon 19 Oct 2026: 291 days after 1 Jan → floor(291/7)+1 = 42 (not ISO W43).
    expect(shell.weekKeyFor(shell.mondayOf(new Date(2026, 9, 21)))).toBe('2026-W42');
  });

  test('the wizard sends this week and the next three', () => {
    expect(WIZARD).toMatch(/weekKeys: wizardWeekKeys\(\)/);
    expect(fnSource(WIZARD, 'wizardWeekKeys')).toMatch(/\[0, 1, 2, 3\]/);
  });
});

describe('work-location merge', () => {
  test('step 4 address becomes home-1 in WORK_BASES shape, keeping the office and other homes', () => {
    const stored = {
      office: { id: 'office', label: 'Perth metro office', addr: '', suburb: '', region: 'central' },
      homes: [
        { id: 'home-1', label: 'My place', kind: 'local', addr: '', suburb: '', region: 'central', icon: '', color: '#9a5f0e' },
        { id: 'home-x', label: 'Mum\'s', kind: 'local', addr: '9 Other St, Bicton WA 6157', suburb: 'Bicton', region: 'west' },
      ],
    };
    const out = link.setPrimaryHome(stored, { address: '12 Test Rd, Willetton WA 6155, Australia', lat: -32.05, lng: 115.88, placeId: 'pid-1' });
    expect(out.office).toEqual(stored.office);
    expect(out.homes).toHaveLength(2);
    expect(out.homes[0]).toMatchObject({
      id: 'home-1', label: 'My place', kind: 'local', addr: '12 Test Rd, Willetton WA 6155, Australia',
      suburb: 'Willetton', region: 'central', lat: -32.05, lng: 115.88, placeId: 'pid-1',
    });
    expect(out.homes[1]).toEqual(stored.homes[1]);
    expect(stored.homes[0].addr).toBe(''); // input untouched
  });

  test('a typed (unpicked) address drops an old pin', () => {
    const stored = { homes: [{ id: 'home-1', label: 'Home', kind: 'local', addr: 'Old', lat: 1, lng: 2, placeId: 'p' }] };
    const out = link.setPrimaryHome(stored, { address: '5 New St, Leeming WA 6149' });
    expect(out.homes[0].lat).toBeUndefined();
    expect(out.homes[0].placeId).toBeUndefined();
    expect(out.homes[0].suburb).toBe('Leeming');
  });

  test('step 5 bases are appended, never overwrite home-1, and are not added twice', () => {
    let ids = 0;
    const idFor = () => `home-t${ids++}`;
    const first = link.setPrimaryHome(null, { address: '12 Test Rd, Willetton WA 6155' });
    const out = link.appendExtraBases(first, [
      { name: 'Murdoch Clinic', address: '90 South St, Murdoch WA 6150', lat: -32.06, lng: 115.84 },
      { name: '', address: '1 School Rd, Thornlie WA 6108' },
      { name: 'Dup', address: '12 Test Rd, Willetton WA 6155' },
    ], idFor);
    expect(out.homes.map((h) => h.id)).toEqual(['home-1', 'home-t0', 'home-t1']);
    expect(out.homes[0].addr).toBe('12 Test Rd, Willetton WA 6155');
    expect(out.homes[1]).toMatchObject({ label: 'Murdoch Clinic', kind: 'local', suburb: 'Murdoch', lat: -32.06 });
    expect(out.homes[2]).toMatchObject({ label: 'Home 3', suburb: 'Thornlie', region: 'east' });
    const again = link.appendExtraBases(out, [{ name: 'Murdoch Clinic', address: '90  South St, Murdoch WA 6150' }], idFor);
    expect(again.homes).toHaveLength(3);
  });

  test('the old wizard shapes are read, not lost', () => {
    expect(link.toWorkBases({ formattedAddress: '3 A St, Bateman WA 6150', lat: -32, lng: 115 }).homes[0])
      .toMatchObject({ id: 'home-1', addr: '3 A St, Bateman WA 6150', suburb: 'Bateman', lat: -32, lng: 115 });
    const arr = link.toWorkBases([{ name: 'Clinic', address: '1 B St, Applecross WA 6153' }]);
    expect(arr.homes.map((h) => [h.id, h.addr])).toEqual([['home-1', ''], ['home-2', '1 B St, Applecross WA 6153']]);
    expect(link.toWorkBases(null)).toBeNull();
  });

  test('schedule fill sets Mon–Fri only where unset, ignores malformed keys', () => {
    const stored = { '2026-W42': { mon: 'office', wed: 'leave' }, '2026-W01': { fri: 'home-2' } };
    const out = link.fillScheduleDefaults(stored, ['2026-W42', '2026-W43', 'bogus', '2026-W42'], 'home-1');
    expect(out['2026-W42']).toEqual({ mon: 'office', tue: 'home-1', wed: 'leave', thu: 'home-1', fri: 'home-1' });
    expect(out['2026-W43']).toEqual({ mon: 'home-1', tue: 'home-1', wed: 'home-1', thu: 'home-1', fri: 'home-1' });
    expect(out['2026-W01']).toEqual({ fri: 'home-2' });
    expect(out.bogus).toBeUndefined();
    expect(stored['2026-W42'].tue).toBeUndefined();
  });

  test('a usable base needs an address', () => {
    expect(link.hasUsableBase({ homes: [{ id: 'home-1', addr: '' }] })).toBe(false);
    expect(link.hasUsableBase({ homes: [{ id: 'home-1', addr: '1 A St' }] })).toBe(true);
    expect(link.hasUsableBase({ office: { addr: '1 Office St' }, homes: [] })).toBe(true);
    expect(link.hasUsableBase(null)).toBe(false);
  });

  test('suburb rule matches travel.js addrSuburb', () => {
    const travel = fs.readFileSync(path.join(FRONTEND, 'travel.js'), 'utf8');
    // eslint-disable-next-line no-new-func
    const shellAddrSuburb = new Function(`${fnSource(travel, 'addrSuburb')}\nreturn addrSuburb;`)();
    for (const a of ['4 Jarrah Ln, Mount Claremont WA 6010, Australia', '100 Burrendah Blvd, Willetton WA 6155', 'Willetton', '7 X St, Perth']) {
      expect(link.addrSuburb(a)).toBe(shellAddrSuburb(a));
    }
  });
});

describe('credential reminder', () => {
  const therapist = { role: 'therapist', profile_completed: true };
  const all = (scan) => reminder.KEY_TYPES_CLINICAL.map((t) => ({ credential_type: t, document_id: scan ? 'd' : null }));

  test('due with no credentials, after onboarding only', () => {
    expect(reminder.decide({ user: therapist, creds: [] }).due).toBe(true);
    expect(reminder.decide({ user: { ...therapist, profile_completed: false }, creds: [] }).due).toBe(false);
    expect(reminder.decide({ user: { role: 'read_only', profile_completed: true }, creds: [] }).due).toBe(false);
  });

  test('still due while a key credential lacks its scan; quiet once all four have one', () => {
    expect(reminder.decide({ user: therapist, creds: all(false) }).due).toBe(true);
    const done = reminder.decide({ user: therapist, creds: all(true) });
    expect(done.satisfied).toBe(true);
    expect(done.due).toBe(false);
  });

  test('legacy type spellings count', () => {
    const creds = [{ credential_type: 'ahpra', document_id: 'd' }, { credential_type: 'indemnity_insurance', document_id: 'd' },
      { credential_type: 'wwcc', document_id: 'd' }, { credential_type: 'ndis_screening', document_id: 'd' }];
    expect(reminder.decide({ user: therapist, creds }).satisfied).toBe(true);
  });

  test('non-clinical staff need only the screening checks', () => {
    const admin = { role: 'admin', profile_completed: true, is_treating_therapist: false };
    const s = reminder.decide({ user: admin, creds: [{ credential_type: 'wwcc', document_id: 'd' }, { credential_type: 'ndis_worker_screening', document_id: 'd' }] });
    expect(s.satisfied).toBe(true);
  });

  test('dismissed is quiet', () => {
    expect(reminder.decide({ user: therapist, creds: [], dismissed: true }).due).toBe(false);
  });
});
