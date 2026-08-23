'use strict';

/**
 * SERVICE AGREEMENT — CLAUSES, SIGNING, PROVIDER IDENTITY AND RESOLUTION
 *
 * What this suite protects: four small modules that each guard one boundary.
 *
 *   clauses.js       an owner types text that ends up in a participant's Word
 *                    document, their PDF and an HTML preview. It is sanitised
 *                    on the way IN, so no render site can forget to do it.
 *   signing.js       the only unauthenticated access this portal grants. The
 *                    token, what a session may write, and what the audit
 *                    record is allowed to CLAIM about a signature.
 *   organisation.js  the provider's legal identity. A wrong ABN survives into
 *                    every agreement issued after the day it was typed.
 *   resolve.js       what the portal knows about a participant — and, just as
 *                    importantly, what it refuses to guess.
 */

const map = require('../service-agreements/template-map');
const clauses = require('../service-agreements/clauses');
const signing = require('../service-agreements/signing');
const org = require('../service-agreements/organisation');
const { resolvePortalValues, mergeUserInput } = require('../service-agreements/resolve');
const { asDate } = require('../service-agreements/manifest');

// ═════════════════════════════════════════════════════════════════════════════

describe('the owner clause editor', () => {
  it('starts every clause enabled, in template order', () => {
    const snap = clauses.defaultClauseSnapshot();
    expect(snap.clauses).toHaveLength(map.CLAUSE_TAGS.length);
    expect(snap.clauses.every((c) => c.enabled)).toBe(true);
    expect(snap.custom).toEqual([]);
  });

  it('lets an optional clause be switched off', () => {
    const r = clauses.validateClauseConfig({
      clauses: [{ tag: 'OPAL_CLAUSE_CONFLICTS', enabled: false }],
    });
    expect(r.ok).toBe(true);
    expect(r.snapshot.clauses.find((c) => c.tag === 'OPAL_CLAUSE_CONFLICTS').enabled).toBe(false);
  });

  it('refuses to switch off a required clause', () => {
    const r = clauses.validateClauseConfig({
      clauses: [{ tag: 'OPAL_CLAUSE_PRICING_PAYMENT', enabled: false }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.message).join(' ')).toMatch(/required clause/i);
  });

  it('refuses a tag that is not a clause in this template', () => {
    const r = clauses.validateClauseConfig({ clauses: [{ tag: 'OPAL_NOT_A_CLAUSE' }] });
    expect(r.ok).toBe(false);
  });

  it('mints the custom clause tag itself and ignores the one the client sent', () => {
    // A client that could choose the tag could choose the PRICING tag and
    // replace the pricing clause by submitting a "custom" one.
    const r = clauses.validateClauseConfig({
      custom: [{ tag: 'OPAL_CLAUSE_PRICING_PAYMENT', title: 'Sneaky', body: 'Everything is free.' }],
    });
    expect(r.snapshot.custom[0].tag).not.toBe('OPAL_CLAUSE_PRICING_PAYMENT');
    expect(r.snapshot.custom[0].tag).toMatch(map.CUSTOM_CLAUSE_PATTERN);
  });

  it('keeps an existing custom tag across an edit', () => {
    const first = clauses.validateClauseConfig({
      custom: [{ title: 'Rural travel', body: 'Charged per NDIS limits.' }],
    });
    const tag = first.snapshot.custom[0].tag;

    const second = clauses.validateClauseConfig(
      { custom: [{ tag, title: 'Rural travel', body: 'Updated wording.' }] },
      first.snapshot
    );
    expect(second.snapshot.custom[0].tag).toBe(tag);
    expect(second.snapshot.custom[0].body).toBe('Updated wording.');
  });

  it('requires a custom clause to have both a title and a body', () => {
    expect(clauses.validateClauseConfig({ custom: [{ title: '', body: 'x' }] }).ok).toBe(false);
    expect(clauses.validateClauseConfig({ custom: [{ title: 'x', body: '' }] }).ok).toBe(false);
  });

  it('caps the number of custom clauses', () => {
    const many = Array.from({ length: clauses.MAX_CUSTOM_CLAUSES + 3 },
      (_, i) => ({ title: `C${i}`, body: 'text' }));
    const r = clauses.validateClauseConfig({ custom: many });
    expect(r.ok).toBe(false);
    expect(r.snapshot.custom.length).toBeLessThanOrEqual(clauses.MAX_CUSTOM_CLAUSES);
  });

  it('keeps the schedules in their lettered order whatever was submitted', () => {
    // "Schedule C" before "Schedule A" is not a layout preference; it is a
    // document that contradicts its own cross-references.
    const r = clauses.validateClauseConfig({
      clauses: [
        { tag: 'OPAL_SCHEDULE_CONSENTS', order: 1 },
        { tag: 'OPAL_SCHEDULE_SUPPORTS', order: 999 },
      ],
    });
    const a = r.snapshot.clauses.find((c) => c.tag === 'OPAL_SCHEDULE_SUPPORTS');
    const c = r.snapshot.clauses.find((c2) => c2.tag === 'OPAL_SCHEDULE_CONSENTS');
    expect(a.order).toBeLessThan(c.order);
  });
});

describe('clause text is sanitised on the way in', () => {
  it('strips scripts and every other tag', () => {
    const out = clauses.sanitiseText('<script>alert(1)</script>Hello <b>world</b>', 500);
    expect(out).not.toMatch(/</);
    expect(out).toContain('Hello');
    expect(out).toContain('world');
  });

  it('cannot be tricked into resurrecting a tag from entities', () => {
    const out = clauses.sanitiseText('&lt;script&gt;alert(1)&lt;/script&gt;', 500);
    expect(out).not.toMatch(/<script/i);
  });

  it('removes control, zero-width and bidi-override characters', () => {
    // A bidi override in a contract makes the rendered text read differently
    // from the stored text. That is a trick, not a formatting choice.
    const out = clauses.sanitiseText('AB​C‮D﻿E', 500);
    expect(out).toBe('ABCDE');
  });

  it('keeps paragraph breaks but collapses runs of blank lines', () => {
    expect(clauses.sanitiseText('One\n\n\n\n\nTwo', 500)).toBe('One\n\nTwo');
    expect(clauses.paragraphsOf('One\n\nTwo\n\nThree')).toEqual(['One', 'Two', 'Three']);
  });

  it('truncates at the cap rather than storing an unbounded blob', () => {
    expect(clauses.sanitiseText('x'.repeat(50), 10)).toHaveLength(10);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('signing tokens', () => {
  it('are long, random and different every time', () => {
    const a = signing.mintToken();
    const b = signing.mintToken();
    expect(a.token).toHaveLength(43);          // 32 random bytes, base64url
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('are stored only as a hash', () => {
    const { token, tokenHash } = signing.mintToken();
    expect(tokenHash).not.toContain(token);
    expect(signing.hashToken(token)).toBe(tokenHash);
  });

  it('compare in constant time and reject a wrong or short input', () => {
    const { token, tokenHash } = signing.mintToken();
    expect(signing.tokensMatch(signing.hashToken(token), tokenHash)).toBe(true);
    expect(signing.tokensMatch(signing.hashToken('nope'), tokenHash)).toBe(false);
    expect(signing.tokensMatch('short', tokenHash)).toBe(false);
    expect(signing.tokensMatch('', tokenHash)).toBe(false);
  });

  it('bind the link to the address it was sent to', () => {
    expect(signing.recipientMatches(' Jordan@Example.Invalid ', 'jordan@example.invalid')).toBe(true);
    expect(signing.recipientMatches('someone.else@example.invalid', 'jordan@example.invalid')).toBe(false);
    expect(signing.recipientMatches('', 'jordan@example.invalid')).toBe(false);
  });

  it('build a URL that survives an email client', () => {
    const url = signing.buildSigningUrl('https://opal.example/', 'a+b/c=');
    expect(url).toBe('https://opal.example/service-agreement-sign?token=a%2Bb%2Fc%3D');
  });
});

describe('what a signing session may write', () => {
  it('gives a witness only the witness block', () => {
    expect(signing.assignedTagsFor('witness').sort()).toEqual(
      ['OPAL_WITNESS_NAME', 'OPAL_WITNESS_SIGNATURE', 'OPAL_WITNESS_SIGNED_DATE'].sort()
    );
  });

  it('gives a participant their own fields but no witness signature', () => {
    const tags = signing.assignedTagsFor('participant');
    expect(tags.length).toBeGreaterThan(10);
    expect(tags).not.toContain('OPAL_WITNESS_SIGNATURE');
    expect(tags).not.toContain('OPAL_WITNESS_SIGNED_DATE');
  });

  it('never gives a participant a price, an org field or the provider signature', () => {
    const tags = signing.assignedTagsFor('participant');
    for (const t of [...map.OWNER_TAGS, ...map.SERVER_TAGS, ...map.SUPPORT_ROW_TAGS,
      'OPAL_PROVIDER_SIGNATURE', 'OPAL_PROVIDER_SIGNATORY_NAME']) {
      expect(tags).not.toContain(t);
    }
  });

  it('drops anything submitted that the session was not assigned', () => {
    const { accepted, rejected } = signing.filterSubmission({
      OPAL_PARTICIPANT_EMAIL: 'jordan@example.invalid',
      OPAL_SUPPORT_RATE: '0.01',
      OPAL_ORG_ABN: '00 000 000 000',
      OPAL_PROVIDER_SIGNATURE: 'Not the provider',
      NOT_A_TAG: 'x',
    }, signing.assignedTagsFor('participant'));

    expect(Object.keys(accepted)).toEqual(['OPAL_PARTICIPANT_EMAIL']);
    expect(rejected).toEqual(expect.arrayContaining([
      'OPAL_SUPPORT_RATE', 'OPAL_ORG_ABN', 'OPAL_PROVIDER_SIGNATURE', 'NOT_A_TAG',
    ]));
  });
});

describe('session lifetime', () => {
  const now = new Date('2026-08-20T00:00:00Z');

  it('clamps an expiry to something defensible', () => {
    expect(signing.expiryFrom(now, 0.1).getTime())
      .toBe(now.getTime() + signing.MIN_EXPIRY_DAYS * 86400000);
    expect(signing.expiryFrom(now, 9999).getTime())
      .toBe(now.getTime() + signing.MAX_EXPIRY_DAYS * 86400000);
    expect(signing.expiryFrom(now, undefined).getTime())
      .toBe(now.getTime() + signing.DEFAULT_EXPIRY_DAYS * 86400000);
  });

  const live = { status: 'pending', expires_at: new Date('2026-09-01T00:00:00Z'), verification_attempts: 0 };

  it('accepts a live session', () => {
    expect(signing.sessionUnusableReason(live, now)).toBeNull();
  });

  it('refuses a missing, revoked, completed, expired or locked session', () => {
    expect(signing.sessionUnusableReason(null, now)).toBe('not_found');
    expect(signing.sessionUnusableReason({ ...live, status: 'revoked' }, now)).toBe('revoked');
    expect(signing.sessionUnusableReason({ ...live, status: 'completed' }, now)).toBe('completed');
    expect(signing.sessionUnusableReason({ ...live, status: 'expired' }, now)).toBe('expired');
    expect(signing.sessionUnusableReason(
      { ...live, expires_at: new Date('2026-08-01T00:00:00Z') }, now
    )).toBe('expired');
    expect(signing.sessionUnusableReason(
      { ...live, verification_attempts: signing.MAX_VERIFICATION_ATTEMPTS }, now
    )).toBe('locked');
  });
});

describe('what a signature record claims', () => {
  const signedAt = new Date('2026-08-20T04:05:06Z');

  it('writes the participant block for a participant session', () => {
    const v = signing.signatureValuesFor(
      { signatory_type: 'participant', signature_name: 'Jordan Whitlock' }, signedAt, asDate
    );
    expect(v).toEqual({
      OPAL_PARTICIPANT_SIGNATURE: 'Jordan Whitlock',
      OPAL_PARTICIPANT_SIGNED_DATE: '20/08/2026',
    });
  });

  it('writes the witness block for a witness session', () => {
    const v = signing.signatureValuesFor(
      { signatory_type: 'witness', signature_name: 'Sam Ellery' }, signedAt, asDate
    );
    expect(Object.keys(v)).toEqual(['OPAL_WITNESS_SIGNATURE', 'OPAL_WITNESS_SIGNED_DATE']);
  });

  it('takes the date from the server clock, never from the session body', () => {
    const v = signing.signatureValuesFor(
      { signatory_type: 'participant', signature_name: 'X', OPAL_PARTICIPANT_SIGNED_DATE: '01/01/1999' },
      signedAt, asDate
    );
    expect(v.OPAL_PARTICIPANT_SIGNED_DATE).toBe('20/08/2026');
  });

  it('never claims the signature was cryptographically verified', () => {
    // Calling a typed name a digital signature is the kind of overstatement
    // that only surfaces when somebody disputes the agreement.
    const meta = signing.signatureMetadata({
      ip: '203.0.113.9', userAgent: 'jest', signedAt,
      documentSha256: 'a'.repeat(64), capacity: 'Plan nominee', intent: true,
    });
    expect(meta.cryptographicallyVerified).toBe(false);
    expect(meta.method).toBe('portal_typed_signature');
    expect(meta.intentConfirmed).toBe(true);
    expect(meta.documentSha256).toHaveLength(64);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('the provider’s ABN', () => {
  it('accepts a valid ABN and rejects one that fails the ATO check', () => {
    expect(org.isValidAbn('51824753556')).toBe(true);
    expect(org.isValidAbn('51 824 753 556')).toBe(true);
    expect(org.isValidAbn('51824753557')).toBe(false);   // one digit out
    expect(org.isValidAbn('5182475355')).toBe(false);    // ten digits
    expect(org.isValidAbn('abcdefghijk')).toBe(false);
  });

  it('formats it the way the ATO prints it', () => {
    expect(org.formatAbn('51824753556')).toBe('51 824 753 556');
  });
});

describe('provider settings validation', () => {
  it('accepts and normalises a valid submission', () => {
    const { values, errors } = org.validateSettings({
      legalName: 'Opal Therapy Pty Ltd',
      abn: '51824753556',
      paymentTermsDays: '14',
      ndisRegistrationNumber: '4-050-1234-5',
    });
    expect(errors).toEqual([]);
    expect(values.abn).toBe('51 824 753 556');
    expect(values.paymentTermsDays).toBe('14');
  });

  it('rejects a bad ABN and out-of-range payment terms', () => {
    const { errors } = org.validateSettings({ abn: '12345678901', paymentTermsDays: '900' });
    expect(errors.map((e) => e.field).sort()).toEqual(['abn', 'paymentTermsDays']);
  });

  it('rejects a non-numeric payment term', () => {
    expect(org.validateSettings({ paymentTermsDays: 'fourteen' }).errors).toHaveLength(1);
  });

  it('treats an empty string as clearing the field', () => {
    expect(org.validateSettings({ legalName: '' }).values.legalName).toBeNull();
  });

  it('rejects an over-long value rather than silently truncating it', () => {
    expect(org.validateSettings({ legalName: 'x'.repeat(500) }).errors).toHaveLength(1);
  });

  it('names what is missing before an agreement may be issued', () => {
    expect(org.requiredMissing({ shared: {} }).sort())
      .toEqual(['abn', 'businessAddress', 'complaintsContact', 'legalName']);
    expect(org.requiredMissing({
      legalName: 'Opal Therapy Pty Ltd', abn: '51 824 753 556',
      complaintsContact: 'complaints@opal.invalid',
      shared: { businessAddress: '1 Example St' },
    })).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('resolving what the portal knows', () => {
  const splose = {
    fullName: 'Jordan Avery Whitlock',
    ndisNumber: '430512977',
    email: 'jordan@example.invalid',
    mobilePhone: '0400 000 000',
    formattedAddress: '12 Barrallier Street, Wagga Wagga NSW 2650',
    dateOfBirth: '1998-03-14',
  };
  const profile = {
    preferred_name: 'Jordy',
    date_of_birth: '1990-01-01',
    nominee_details: 'Alex Whitlock\n12 Barrallier Street\nWagga Wagga NSW 2650',
  };
  const currentPlan = { plan_start: '2026-07-01', plan_end: '2027-06-30' };
  const goals = [{ goal_text: 'Return to work' }, { goal_text: 'Independent showering' }];
  const user = { display_name: 'Dr Rae Sandoval', role_title: 'Occupational Therapist' };

  it('takes identity from Splose and attributes it', () => {
    const r = resolvePortalValues({ splose });
    expect(r.values.OPAL_PARTICIPANT_FULL_NAME).toBe('Jordan Avery Whitlock');
    expect(r.sources.OPAL_PARTICIPANT_FULL_NAME).toBe('splose');
    expect(r.values.OPAL_PARTICIPANT_NDIS_NUMBER).toBe('430512977');
    expect(r.values.OPAL_PARTICIPANT_PHONE).toBe('0400 000 000');
  });

  it('never lets a stale profile shadow a live Splose value', () => {
    // This is the failure the FCA resolver was written to prevent, and a
    // service agreement is a worse place for it than a report.
    const r = resolvePortalValues({
      splose, profile: { ...profile, full_name: 'OLD NAME', date_of_birth: '1990-01-01' },
    });
    expect(r.values.OPAL_PARTICIPANT_FULL_NAME).toBe('Jordan Avery Whitlock');
    expect(r.values.OPAL_PARTICIPANT_DATE_OF_BIRTH).toBe('14/03/1998');
    expect(r.sources.OPAL_PARTICIPANT_DATE_OF_BIRTH).toBe('splose');
  });

  it('falls back to the profile for facts Splose has no field for', () => {
    const r = resolvePortalValues({ splose: { ...splose, dateOfBirth: null }, profile });
    expect(r.values.OPAL_PARTICIPANT_PREFERRED_NAME).toBe('Jordy');
    expect(r.sources.OPAL_PARTICIPANT_PREFERRED_NAME).toBe('client_profile');
    expect(r.values.OPAL_PARTICIPANT_DATE_OF_BIRTH).toBe('01/01/1990');
    expect(r.sources.OPAL_PARTICIPANT_DATE_OF_BIRTH).toBe('client_profile');
  });

  it('renders plan dates in Australian form and goals one per line', () => {
    const r = resolvePortalValues({ splose, currentPlan, goals });
    expect(r.values.OPAL_PARTICIPANT_PLAN_START_DATE).toBe('01/07/2026');
    expect(r.values.OPAL_PARTICIPANT_PLAN_END_DATE).toBe('30/06/2027');
    expect(r.values.OPAL_PARTICIPANT_GOALS).toBe('Return to work\nIndependent showering');
  });

  it('takes only the representative NAME from free text, and infers nothing else', () => {
    // nominee_details is one unstructured TEXT column. Asserting that somebody
    // is a plan nominee because the words looked like it would make the
    // document state a legal relationship nobody verified.
    const r = resolvePortalValues({ splose, profile });
    expect(r.values.OPAL_REPRESENTATIVE_FULL_NAME).toBe('Alex Whitlock');
    expect(r.values.OPAL_REPRESENTATIVE_RELATIONSHIP).toBeUndefined();
    expect(r.values.OPAL_REPRESENTATIVE_AUTHORITY).toBeUndefined();
    expect(r.values.OPAL_REPRESENTATIVE_PHONE).toBeUndefined();
    expect(r.values.OPAL_REPRESENTATIVE_EMAIL).toBeUndefined();
  });

  it('names the issuing user as the provider signatory', () => {
    const r = resolvePortalValues({ splose, user });
    expect(r.values.OPAL_PROVIDER_SIGNATORY_NAME).toBe('Dr Rae Sandoval');
    expect(r.values.OPAL_PROVIDER_SIGNATORY_ROLE).toBe('Occupational Therapist');
  });

  it('merges the owner-controlled organisation block', () => {
    const r = resolvePortalValues({
      splose,
      organisation: {
        values: { OPAL_ORG_ABN: '51 824 753 556' },
        sources: { OPAL_ORG_ABN: 'organisation_settings' },
      },
    });
    expect(r.values.OPAL_ORG_ABN).toBe('51 824 753 556');
    expect(r.sources.OPAL_ORG_ABN).toBe('organisation_settings');
  });

  it('does not report a signature or an agreement id as missing', () => {
    // Those are Opal's to ISSUE, not facts to go and find. Listing them would
    // ask a staff member to hunt for the id of a document that does not exist.
    const r = resolvePortalValues({ splose });
    for (const tag of [...map.SERVER_TAGS, ...map.ESIGN_TAGS]) {
      expect(r.missing).not.toContain(tag);
    }
    // But it IS honest about the things nobody has stored anywhere.
    expect(r.missing).toContain('OPAL_FUNDING_MANAGEMENT_TYPE');
    expect(r.missing).toContain('OPAL_EMERGENCY_CONTACT_NAME');
  });
});

describe('merging what a user typed over what was resolved', () => {
  const resolved = {
    values: { OPAL_PARTICIPANT_PHONE: '0400 000 000', OPAL_ORG_ABN: '51 824 753 556' },
    sources: { OPAL_PARTICIPANT_PHONE: 'splose', OPAL_ORG_ABN: 'organisation_settings' },
  };

  it('lets a user correct a portal field for this agreement only', () => {
    const r = mergeUserInput(resolved, { OPAL_PARTICIPANT_PHONE: '0455 555 555' });
    expect(r.values.OPAL_PARTICIPANT_PHONE).toBe('0455 555 555');
    expect(r.sources.OPAL_PARTICIPANT_PHONE).toBe('manual');
    expect(r.rejected).toEqual([]);
  });

  it('refuses an owner, server or e-sign field however it was posted', () => {
    const r = mergeUserInput(resolved, {
      OPAL_ORG_ABN: '00 000 000 000',
      OPAL_AGREEMENT_ID: 'SVA-FORGED1',
      OPAL_PARTICIPANT_SIGNATURE: 'Mallory',
    });
    expect(r.values.OPAL_ORG_ABN).toBe('51 824 753 556');
    expect(r.values.OPAL_AGREEMENT_ID).toBeUndefined();
    expect(r.values.OPAL_PARTICIPANT_SIGNATURE).toBeUndefined();
    expect(r.rejected.sort()).toEqual(
      ['OPAL_AGREEMENT_ID', 'OPAL_ORG_ABN', 'OPAL_PARTICIPANT_SIGNATURE'].sort()
    );
  });

  it('treats an emptied field as a deliberate clear, not a fallback', () => {
    const r = mergeUserInput(resolved, { OPAL_PARTICIPANT_PHONE: '' });
    expect(r.values.OPAL_PARTICIPANT_PHONE).toBeUndefined();
  });

  it('ignores a tag that is not in the template at all', () => {
    const r = mergeUserInput(resolved, { NOT_A_TAG: 'x' });
    expect(r.values.NOT_A_TAG).toBeUndefined();
  });
});
