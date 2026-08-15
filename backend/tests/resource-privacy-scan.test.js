'use strict';

/**
 * Content-evidence privacy detection (resource-privacy-scan.js).
 *
 * The load-bearing distinction: a blank template label must pass, a populated
 * one must not. These tests use invented example values — no real client data.
 */

const { scanTextForClientContent, requiresHumanReview } = require('../resource-privacy-scan');

function kinds(list) { return list.map((f) => f.kind); }

describe('blank templates stay publishable', () => {
  test('underscore-blank name field is not a signal', () => {
    const r = scanTextForClientContent('Client Name: ____________\nDate: ______');
    expect(r.verdict).toBe('no-obvious-pii');
    expect(r.strong).toEqual([]);
  });

  test('empty label at end of line is not a signal', () => {
    const r = scanTextForClientContent('Participant name:\nDOB:\nAddress:');
    expect(r.verdict).toBe('no-obvious-pii');
  });

  test('Word content-control placeholder is not a signal', () => {
    const r = scanTextForClientContent('Client name: Click here to enter text.\nDOB: Click to enter a date');
    expect(r.verdict).toBe('no-obvious-pii');
  });

  test('instructional text after a label is not a name', () => {
    const r = scanTextForClientContent('Client name: Please write your name here');
    expect(r.verdict).toBe('no-obvious-pii');
  });

  test('a generic worksheet with an org footer is clean', () => {
    const r = scanTextForClientContent(
      'Emotional Regulation Worksheet\nColour the zones.\n'
      + 'Published by Example Press, contact info@example.com');
    expect(r.verdict).toBe('no-obvious-pii');
  });
});

describe('populated client documents are caught', () => {
  test('filled client name field is a strong signal', () => {
    const r = scanTextForClientContent('Client Name: Alex Sample\nGoals: ...');
    expect(kinds(r.strong)).toContain('populated-client-name-field');
    expect(r.verdict).toBe('client-confidential');
    expect(requiresHumanReview(r.verdict)).toBe(true);
  });

  test('filled DOB field is a strong signal', () => {
    const r = scanTextForClientContent('Date of birth: 03/04/2015');
    expect(kinds(r.strong)).toContain('populated-date-of-birth-field');
    expect(r.verdict).toBe('client-confidential');
  });

  test('an NDIS participant number is strong even without a label', () => {
    const r = scanTextForClientContent('Plan reference 430000123 applies.');
    expect(kinds(r.strong)).toContain('ndis-participant-number');
    expect(r.verdict).toBe('client-confidential');
  });

  test('a populated address field is a strong signal', () => {
    const r = scanTextForClientContent('Address: 12 Example Street, Sampletown');
    expect(kinds(r.strong)).toContain('populated-address-field');
  });

  test('guardian name alone is weak → privacy-review, not publish', () => {
    const r = scanTextForClientContent('Parent name: Casey Sample');
    expect(r.strong).toEqual([]);
    expect(kinds(r.weak)).toContain('populated-guardian-name-field');
    expect(r.verdict).toBe('privacy-review');
    expect(requiresHumanReview(r.verdict)).toBe(true);
  });
});

describe('findings carry counts only, never values', () => {
  test('no matched text appears anywhere in the result', () => {
    const r = scanTextForClientContent('Client Name: Alex Sample\nDOB: 03/04/2015');
    const dumped = JSON.stringify(r);
    expect(dumped).not.toMatch(/Alex/);
    expect(dumped).not.toMatch(/Sample/);
    expect(dumped).not.toMatch(/2015/);
    for (const f of r.strong.concat(r.weak)) {
      expect(Object.keys(f).sort()).toEqual(['count', 'kind']);
    }
  });
});
