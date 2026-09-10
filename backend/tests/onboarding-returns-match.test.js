'use strict';

/** Placing a returned file on its pack item: by what it is, else by what it is named. */

const { matchDocument } = require('../onboarding-returns-routes')._internals;

const item = (code, title, extra = {}) => ({ id: code.toLowerCase(), code, title, status: 'included', employee_returns: true, phase: 'documentation', ...extra });
const PACK = [
  item('PACK_CONTRACT', 'Contract of Employment'),
  item('PACK_FWIS', 'FWIS (and FTCIS/CEIS)', { employee_returns: false }),
  item('DEF_4D77AD50', 'FTCIS', { employee_returns: false }),
  item('PACK_NEW_EMPLOYEE_DETAILS', 'New Employee Details'),
  item('DEF_REMOVED', 'Parking policy', { status: 'removed', employee_returns: false }),
];

describe('matchDocument', () => {
  test('an FTCIS that came back lands on the added, read-only FTCIS item rather than the FWIS or nowhere', () => {
    const m = matchDocument({ file_name: '05 - FTCIS.pdf', title: '05 - FTCIS.pdf' }, null, PACK);
    expect(m).toMatchObject({ kind: 'ftcis', confidence: 'medium' });
    expect(m.item.code).toBe('DEF_4D77AD50');
  });

  test('without an item of its own the FTCIS falls back to the FWIS slot it went out with', () => {
    const m = matchDocument({ file_name: 'FTCIS.pdf' }, null, PACK.filter((p) => p.code !== 'DEF_4D77AD50'));
    expect(m.item.code).toBe('PACK_FWIS');
  });

  test('a file named for a read-only item is placed on it even when nothing else recognises it', () => {
    const pack = [...PACK, item('DEF_1', 'Staff parking map', { employee_returns: false })];
    const m = matchDocument({ file_name: '06 - Staff Parking Map.pdf' }, { kind: 'unrecognised', confidence: 'low' }, pack);
    expect(m.item.code).toBe('DEF_1');
    expect(m.confidence).toBe('medium');
  });

  test('a removed item and a short or unrelated name stay unplaced', () => {
    expect(matchDocument({ file_name: 'Parking policy.pdf' }, null, PACK).item).toBeNull();
    expect(matchDocument({ file_name: '00 - Read Me First.txt' }, null, PACK)).toEqual({ kind: 'unrecognised', item: null, confidence: 'low' });
  });

  test('recognised kinds still take their own slot first', () => {
    expect(matchDocument({ file_name: '01 - Contract of Employment.pdf' }, { kind: 'contract', confidence: 'high' }, PACK).item.code).toBe('PACK_CONTRACT');
  });
});

/** The supporting-document slots of the standard pack: each must fill from what
 * the model says the file is, and from an ordinarily named file alone. */
const SUPPORTING = [
  item('REQ_DRIVERS_LICENCE', "Driver's licence (front and back)"),
  item('REQ_IDENTITY', 'Passport photo page (identity and right to work)'),
  item('REQ_RIGHT_TO_WORK', 'Visa evidence / VEVO check'),
  item('REQ_AHPRA', 'AHPRA registration certificate'),
  item('PACK_FIRST_AID', 'First Aid / CPR certificate'),
  item('REQ_NDIS_SCREENING', 'NDIS Worker Screening clearance'),
  item('REQ_WWCC', 'WWCC clearance'),
  item('PACK_POLICE_CHECK', 'National Police Check certificate'),
  item('REQ_TAX_SETUP', 'Employee Tax Details Summary (from myGov)'),
];
const FULL_PACK = [...PACK, item('PACK_SUPER_CHOICE', 'Superannuation Standard Choice form'), ...SUPPORTING];

describe('matchDocument — every supporting slot of the pack fills automatically', () => {
  test.each([
    ['drivers_licence', 'REQ_DRIVERS_LICENCE'], ['passport', 'REQ_IDENTITY'], ['visa', 'REQ_RIGHT_TO_WORK'],
    ['ahpra', 'REQ_AHPRA'], ['first_aid', 'PACK_FIRST_AID'], ['cpr', 'PACK_FIRST_AID'], ['ndis_screening', 'REQ_NDIS_SCREENING'],
    ['wwcc', 'REQ_WWCC'], ['police_check', 'PACK_POLICE_CHECK'], ['tax_summary', 'REQ_TAX_SETUP'],
  ])('a document the model reads as %s lands on %s', (kind, code) => {
    const m = matchDocument({ file_name: 'IMG_0001.pdf' }, { kind, confidence: 'high' }, FULL_PACK);
    expect(m.item && m.item.code).toBe(code);
    expect(m.confidence).toBe('high');
  });

  test.each([
    ['Drivers Licence front.jpg', 'REQ_DRIVERS_LICENCE'], ['Driver licence back.jpg', 'REQ_DRIVERS_LICENCE'],
    ['Passport.jpg', 'REQ_IDENTITY'], ['VEVO check.pdf', 'REQ_RIGHT_TO_WORK'], ['Visa grant notice.pdf', 'REQ_RIGHT_TO_WORK'],
    ['AHPRA Certificate of Registration.pdf', 'REQ_AHPRA'], ['First Aid Certificate.pdf', 'PACK_FIRST_AID'],
    ['CPR certificate HLTAID009.pdf', 'PACK_FIRST_AID'], ['NDIS clearance.pdf', 'REQ_NDIS_SCREENING'],
    ['Working with Children Check.pdf', 'REQ_WWCC'], ['Police check.pdf', 'PACK_POLICE_CHECK'], ['NPC.pdf', 'PACK_POLICE_CHECK'],
    ['Employee Tax Details Summary.pdf', 'REQ_TAX_SETUP'],
  ])('an unread file named "%s" lands on %s by its name', (fileName, code) => {
    const m = matchDocument({ file_name: fileName, title: fileName }, null, FULL_PACK);
    expect(m.item && m.item.code).toBe(code);
  });

  test('a camera photo with no readable text and a default name is held for the Owner to place', () => {
    expect(matchDocument({ file_name: 'IMG_2041.jpg', title: 'IMG_2041.jpg' }, null, FULL_PACK)).toEqual({ kind: 'unrecognised', item: null, confidence: 'low' });
  });
});
