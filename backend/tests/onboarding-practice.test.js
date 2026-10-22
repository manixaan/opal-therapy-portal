'use strict';

/**
 * THE PRACTICE'S OWN DETAILS — settings, not code (Oct 2026).
 *
 * The signatory, the email sign-offs, the pack's return address, the letter
 * footer's date and the contract's notices mailbox were all fixed in code.
 * They now come from onboarding settings, and no email asks a starter to
 * send a tax file number, bank details or identity documents.
 */

const JSZip = require('jszip');
const practice = require('../onboarding-practice');
const offerEmail = require('../onboarding-offer-email');
const packEmail = require('../onboarding-pack-email');
const induction = require('../onboarding-induction');
const offerDocx = require('../onboarding-offer-docx');

describe('practiceProfile', () => {
  test('the defaults are the practice\'s current details, with no street address', () => {
    const p = practice.practiceProfile({});
    expect(p).toMatchObject({ name: 'Opal Therapy', abn: '49 699 791 958', acn: '699 791 958', phone: '0484 827 212', email: 'ann.mathew@opaltherapy.com.au', address: null });
    expect(p.returnEmail).toBe('ann.mathew@opaltherapy.com.au');
    expect(p.signOff).toBe('Ann\nDirector | Opal Therapy');
  });
  test('saved settings win everywhere', () => {
    const p = practice.practiceProfile({ practiceName: 'Opal Therapy WA', offerSignatoryName: 'Kim Lee', offerSignatoryTitle: 'Practice Manager', returnEmail: 'hr@example.test' });
    expect(p.signOff).toBe('Kim\nPractice Manager | Opal Therapy WA');
    expect(p.returnEmail).toBe('hr@example.test');
  });
});

describe('validatePracticePatch — 400 with field messages, never a 500', () => {
  test('flags each bad field by name', () => {
    const e = practice.validatePracticePatch({ practiceEmail: 'not-an-email', practiceAbn: '123', practiceAcn: 'abc', practiceName: '', practicePhone: 'call me' });
    expect(Object.keys(e).sort()).toEqual(['practiceAbn', 'practiceAcn', 'practiceEmail', 'practiceName', 'practicePhone']);
  });
  test('accepts the real details', () => {
    expect(practice.validatePracticePatch({ practiceAbn: '49 699 791 958', practiceAcn: '699 791 958', practicePhone: '0484 827 212', practiceEmail: 'ann.mathew@opaltherapy.com.au' })).toEqual({});
  });
});

describe('the emails sign off as the configured signatory', () => {
  const signOff = 'Kim\nPractice Manager | Opal Therapy WA';
  test.each([
    ['offer', () => offerEmail.composeOfferEmail({ applicantName: 'Jo Bloggs', positionTitle: 'OT', signOff }).body],
    ['pack', () => packEmail.composePackEmail({ applicantName: 'Jo Bloggs', signOff }).body],
    ['induction', () => induction.composeInductionEmail({ applicantName: 'Jo Bloggs', signOff }).body],
  ])('%s', (_, body) => {
    expect(body()).toMatch(/Kim\nPractice Manager \| Opal Therapy WA$/);
    expect(body()).not.toContain('Ann\nDirector');
  });
});

describe('no email asks for a TFN, bank details or identity documents (owner decision 1)', () => {
  test('Email 2 no longer asks for the tax summary, bank details or ID copies by email', () => {
    const body = packEmail.composePackEmail({ applicantName: 'Jo' }).body;
    expect(body).not.toMatch(/email it to us/i);
    expect(body).not.toMatch(/Passport photo page/);
    expect(body).toMatch(/never send your tax file number, bank details or identity documents by email/i);
  });
});

describe('the letter footer carries the issue date, not the template\'s', () => {
  test('31-08-2026 is replaced by the date the letter is issued', async () => {
    const buf = await offerDocx.buildOfferDocx({
      terms: { positionTitle: 'Occupational Therapist', employmentType: 'full_time', startDate: '2026-12-01' },
      applicant: { name: 'Jo Bloggs' }, issuedAt: new Date('2026-10-22T03:00:00Z'),
    });
    const zip = await JSZip.loadAsync(buf);
    const footers = await Promise.all(['word/footer1.xml', 'word/footer2.xml', 'word/footer3.xml']
      .map((p) => (zip.file(p) ? zip.file(p).async('string') : '')));
    const text = footers.join(' ');
    expect(text).not.toContain('31-08-2026');
    expect(text).toContain('22-10-2026');
  });
});
