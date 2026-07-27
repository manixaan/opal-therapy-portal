'use strict';

/**
 * Contact-matching engine unit tests — the confidence ladder. The safety
 * property: nothing except a stored 'existing' mapping is ever 'mapped';
 * every heuristic match lands in needs_review or unmapped.
 */

const { suggestContactMatches, normName, fuzzyNameMatch } = require('../contact-matching');

const xc = (id, name, email) => ({ xero_contact_id: id, name, email });

describe('confidence ladder', () => {
  test('stored mapping wins over everything and stays mapped', () => {
    const [s] = suggestContactMatches(
      [{ id: 'c1', fullName: 'Jane Smith', email: 'jane@x.test' }],
      [xc('X1', 'Jane Smith', 'jane@x.test'), xc('X2', 'Someone Else', null)],
      [{ splose_client_id: 'c1', xero_contact_id: 'X2', status: 'mapped' }]);
    expect(s).toMatchObject({ xeroContactId: 'X2', matchReason: 'existing', status: 'mapped', confidence: 'high' });
  });

  test('unique email match → high confidence but still needs review', () => {
    const [s] = suggestContactMatches(
      [{ id: 'c1', fullName: 'Totally Different', email: 'Jane@X.test ' }],
      [xc('X1', 'Jane Smith', 'jane@x.test'), xc('X2', 'Bob', 'bob@x.test')]);
    expect(s).toMatchObject({ xeroContactId: 'X1', confidence: 'high', matchReason: 'email', status: 'needs_review' });
  });

  test('email shared by several Xero contacts → multiple, no auto-pick', () => {
    const [s] = suggestContactMatches(
      [{ id: 'c1', fullName: 'Jane', email: 'shared@x.test' }],
      [xc('X1', 'A', 'shared@x.test'), xc('X2', 'B', 'shared@x.test')]);
    expect(s).toMatchObject({ xeroContactId: null, matchReason: 'multiple', status: 'needs_review' });
  });

  test('unique exact name (case/punctuation-insensitive) → medium, needs review', () => {
    const [s] = suggestContactMatches(
      [{ id: 'c1', fullName: 'JANE   SMITH', email: null }],
      [xc('X1', 'Jane Smith', null), xc('X2', 'Bob Brown', null)]);
    expect(s).toMatchObject({ xeroContactId: 'X1', confidence: 'medium', matchReason: 'name_exact', status: 'needs_review' });
  });

  test('name matching multiple Xero contacts → multiple', () => {
    const [s] = suggestContactMatches(
      [{ id: 'c1', fullName: 'Jane Smith', email: null }],
      [xc('X1', 'Jane Smith', null), xc('X2', 'jane smith', null)]);
    expect(s).toMatchObject({ xeroContactId: null, matchReason: 'multiple', status: 'needs_review' });
  });

  test('unique fuzzy name (word containment) → low, needs review', () => {
    const [s] = suggestContactMatches(
      [{ id: 'c1', fullName: 'Jane Smith', email: null }],
      [xc('X1', 'Smith, Jane (NDIS plan)', null), xc('X2', 'Unrelated Person', null)]);
    expect(s).toMatchObject({ xeroContactId: 'X1', confidence: 'low', matchReason: 'name_fuzzy', status: 'needs_review' });
  });

  test('no match at all → unmapped with reason none', () => {
    const [s] = suggestContactMatches(
      [{ id: 'c1', fullName: 'Jane Smith', email: 'jane@x.test' }],
      [xc('X1', 'Bob Brown', 'bob@x.test')]);
    expect(s).toMatchObject({ xeroContactId: null, confidence: null, matchReason: 'none', status: 'unmapped' });
  });

  test('never auto-maps: no heuristic result carries status mapped', () => {
    const suggestions = suggestContactMatches(
      [{ id: 'c1', fullName: 'Jane Smith', email: 'jane@x.test' },
       { id: 'c2', fullName: 'Bob Brown', email: null },
       { id: 'c3', fullName: 'Nobody Known', email: null }],
      [xc('X1', 'Jane Smith', 'jane@x.test'), xc('X2', 'Bob Brown', null)]);
    for (const s of suggestions) expect(s.status).not.toBe('mapped');
  });
});

describe('normalisation helpers', () => {
  test('normName strips punctuation, case, extra spaces', () => {
    expect(normName('  SMITH,   Jane! ')).toBe('smith jane');
  });
  test('fuzzyNameMatch needs 2+ significant words and containment', () => {
    expect(fuzzyNameMatch(normName('Jane Smith'), normName('Smith, Jane (NDIS)'))).toBe(true);
    expect(fuzzyNameMatch(normName('Jane Smith'), normName('Jane Brown'))).toBe(false);
    expect(fuzzyNameMatch(normName('Jane'), normName('Jane Smith'))).toBe(false); // single word — too weak
  });
});
