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
