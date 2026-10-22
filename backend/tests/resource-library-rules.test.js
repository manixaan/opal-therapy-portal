'use strict';

/**
 * The Library's pure rules: folder names, folder cycles, Keep-both names and
 * the recycle bin's 90-day clock. No database.
 */

const rules = require('../resource-library-rules');

describe('validateFolderName', () => {
  const ok = (n) => rules.validateFolderName(n);

  test.each([
    'NDIS', 'WHODAS', '2026 Policies', 'Policies 2025-26', 'Term 2', 'Documents',
    'Forms & Templates', 'Children (0-6)', "Parents' handouts", 'OT + Physio',
    'Reports, letters', 'v1.2 drafts', 'Under_score', 'Él señor', 'A',
  ])('accepts %s', (name) => {
    expect(ok(name)).toEqual({ ok: true, name });
  });

  test('trims and collapses whitespace', () => {
    expect(ok('   Clinical    Forms  ')).toEqual({ ok: true, name: 'Clinical Forms' });
  });

  test('refuses an empty name', () => {
    expect(ok('   ').code).toBe('folder_name_empty');
    expect(ok(null).code).toBe('folder_name_empty');
  });

  test('refuses over 80 characters, accepts exactly 80', () => {
    expect(ok('a'.repeat(80)).ok).toBe(true);
    expect(ok('a'.repeat(81)).code).toBe('folder_name_too_long');
  });

  test('refuses slashes either way', () => {
    expect(ok('Forms/Old').code).toBe('folder_name_slash');
    expect(ok('Forms\\Old').code).toBe('folder_name_slash');
  });

  test('refuses a leading or trailing full stop', () => {
    expect(ok('.hidden').code).toBe('folder_name_dot');
    expect(ok('Notes.').code).toBe('folder_name_dot');
  });

  test.each(['Forms: old', 'Q&A?', 'Notes*', '<script>', 'a#b', 'x|y', 'semi;colon'])(
    'refuses other punctuation: %s', (name) => {
      expect(ok(name).code).toBe('folder_name_characters');
    });

  test('every refusal says which rule failed, in words', () => {
    for (const bad of ['', 'a/b', '.x', 'a'.repeat(81), 'a:b']) {
      const v = ok(bad);
      expect(v.ok).toBe(false);
      expect(v.error).toMatch(/[a-z]/i);
    }
  });
});

describe('nameKey', () => {
  test('is case-insensitive and whitespace-tolerant', () => {
    expect(rules.nameKey('  Clinical   FORMS ')).toBe(rules.nameKey('clinical forms'));
  });
});

describe('wouldCreateCycle', () => {
  // A ─ B ─ C        D
  const parents = { A: null, B: 'A', C: 'B', D: null };

  test('moving to the top level is never a cycle', () => {
    expect(rules.wouldCreateCycle('A', null, parents)).toBe(false);
  });

  test('a folder into itself is a cycle', () => {
    expect(rules.wouldCreateCycle('A', 'A', parents)).toBe(true);
  });

  test('a folder into its child or grandchild is a cycle', () => {
    expect(rules.wouldCreateCycle('A', 'B', parents)).toBe(true);
    expect(rules.wouldCreateCycle('A', 'C', parents)).toBe(true);
  });

  test('a folder into a sibling tree or its own ancestor is fine', () => {
    expect(rules.wouldCreateCycle('C', 'A', parents)).toBe(false);
    expect(rules.wouldCreateCycle('B', 'D', parents)).toBe(false);
    expect(rules.wouldCreateCycle('D', 'C', parents)).toBe(false);
  });

  test('accepts a Map or a function as the parent lookup', () => {
    const map = new Map(Object.entries(parents));
    expect(rules.wouldCreateCycle('A', 'C', map)).toBe(true);
    expect(rules.wouldCreateCycle('A', 'C', (id) => parents[id])).toBe(true);
  });

  test('already-looping data refuses rather than hangs', () => {
    const loop = { X: 'Y', Y: 'X', Z: null };
    expect(rules.wouldCreateCycle('Z', 'X', loop)).toBe(true);
  });
});

describe('suffixedName (Keep both)', () => {
  test('a free name is returned unchanged', () => {
    expect(rules.suffixedName('Report.pdf', ['Other.pdf'])).toBe('Report.pdf');
  });

  test('a taken name gets " (2)" before the extension', () => {
    expect(rules.suffixedName('Report.pdf', ['report.PDF'])).toBe('Report (2).pdf');
  });

  test('keeps counting past taken suffixes', () => {
    expect(rules.suffixedName('Report.pdf', ['Report.pdf', 'Report (2).pdf', 'report (3).pdf']))
      .toBe('Report (4).pdf');
  });

  test('a name that already carries a suffix keeps counting rather than nesting', () => {
    expect(rules.suffixedName('Report (2).pdf', ['Report (2).pdf'])).toBe('Report (3).pdf');
  });

  test('a name without an extension gets the suffix at the end', () => {
    expect(rules.suffixedName('Notes', ['Notes'])).toBe('Notes (2)');
  });

  test('a dotfile-like name is treated as having no extension', () => {
    expect(rules.suffixedName('.pdf', ['.pdf'])).toBe('.pdf (2)');
  });
});

describe('the recycle bin clock', () => {
  const day = 24 * 60 * 60 * 1000;
  const deleted = new Date('2026-07-01T00:00:00Z');

  test('retention is 90 days', () => {
    expect(rules.RECYCLE_BIN_DAYS).toBe(90);
  });

  test('not due before 90 days, due at and after', () => {
    expect(rules.purgeDue(deleted, new Date(deleted.getTime() + 89 * day))).toBe(false);
    expect(rules.purgeDue(deleted, new Date(deleted.getTime() + 90 * day - 1))).toBe(false);
    expect(rules.purgeDue(deleted, new Date(deleted.getTime() + 90 * day))).toBe(true);
    expect(rules.purgeDue(deleted, new Date(deleted.getTime() + 400 * day))).toBe(true);
  });

  test('something never deleted is never due', () => {
    expect(rules.purgeDue(null)).toBe(false);
    expect(rules.purgeDue('not a date')).toBe(false);
  });

  test('days left counts down to zero and never below', () => {
    expect(rules.daysLeft(deleted, deleted)).toBe(90);
    expect(rules.daysLeft(deleted, new Date(deleted.getTime() + 1))).toBe(90);
    expect(rules.daysLeft(deleted, new Date(deleted.getTime() + 89.5 * day))).toBe(1);
    expect(rules.daysLeft(deleted, new Date(deleted.getTime() + 120 * day))).toBe(0);
  });
});
